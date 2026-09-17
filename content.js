// content.js - Zerodha Kite & Web Chart Live Stream Pattern Detector
// Handles: ticker/timeframe change detection, state reset, live market-hours streaming

console.log('⚡ [Pattern Radar] Chart observer initialized on:', window.location.href);

// ─── Module State ────────────────────────────────────────────────────────────
let candleHistory = [];          // Rolling candle buffer keyed to current ticker+tf
let lastEmittedKey = null;       // Dedup key: ticker_timeframe_close
let lastKnownTicker = null;      // Tracks previously seen ticker for change detection
let lastKnownTimeframe = null;   // Tracks previously seen timeframe for change detection
let emittedPatternKeys = new Set(); // In-memory dedup (also backed by storage)

// Load previously emitted pattern keys from persistent storage so reloads
// cannot re-fire notifications for patterns already sent this session/date.
(async () => {
  try {
    const { persistedPatternKeys = [] } = await chrome.storage.local.get('persistedPatternKeys');
    persistedPatternKeys.forEach(k => emittedPatternKeys.add(k));
  } catch (e) {}
})();

async function markPatternEmitted(patKey) {
  emittedPatternKeys.add(patKey);
  try {
    const { persistedPatternKeys = [] } = await chrome.storage.local.get('persistedPatternKeys');
    if (!persistedPatternKeys.includes(patKey)) {
      // Keep only last 500 keys to avoid unbounded storage growth
      const updated = [...persistedPatternKeys, patKey].slice(-500);
      await chrome.storage.local.set({ persistedPatternKeys: updated });
    }
  } catch (e) {}
}

// ─── Market Hours Helper (IST = UTC+5:30) ───────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  // Convert current time to IST
  const istOffset = 5.5 * 60 * 60 * 1000; // 5h 30m in ms
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const istNow = new Date(utcMs + istOffset);

  const day = istNow.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false; // No weekend trading

  const h = istNow.getHours();
  const m = istNow.getMinutes();
  const totalMins = h * 60 + m;
  const marketOpen = 9 * 60 + 15;   // 09:15
  const marketClose = 15 * 60 + 30; // 15:30
  return totalMins >= marketOpen && totalMins <= marketClose;
}

// ─── State Reset ─────────────────────────────────────────────────────────────
function resetState(ticker, timeframe) {
  console.log(`🔄 [Pattern Radar] State reset → ${ticker} (${timeframe})`);
  candleHistory = [];
  lastEmittedKey = null;
  emittedPatternKeys.clear();

  // Notify background to reset live history for the new ticker/timeframe scope
  try {
    chrome.runtime.sendMessage({
      type: 'RESET_TICKER_STATE',
      ticker,
      timeframe
    }).catch(() => {});
  } catch (e) {}

  // After reset, scan historical chart data with a small delay (let DOM settle)
  setTimeout(() => scanHistoricalCandles(), 800);
}

// ─── Target Tab Filter: Focus strictly on supported chart tabs ───────────────────
function isExtChartTab() {
  const href = window.location.href || '';
  let topHref = '';
  try {
    if (window.top && window.top.location) topHref = window.top.location.href;
  } catch (e) {}

  // Zerodha Kite: must contain /ext/ in URL (pop-out chart) or title says 'Kite Chart'
  const hasExtInUrl = href.includes('/ext/') || topHref.includes('/ext/');
  const titleLower = (document.title || '').toLowerCase();
  const hasKiteChartTitle = titleLower.includes('kite chart');

  // Groww: any URL matching https://groww.in/charts/stocks/<slug>
  const isGrowwChart = href.includes('groww.in/charts/') || topHref.includes('groww.in/charts/');

  // NSE India Charting: e.g. https://charting.nseindia.com/?symbol=NAUKRI-EQ
  const isNseChart = href.includes('nseindia.com') || topHref.includes('nseindia.com');

  return hasExtInUrl || hasKiteChartTitle || isGrowwChart || isNseChart;
}

// Helper to check master extension ON/OFF toggle setting
async function isExtensionEnabled() {
  try {
    const res = await chrome.storage.local.get(['extensionEnabled']);
    return res.extensionEnabled !== false;
  } catch (e) {
    return true;
  }
}

// ─── Historical Chart Scanner: Simulates mouse hover across chart to read OHLC ─
// Works when market is open OR closed — reads whatever candles are visible on screen
async function scanHistoricalCandles() {
  if (!isExtChartTab()) return;
  const enabled = await isExtensionEnabled();
  if (!enabled) return;
  const meta = parseChartDOM();
  if (!meta.ticker || meta.ticker === 'UNKNOWN') return;

  console.log(`🔍 [Pattern Radar] Scanning historical chart for ${meta.ticker} (${meta.timeframe})...`);

  // Find the chart pane element to simulate hover events on
  const chartPane = (
    document.querySelector('.chart-gui-wrapper') ||
    document.querySelector('[class*="pane-widget-container"]') ||
    document.querySelector('[class*="chart-widget"]') ||
    document.querySelector('[class*="tv-chart"]') ||
    document.querySelector('canvas')
  );
  if (!chartPane) {
    console.log('[Pattern Radar] Chart pane not found for historical scan.');
    return;
  }

  const rect = chartPane.getBoundingClientRect();
  if (!rect.width || rect.width < 100) return;

  const collectedCandles = [];
  let lastClose = null;

  // Sample 25 evenly-spaced positions across the chart width (left=oldest, right=newest)
  const steps = 25;
  const marginLeft  = rect.width * 0.05; // skip 5% padding on each side
  const marginRight = rect.width * 0.05;
  const usableWidth = rect.width - marginLeft - marginRight;
  const midY = rect.top + rect.height * 0.4; // hover in the candle body area

  for (let i = 0; i <= steps; i++) {
    const x = rect.left + marginLeft + (usableWidth / steps) * i;

    // Fire mousemove to trigger the chart legend to update OHLC
    chartPane.dispatchEvent(new MouseEvent('mousemove', {
      clientX: x, clientY: midY,
      bubbles: true, cancelable: true,
      view: window
    }));
    // Also dispatch on document for charts that listen at document level
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: x, clientY: midY,
      bubbles: true, cancelable: true
    }));

    // Give the chart DOM 200ms to update the legend values
    await new Promise(r => setTimeout(r, 200));

    const snapshot = parseChartDOM();
    if (!snapshot.closePrice || isNaN(snapshot.closePrice)) continue;

    // Only record if price is meaningfully different from previous sample
    const isDifferent = lastClose === null || Math.abs(snapshot.closePrice - lastClose) > snapshot.closePrice * 0.0002;
    if (isDifferent) {
      collectedCandles.push({
        open:  snapshot.openPrice  || snapshot.closePrice,
        high:  snapshot.highPrice  || snapshot.closePrice,
        low:   snapshot.lowPrice   || snapshot.closePrice,
        close: snapshot.closePrice,
        time:  Date.now() - (steps - i) * 5 * 60 * 1000 // approximate bar time (5-min spacing)
      });
      lastClose = snapshot.closePrice;
    }
  }

  // Restore chart to latest bar: move mouse to far right edge, then fire mouseleave
  chartPane.dispatchEvent(new MouseEvent('mousemove', {
    clientX: rect.right - 10, clientY: midY,
    bubbles: true, cancelable: true, view: window
  }));
  await new Promise(r => setTimeout(r, 150));
  chartPane.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

  if (collectedCandles.length === 0) {
    console.log('[Pattern Radar] No historical candles captured — chart may not be interactive.');
    return;
  }

  console.log(`[Pattern Radar] Collected ${collectedCandles.length} historical candles for ${meta.ticker}`);

  // Run pattern detection across the full collected history using a sliding window
  const windowSize = 3;
  const emittedHistoricalKeys = new Set();

  for (let i = windowSize - 1; i < collectedCandles.length; i++) {
    const window = collectedCandles.slice(Math.max(0, i - windowSize + 1), i + 1);
    const detected = evaluatePatterns(window, meta);

    detected.forEach(p => {
      const hKey = `${p.ticker}_${p.pattern_name}_${p.close}`;
      if (emittedHistoricalKeys.has(hKey)) return;
      if (emittedPatternKeys.has(hKey)) return;
      emittedHistoricalKeys.add(hKey);
      emittedPatternKeys.add(hKey);

      // Tag it so background knows this is a historical scan result, not live
      p.source = 'historical_scan';
      console.log(`📊 [Pattern Radar] Historical: ${p.pattern_name} on ${p.ticker} @ ₹${p.close}`);
      try {
        chrome.runtime.sendMessage({ type: 'PATTERN_DETECTED', pattern: p }).catch(() => {});
      } catch (e) {}
    });
  }
}


// ─── DOM Parser: Extract Ticker, Timeframe, OHLC from Visible Chart ──────────────
// Supports: Zerodha Kite /ext/ pop-out charts, Groww stock charts
function parseChartDOM() {
  let ticker = null;
  let timeframe = '1D';
  let openPrice = null, highPrice = null, lowPrice = null, closePrice = null;

  const href = window.location.href || '';
  let topHref = '';
  try {
    if (window.top && window.top.location) topHref = window.top.location.href;
  } catch (e) {}

  // ── A. NSE India URL symbol extraction e.g. https://charting.nseindia.com/?symbol=NAUKRI-EQ ──
  const nseMatch = href.match(/[?&]symbol=([A-Z0-9_-]+)/i) || topHref.match(/[?&]symbol=([A-Z0-9_-]+)/i);
  if (nseMatch && nseMatch[1]) {
    // Strip -EQ, -BE, -SM, .NS suffixes if present
    ticker = nseMatch[1].replace(/-(?:EQ|BE|SM|ST|N\d+)$/i, '').replace(/\.NS$/i, '').toUpperCase();
  }

  // ── B. Groww URL ticker extraction ──────────────────────────────────────────
  const growwMatch = href.match(/groww\.in\/charts\/stocks\/([^?#]+)/i) ||
                     topHref.match(/groww\.in\/charts\/stocks\/([^?#]+)/i);
  const isGrowwChart = !!(growwMatch);

  // ── C. Zerodha Kite URL ticker extraction ────────────────────────────────────
  // e.g. /markets/ext/chart/web/tvc/NSE/TORNTPOWER/3529217
  if (!ticker) {
    const urlMatch = href.match(/\/(?:ext\/)?chart\/web\/tvc\/([^\/]+)\/([^\/]+)/i) ||
                     topHref.match(/\/(?:ext\/)?chart\/web\/tvc\/([^\/]+)\/([^\/]+)/i) ||
                     href.match(/\/tvc\/([^\/]+)\/([^\/]+)/i) ||
                     topHref.match(/\/tvc\/([^\/]+)\/([^\/]+)/i);
    if (urlMatch) {
      ticker = urlMatch[2].toUpperCase();
    }
  }

  // ── C. Ticker from DOM legend title ──────────────────────────────────────────
  // e.g. "NAUKRI · 1D · NSE", "HDFCBANK, 1, NSE", "TATAGLOBAL • NSE"
  if (!ticker) {
    const legendTitleEl = document.querySelector(
      '.pane-legend-title, [class*="title-"], .header-symbol, [class*="legendTitle"], [class*="legend-title"]'
    );
    if (legendTitleEl) {
      const raw = (legendTitleEl.innerText || '').trim();
      const firstToken = raw.split(/[\s,·\-•|]+/)[0];
      if (firstToken && /^[A-Z0-9_&-]{2,20}$/i.test(firstToken)) {
        ticker = firstToken.toUpperCase();
      }
    }
  }

  // ── D. Groww — ticker from page <title> or h1 ────────────────────────────────
  // Groww page titles are like: "TATACONSUM Share Price | NSE/BSE | Groww"
  if (!ticker && isGrowwChart) {
    // Try <h1> first (most reliable on Groww chart pages)
    const h1El = document.querySelector('h1');
    if (h1El) {
      const h1Text = (h1El.innerText || '').trim();
      // e.g. "TATACONSUM" or "TATA CONSUMER PRODUCTS"
      const h1Token = h1Text.split(/[\s|,]+/)[0].toUpperCase();
      if (h1Token && /^[A-Z0-9]{2,15}$/.test(h1Token)) {
        ticker = h1Token;
      }
    }
    // Fall back to page title
    if (!ticker) {
      const titleParts = (document.title || '').split(/[\s|\-,]+/);
      for (const part of titleParts) {
        if (/^[A-Z]{2,15}$/.test(part) &&
            !['NSE','BSE','SHARE','PRICE','GROWW','CHART','STOCK','THE','AND','LTD'].includes(part)) {
          ticker = part;
          break;
        }
      }
    }
    // Last resort: capitalise the slug segments and pick the most likely NSE symbol
    // (Works for tickers whose name matches: e.g. "infy" → "INFY")
    if (!ticker && growwMatch) {
      const slug = growwMatch[1];
      const slugParts = slug.split('-').filter(p => p.length > 1);
      // Try the first segment uppercased if it looks like a ticker
      const candidate = slugParts[0]?.toUpperCase();
      if (candidate && /^[A-Z]{2,10}$/.test(candidate)) ticker = candidate;
    }
  }

  // ── E. Generic page title fallback (Kite & TradingView) ─────────────────────
  if (!ticker) {
    const titleParts = (document.title || '').split(/[\s\-|,]+/);
    for (const part of titleParts) {
      if (/^[A-Z]{2,15}$/.test(part) && part !== 'NSE' && part !== 'BSE' && part !== 'KITE') {
        ticker = part;
        break;
      }
    }
  }

  if (!ticker) ticker = 'UNKNOWN';

  // 4. Timeframe from DOM — active button/tab
  const tfSelectors = [
    '[class*="selected-"] [class*="item"]',
    '[class*="active"] [class*="item"]',
    '.button-active',
    '[class*="selectedButton"]',
    '[class*="intervalButton"][class*="active"]',
    '[class*="intervalButton"][class*="selected"]',
    '.legend-granularity',
    '[data-active="true"]',
    // Groww-specific
    '[class*="activeInterval"]',
    '[class*="selectedInterval"]',
    '[class*="intervalActive"]',
    'button[class*="active"][class*="interval"]',
    'button[class*="selected"]'
  ];
  for (const sel of tfSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const txt = (el.innerText || el.getAttribute('data-value') || '').trim().toUpperCase();
      if (/^(1M|3M|5M|10M|15M|30M|1H|2H|4H|1D|1W|1MTH|D|W|M|5|10|15)$/.test(txt)) {
        timeframe = txt;
        break;
      }
    }
  }

  // Also try legend text  e.g. "NAUKRI, 1D, NSE: Open 1290.00 …"
  const legendLineEl = document.querySelector('.pane-legend-line, [class*="legendLine-"], [class*="legend-line"]');
  const legendText = legendLineEl ? (legendLineEl.innerText || '') : '';
  const tfFromLegend = legendText.match(/\b(1D|1W|1M|5m|15m|1h|4h|1MTH|D|W)\b/i);
  if (tfFromLegend) timeframe = tfFromLegend[1].toUpperCase();

  // 5. OHLC from symbol-scoped legend line
  let legendContainer = null;
  const legendLineEls = document.querySelectorAll(
    '.pane-legend-line, [class*="legendLine-"], [class*="legend-line"], [class*="legend-item"], [class*="item-"]'
  );

  if (legendLineEls.length > 0) {
    // Search for legend line containing the exact active ticker
    for (const lineEl of legendLineEls) {
      const lineText = (lineEl.innerText || '').toUpperCase();
      if (ticker !== 'UNKNOWN' && lineText.includes(ticker)) {
        legendContainer = lineEl;
        break;
      }
    }

    // Fallback: pick legend line that is NOT an index or indicator if ticker is a stock
    if (!legendContainer && ticker !== 'UNKNOWN') {
      const isTickerIndex = /NIFTY|BANKNIFTY|SENSEX|FINNIFTY/i.test(ticker);
      for (const lineEl of legendLineEls) {
        const lineText = (lineEl.innerText || '').toUpperCase();
        if (!isTickerIndex && (lineText.includes('NIFTY') || lineText.includes('SENSEX') || lineText.includes('BANKNIFTY'))) {
          continue;
        }
        if (lineText.includes('MA') || lineText.includes('RSI') || lineText.includes('MACD') || lineText.includes('VOL')) {
          continue;
        }
        legendContainer = lineEl;
        break;
      }
    }
  }

  if (!legendContainer) {
    legendContainer = document.querySelector('.pane-legend-line, [class*="legendLine-"], [class*="legend-line"]') || document;
  }

  // Parse OHLC values scoped to legendContainer
  const containerText = legendContainer === document ? '' : (legendContainer.innerText || '');
  const ohlcMatch = containerText.match(/(?:O|Open)[:\s]+([\d,.]+).*?(?:H|High)[:\s]+([\d,.]+).*?(?:L|Low)[:\s]+([\d,.]+).*?(?:C|Close)[:\s]+([\d,.]+)/i);
  if (ohlcMatch) {
    const o = parseFloat(ohlcMatch[1].replace(/,/g, ''));
    const h = parseFloat(ohlcMatch[2].replace(/,/g, ''));
    const l = parseFloat(ohlcMatch[3].replace(/,/g, ''));
    const c = parseFloat(ohlcMatch[4].replace(/,/g, ''));
    if (!isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c) && c >= 0.05 && c <= 1000000) {
      openPrice = o; highPrice = h; lowPrice = l; closePrice = c;
    }
  }

  if (!closePrice) {
    const legendValEls = legendContainer.querySelectorAll(
      '.pane-legend-item-value, [class*="legendValue"], [class*="value-"]'
    );
    const validPrices = [];
    Array.from(legendValEls).forEach(el => {
      const text = (el.innerText || '').trim().replace(/,/g, '');
      if (/[MKBmkb]$/.test(text)) return;
      const num = parseFloat(text);
      if (!isNaN(num) && num >= 0.05 && num <= 1000000) {
        validPrices.push(num);
      }
    });

    if (validPrices.length >= 4) {
      [openPrice, highPrice, lowPrice, closePrice] = validPrices;
    } else if (validPrices.length === 1) {
      closePrice = validPrices[0];
    }
  }

  // 6. Fallback LTP for close — Kite + Groww selectors
  if (!closePrice || isNaN(closePrice)) {
    const ltpEl = document.querySelector(
      '.last-price, .ltp, .price, [class*="lastPrice"], [class*="last-price"],' +
      // Groww-specific price elements
      '[class*="currentPrice"], [class*="liveprice"], [class*="live-price"],' +
      '[class*="stockPrice"], [class*="stock-price"]'
    );
    if (ltpEl) {
      const parsedLtp = parseFloat((ltpEl.innerText || '').replace(/,/g, '').replace(/[^0-9.]/g, ''));
      if (!isNaN(parsedLtp) && parsedLtp >= 1 && parsedLtp <= 100000) {
        closePrice = parsedLtp;
      }
    }
  }

  // Synthesize missing OHLC from close if needed
  if (closePrice && (!openPrice || isNaN(openPrice))) {
    openPrice = closePrice * 0.998;
    highPrice = closePrice * 1.002;
    lowPrice  = closePrice * 0.996;
  }

  return { ticker, timeframe, openPrice, highPrice, lowPrice, closePrice };
}

// ─── Pattern Evaluation (3-candle buffer) ────────────────────────────────────
function evaluatePatterns(buffer, meta) {
  if (!buffer || buffer.length < 1) return [];
  const len = buffer.length;
  const c3 = buffer[len - 1];
  const c2 = len >= 2 ? buffer[len - 2] : null;
  const c1 = len >= 3 ? buffer[len - 3] : null;

  const O3 = c3.open, H3 = c3.high, L3 = c3.low, C3 = c3.close;
  const body3  = Math.abs(C3 - O3);
  const range3 = (H3 - L3) || 0.0001;
  const upper3 = H3 - Math.max(O3, C3);
  const lower3 = Math.min(O3, C3) - L3;

  const patterns = [];
  const candleDate   = c3.time ? new Date(c3.time) : new Date();
  const dateFormatted = `${candleDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${candleDate.toLocaleTimeString('en-GB')}`;

  const makePattern = (name, category, shortCode, strengthScore, changePct) => ({
    id: `pat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    ticker:        meta.ticker,
    timeframe:     meta.timeframe,
    pattern_name:  name,
    category,
    shortCode,
    trigger_time:  dateFormatted,
    close:  C3.toFixed(2),
    open:   O3.toFixed(2),
    high:   H3.toFixed(2),
    low:    L3.toFixed(2),
    c1: c1 ? { open: c1.open.toFixed(2), high: c1.high.toFixed(2), low: c1.low.toFixed(2), close: c1.close.toFixed(2) } : null,
    c2: c2 ? { open: c2.open.toFixed(2), high: c2.high.toFixed(2), low: c2.low.toFixed(2), close: c2.close.toFixed(2) } : null,
    c3: { open: O3.toFixed(2), high: H3.toFixed(2), low: L3.toFixed(2), close: C3.toFixed(2) },
    change_pct:    changePct >= 0 ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`,
    strength_ratio:`${(strengthScore / 35).toFixed(1)}x AVG`,
    description:   `Pattern ${name} formed on ${meta.ticker} (${meta.timeframe}) at ₹${C3.toFixed(2)}.`
  });

  const priceChange = ((C3 - O3) / O3) * 100;

  // ── Single-candle patterns ───────────────────────────────────────────────
  if (body3 / range3 <= 0.08 && upper3 > 0.1 * range3 && lower3 > 0.1 * range3)
    patterns.push(makePattern('Standard Doji',       'NEUTRAL', 'DOJI',    82, priceChange));

  if (body3 / range3 > 0.08 && body3 / range3 <= 0.30 && upper3 >= body3 && lower3 >= body3)
    patterns.push(makePattern('Spinning Top',         'NEUTRAL', 'SPIN',    78, priceChange));

  if (body3 / range3 <= 0.10 && (range3 / C3) >= 0.012 && upper3 >= 0.3 * range3 && lower3 >= 0.3 * range3)
    patterns.push(makePattern('Long-Legged Doji',     'NEUTRAL', 'LLDOJI',  86, priceChange));

  if (body3 / range3 <= 0.10 && lower3 / range3 <= 0.15 && upper3 / range3 >= 0.60)
    patterns.push(makePattern('Gravestone Doji',      'BEARISH', 'GDOJI',   89, priceChange));

  if (upper3 >= 2.0 * body3 && lower3 <= 0.4 * body3 && body3 / range3 <= 0.35)
    patterns.push(makePattern('Inverted Hammer',      'BULLISH', 'INVH',    87, priceChange));

  if (lower3 >= 2.0 * body3 && upper3 <= 0.4 * body3 && body3 / range3 <= 0.35)
    patterns.push(makePattern('Hammer',               'BULLISH', 'HAMR',    91, priceChange));

  if (upper3 >= 2.0 * body3 && lower3 <= 0.4 * body3 && C3 <= O3)
    patterns.push(makePattern('Shooting Star',        'BEARISH', 'STAR',    88, priceChange));

  // ── Two-candle patterns ──────────────────────────────────────────────────
  if (c2) {
    const O2 = c2.open, C2 = c2.close;
    const mid2 = (O2 + C2) / 2;

    if (C2 < O2 && C3 > O3 && O3 <= C2 && C3 >= O2)
      patterns.push(makePattern('Bullish Engulfing',  'BULLISH', 'BULL_ENG',  94, priceChange));

    if (C2 > O2 && C3 < O3 && O3 >= C2 && C3 <= O2)
      patterns.push(makePattern('Bearish Engulfing',  'BEARISH', 'BEAR_ENG',  93, priceChange));

    if (C2 < O2 && C3 > O3 && O3 < C2 && C3 > mid2 && C3 < O2)
      patterns.push(makePattern('Piercing Line',      'BULLISH', 'PIERCING',  85, priceChange));

    if (C2 > O2 && C3 < O3 && O3 > c2.high && C3 < mid2 && C3 > O2)
      patterns.push(makePattern('Dark Cloud Cover',   'BEARISH', 'DARK_CLOUD',86, priceChange));
  }

  // ── Three-candle patterns ────────────────────────────────────────────────
  if (c1 && c2) {
    const O1 = c1.open, C1 = c1.close;
    const O2 = c2.open, C2 = c2.close;
    const body2 = Math.abs(C2 - O2);
    const mid1  = (O1 + C1) / 2;

    if (C1 < O1 && body2 / (Math.abs(c2.high - c2.low) || 1) <= 0.3 && C3 > O3 && C3 >= mid1)
      patterns.push(makePattern('Morning Star',         'BULLISH', 'MORN_STAR', 95, priceChange));

    if (C1 > O1 && body2 / (Math.abs(c2.high - c2.low) || 1) <= 0.3 && C3 < O3 && C3 <= mid1)
      patterns.push(makePattern('Evening Star',         'BEARISH', 'EVE_STAR',  92, priceChange));

    if (C1 > O1 && C2 > O2 && C3 > O3 && C2 > C1 && C3 > C2 && O2 >= O1 && O3 >= O2)
      patterns.push(makePattern('Three White Soldiers', 'BULLISH', '3SOLDIERS', 96, priceChange));

    if (C1 < O1 && C2 < O2 && C3 < O3 && C2 < C1 && C3 < C2 && O2 <= O1 && O3 <= O2)
      patterns.push(makePattern('Three Black Crows',    'BEARISH', '3CROWS',    95, priceChange));
  }

  return patterns;
}

// ─── Main Scan Function ───────────────────────────────────────────────────────
async function scan() {
  // Only scan and emit pattern telemetry if running on dedicated /ext/ pop-out chart tab
  if (!isExtChartTab()) return;
  const enabled = await isExtensionEnabled();
  if (!enabled) return; // Master ON/OFF toggle: halt scanning when OFF

  const meta = parseChartDOM();

  // ── 1. Detect ticker / timeframe change → full reset ─────────────────────
  if (meta.ticker !== 'UNKNOWN') {
    const tickerChanged    = lastKnownTicker    !== null && meta.ticker    !== lastKnownTicker;
    const timeframeChanged = lastKnownTimeframe !== null && meta.timeframe !== lastKnownTimeframe;

    if (tickerChanged || timeframeChanged) {
      resetState(meta.ticker, meta.timeframe);
    }
    lastKnownTicker    = meta.ticker;
    lastKnownTimeframe = meta.timeframe;
  }

  // ── 2. Heartbeat to background (always, so popup stays in sync) ──────────
  // Include closePrice so background can persist real DOM prices per ticker.
  // This is the source of truth — no hardcoded map can be as accurate as the live chart DOM.
  try {
    chrome.runtime.sendMessage({
      type:       'SET_ACTIVE_TICKER',
      ticker:     meta.ticker,
      timeframe:  meta.timeframe,
      marketOpen: isMarketOpen(),
      closePrice: meta.closePrice || null, // real price from chart DOM legend
      isExt:      true,
      url:        window.location.href
    }).catch(() => {});
  } catch (e) {}

  // ── 3. Skip price capture if OHLC is not readable ─────────────────────────
  if (!meta.closePrice || isNaN(meta.closePrice)) return;

  // ── 4. Build candle buffer from live visible chart price stream ───────────
  const currentCandle = {
    open:  meta.openPrice,
    high:  meta.highPrice,
    low:   meta.lowPrice,
    close: meta.closePrice,
    time:  Date.now()
  };

  // Only add if price has meaningfully changed from the last captured candle
  if (candleHistory.length === 0) {
    candleHistory.push(currentCandle);
  } else {
    const last = candleHistory[candleHistory.length - 1];
    const priceDelta = Math.abs(currentCandle.close - last.close);
    const minDelta = last.close * 0.0003; // 0.03% minimum change to register new candle
    if (priceDelta >= minDelta) {
      candleHistory.push(currentCandle);
    } else {
      // Update the last candle's OHLC to reflect the latest tick
      last.close = currentCandle.close;
      last.high  = Math.max(last.high, currentCandle.high);
      last.low   = Math.min(last.low, currentCandle.low);
    }
  }
  // Keep rolling buffer of last 10 candles
  if (candleHistory.length > 10) candleHistory.shift();

  // ── 5. Dedup: skip if price hasn't changed since last emission ───────────
  const key = `${meta.ticker}_${meta.timeframe}_${meta.closePrice.toFixed(2)}`;
  if (key === lastEmittedKey) return;
  lastEmittedKey = key;

  // ── 6. Detect patterns and emit only new ones ─────────────────────────────
  const detected = evaluatePatterns(candleHistory, meta);

  for (const p of detected) {
    // Dedup key: ticker + pattern name + candle close price (rounded to 2dp)
    // Intentionally excludes timestamp — same pattern at same price must NEVER re-alert
    const patKey = `${p.ticker}_${p.timeframe}_${p.pattern_name}_${parseFloat(p.close).toFixed(2)}`;
    if (emittedPatternKeys.has(patKey)) continue;
    await markPatternEmitted(patKey);
    // Stamp exact detection epoch for popup elapsed-time badge (LIVE → Xm ago → HIST)
    p.detected_at = Date.now();
    // source is undefined here (not 'historical_scan') → background will fire notification
    console.log(`🔔 [Pattern Radar] LIVE: ${p.pattern_name} on ${p.ticker} at ${p.trigger_time} | ₹${p.close}`);
    try {
      chrome.runtime.sendMessage({ type: 'PATTERN_DETECTED', pattern: p }).catch(() => {});
    } catch (e) {}
  }
}

// ─── Adaptive Scan Interval ──────────────────────────────────────────────────
// During market hours: 1.5s fast scan; outside market hours: 10s idle scan
let scanIntervalId = null;

function restartScanInterval() {
  if (scanIntervalId) clearInterval(scanIntervalId);
  const interval = isMarketOpen() ? 1500 : 10000;
  scanIntervalId = setInterval(() => {
    scan();
    // Re-check interval every cycle — market might open/close
    const newInterval = isMarketOpen() ? 1500 : 10000;
    if (newInterval !== interval) restartScanInterval();
  }, interval);
}

// ─── DOM Mutation Observer for instant reaction to chart DOM changes ──────────
// Debounced: coalesce rapid DOM bursts (e.g. chart legend updates 50x/s) into
// a single scan call every 1 second to prevent notification spam.
let mutationDebounceTimer = null;
const observer = new MutationObserver(() => {
  if (!isMarketOpen()) return;
  if (mutationDebounceTimer) return; // already pending
  mutationDebounceTimer = setTimeout(() => {
    mutationDebounceTimer = null;
    scan();
  }, 1000); // coalesce all mutations within 1s into one scan
});

observer.observe(document.body, { childList: true, subtree: true, characterData: true });

// ─── Init ─────────────────────────────────────────────────────────────────────
scan();
restartScanInterval();

// Run historical chart scan after 3s — gives the chart time to fully render
// before we simulate hover events to read OHLC from the legend.
setTimeout(() => scanHistoricalCandles(), 3000);

// ─── FORCE_RESCAN: triggered by popup Refresh button via background ───────────
// Wipes all in-memory state (candle buffer, emitted keys, last price dedup)
// and re-starts the full scan pipeline from scratch — as if the page just loaded.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'FORCE_RESCAN') return;
  if (!isExtChartTab()) { sendResponse({ status: 'not_a_chart_tab' }); return; }

  console.log('🔄 [Pattern Radar] FORCE_RESCAN received — resetting all in-memory state...');

  // 1. Wipe in-memory state
  candleHistory    = [];
  lastEmittedKey   = null;
  lastKnownTicker  = null;
  lastKnownTimeframe = null;
  emittedPatternKeys.clear();

  // 2. Wipe persisted dedup keys (storage cleared by background already)
  try { chrome.storage.local.remove('persistedPatternKeys'); } catch (e) {}

  // 3. Restart the scan interval fresh
  restartScanInterval();

  // 4. Immediately scan and schedule historical candle re-scan after DOM settles
  scan();
  setTimeout(() => scanHistoricalCandles(), 1500);

  sendResponse({ status: 'rescan_started' });
});
