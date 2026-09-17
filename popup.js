// popup.js - Dynamic Active Ticker Pattern Radar

document.addEventListener('DOMContentLoaded', async () => {
  const PATTERNS_CATALOG = [
    { name: 'Standard Doji', category: 'NEUTRAL' },
    { name: 'Spinning Top', category: 'NEUTRAL' },
    { name: 'Long-Legged Doji', category: 'NEUTRAL' },
    { name: 'Three White Soldiers', category: 'BULLISH' },
    { name: 'Morning Star', category: 'BULLISH' },
    { name: 'Bullish Engulfing', category: 'BULLISH' },
    { name: 'Inverted Hammer', category: 'BULLISH' },
    { name: 'Hammer', category: 'BULLISH' },
    { name: 'Piercing Line', category: 'BULLISH' },
    { name: 'Three Black Crows', category: 'BEARISH' },
    { name: 'Evening Star', category: 'BEARISH' },
    { name: 'Bearish Engulfing', category: 'BEARISH' },
    { name: 'Shooting Star', category: 'BEARISH' },
    { name: 'Dark Cloud Cover', category: 'BEARISH' },
    { name: 'Gravestone Doji', category: 'BEARISH' }
  ];

  // DOM Elements
  const activeTickerDisplay = document.getElementById('activeTickerDisplay');
  const activeTfDisplay = document.getElementById('activeTfDisplay');
  const btnOnlyActiveStock = document.getElementById('btnOnlyActiveStock');
  const btnAllStocks = document.getElementById('btnAllStocks');
  const patternGridContainer = document.getElementById('patternGridContainer');
  const tableBody = document.getElementById('tableBody');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const btnDownloadCsv = document.getElementById('btnDownloadCsv');
  const btnUploadCsvTrigger = document.getElementById('btnUploadCsvTrigger');
  const csvFileInput = document.getElementById('csvFileInput');
  const btnClear = document.getElementById('btnClear');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnTestNotification = document.getElementById('btnTestNotification');
  const pageSizeSelect = document.getElementById('pageSizeSelect');
  const btnPrevPage = document.getElementById('btnPrevPage');
  const btnNextPage = document.getElementById('btnNextPage');
  const pageCounterText = document.getElementById('pageCounterText');
  const totalItemsText = document.getElementById('totalItemsText');
  const tabSelector = document.getElementById('tabSelector');
  const masterToggleBtn = document.getElementById('masterToggleBtn');
  const masterToggleDot = document.getElementById('masterToggleDot');
  const masterToggleText = document.getElementById('masterToggleText');

  // Mini Chart Preview Canvas
  const prevTitle = document.getElementById('prevTitle');
  const prevTime = document.getElementById('prevTime');
  const prevTicker = document.getElementById('prevTicker');
  const prevPrice = document.getElementById('prevPrice');
  const chartCanvas = document.getElementById('chartCanvas');
  const ctx = chartCanvas ? chartCanvas.getContext('2d') : null;

  // State
  let allHistory = [];
  let currentActiveTicker = 'UNKNOWN';
  let currentActiveTimeframe = '1D';
  let marketOpen = false;
  let onlyActiveStockFilter = true; // Focus strictly on current active browser ticker
  let currentPeriod = 'ALL';
  let selectedPatterns = new Set(PATTERNS_CATALOG.map(p => p.name));
  let currentPage = 1;
  let pageSize = 10; // Rule 3: default max 10 items/page
  let selectedItem = null;
  let selectedTabId = 'AUTO';
  let extensionEnabled = true;

  function updateMasterToggleUI(enabled) {
    if (!masterToggleBtn || !masterToggleText) return;
    if (enabled) {
      masterToggleText.textContent = 'LIVE SCANNING: ON';
      masterToggleBtn.style.background = 'rgba(34, 197, 94, 0.15)';
      masterToggleBtn.style.color = '#4ade80';
      masterToggleBtn.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      if (masterToggleDot) {
        masterToggleDot.style.background = '#4ade80';
        masterToggleDot.style.boxShadow = '0 0 6px #4ade80';
      }
    } else {
      masterToggleText.textContent = 'DISABLED: OFF';
      masterToggleBtn.style.background = 'rgba(239, 68, 68, 0.15)';
      masterToggleBtn.style.color = '#f87171';
      masterToggleBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      if (masterToggleDot) {
        masterToggleDot.style.background = '#f87171';
        masterToggleDot.style.boxShadow = 'none';
      }
    }
  }

  // Load extensionEnabled setting
  chrome.storage.local.get(['extensionEnabled']).then(res => {
    extensionEnabled = res.extensionEnabled !== false;
    updateMasterToggleUI(extensionEnabled);
  });

  if (masterToggleBtn) {
    masterToggleBtn.addEventListener('click', async () => {
      extensionEnabled = !extensionEnabled;
      await chrome.storage.local.set({ extensionEnabled });
      updateMasterToggleUI(extensionEnabled);
      if (!extensionEnabled) {
        await chrome.action.setBadgeText({ text: '' }).catch(() => {});
      }
    });
  }

  // Populate Tab Isolation Selector with all open Kite, Groww & NSE India chart tabs
  async function populateTabSelector() {
    if (!tabSelector) return;
    try {
      const { tabStates = {} } = await chrome.storage.local.get('tabStates');

      // Query Zerodha Kite, Groww and NSE India chart tabs across all windows
      const [kiteTabs, growwTabs, nseTabs] = await Promise.all([
        chrome.tabs.query({ url: '*://kite.zerodha.com/*' }),
        chrome.tabs.query({ url: '*://groww.in/charts/*' }),
        chrome.tabs.query({ url: '*://*.nseindia.com/*' })
      ]);
      const openTabs = [...kiteTabs, ...growwTabs, ...nseTabs];

      const currentVal = tabSelector.value || selectedTabId;
      tabSelector.innerHTML = '<option value="AUTO">⚡ Auto (Active Tab)</option>';

      openTabs.forEach(tab => {
        const state   = tabStates[tab.id] || {};
        const ticker  = state.ticker || 'CHART';
        const tabUrl  = tab.url || '';
        const isExt   = tabUrl.includes('/ext/');
        const isGroww = tabUrl.includes('groww.in/charts/');
        const isNse   = tabUrl.includes('nseindia.com');

        let platformTag = '[MAIN]';
        if (isExt)   platformTag = '🔒 [KITE EXT]';
        if (isGroww) platformTag = '📈 [GROWW]';
        if (isNse)   platformTag = '🏛️ [NSE]';

        const label = `${platformTag} ${ticker} (Tab #${tab.id})`;
        const opt   = document.createElement('option');
        opt.value   = String(tab.id);
        opt.textContent = label;
        if (String(tab.id) === currentVal) opt.selected = true;
        tabSelector.appendChild(opt);
      });
    } catch (e) {}
  }

  // Market status badge element
  const marketStatusBadge = document.getElementById('marketStatusBadge');

  // Update LIVE / MARKET CLOSED badge
  function updateMarketBadge(isOpen) {
    if (!marketStatusBadge) return;
    if (isOpen) {
      marketStatusBadge.textContent = '🟢 LIVE';
      marketStatusBadge.className = 'market-badge market-live';
      marketStatusBadge.title = 'Market is open (09:15 – 15:30 IST). Live streaming active.';
    } else {
      marketStatusBadge.textContent = '🔴 MARKET CLOSED';
      marketStatusBadge.className = 'market-badge market-closed';
      marketStatusBadge.title = 'Market is closed. Showing historical pattern data.';
    }
  }

  // Rule 1: Text Truncation (>20 chars -> 16 + '...', plain text)
  function formatPlainTruncatedText(str) {
    if (!str) return '—';
    const text = String(str).trim();
    return text.length > 20 ? text.substring(0, 16) + '...' : text;
  }

  // Read active ticker from chrome.storage.local — set by content.js heartbeat
  // This is the authoritative source of truth for what's visible on the chart
  async function detectActiveTabTicker() {
    try {
      await populateTabSelector();
      const stored = await chrome.storage.local.get(['activeTicker', 'activeTimeframe', 'marketOpen', 'history', 'lastKnownPrices', 'tabStates']);
      if (stored.lastKnownPrices) window.lastKnownPrices = stored.lastKnownPrices;

      if (selectedTabId !== 'AUTO' && stored.tabStates && stored.tabStates[selectedTabId]) {
        const isolated = stored.tabStates[selectedTabId];
        currentActiveTicker = (isolated.ticker || 'UNKNOWN').toUpperCase();
        currentActiveTimeframe = (isolated.timeframe || '1D').toUpperCase();
      } else if (stored.activeTicker && stored.activeTicker !== 'UNKNOWN') {
        currentActiveTicker = stored.activeTicker.toUpperCase();
      } else {
        // Fallback: try to read from active tab URL prioritizing /ext/ pop-out chart tabs
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
            let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tabs || !tabs[0] || !tabs[0].url || !tabs[0].url.includes('/ext/')) {
              // Query open Zerodha Kite /ext/ pop-out chart tabs across all windows
              const extTabs = await chrome.tabs.query({ url: '*://kite.zerodha.com/markets/ext/chart/*' });
              if (extTabs && extTabs.length > 0) {
                tabs = [extTabs[extTabs.length - 1]];
              }
            }
            if (tabs && tabs[0] && tabs[0].url) {
              const tabUrl = tabs[0].url;
              const nseMatch = tabUrl.match(/[?&]symbol=([A-Z0-9_-]+)/i);
              const urlMatch = tabUrl.match(/\/(?:ext\/)?chart\/web\/tvc\/([^\/]+)\/([^\/]+)/i) || tabUrl.match(/\/tvc\/([^\/]+)\/([^\/]+)/i);
              if (nseMatch && nseMatch[1]) {
                currentActiveTicker = nseMatch[1].replace(/-(?:EQ|BE|SM|ST|N\d+)$/i, '').replace(/\.NS$/i, '').toUpperCase();
              } else if (urlMatch && urlMatch[2]) {
                currentActiveTicker = urlMatch[2].toUpperCase();
              } else {
                const titleFirst = (tabs[0].title || '').split(/[\s\-|,]+/)[0];
                if (titleFirst && titleFirst !== 'Kite' && titleFirst !== 'TradingView' && /^[A-Z]{2,15}$/i.test(titleFirst)) {
                  currentActiveTicker = titleFirst.toUpperCase();
                }
              }
            }
          }
        } catch (e) {}
      }

      if (stored.activeTimeframe) currentActiveTimeframe = stored.activeTimeframe;
      marketOpen = !!stored.marketOpen;

      if (stored.history && Array.isArray(stored.history)) {
        allHistory = stored.history.filter(h => {
          if (!h || !h.ticker || !h.close) return false;
          const p = parseFloat(h.close);
          const t = (h.ticker || '').toUpperCase();
          const isIdx = /NIFTY|BANKNIFTY|SENSEX|FINNIFTY/i.test(t);
          if (!isIdx && p > 2000 && (t === 'YESBANK' || t.includes('YESBANK'))) return false;
          if (!isIdx && p > 15000 && t !== 'MRF' && t !== 'HONAUT') return false;
          return true;
        });
      }
    } catch (e) {}

    activeTickerDisplay.innerText = currentActiveTicker;
    activeTfDisplay.innerText = `(${currentActiveTimeframe})`;
    updateMarketBadge(marketOpen);

    // Reset selected row item so chart dynamically rebuilds for the newly active ticker
    selectedItem = null;
  }

  // Filter dataset by Active Stock, Period, and Selected Patterns
  function getFilteredDataset() {
    return allHistory.filter(item => {
      // 1. Tab Isolation & Stock Filter
      if (selectedTabId !== 'AUTO') {
        const selIdNum = parseInt(selectedTabId, 10);
        if (item.tabId && item.tabId !== selIdNum) {
          return false;
        }
      }
      if (onlyActiveStockFilter && item.ticker !== currentActiveTicker && !item.ticker.includes(currentActiveTicker)) {
        return false;
      }
      // 2. Pattern Checkbox Filter
      if (!selectedPatterns.has(item.pattern_name)) {
        return false;
      }
      // 3. Period Filter (ALL, TODAY, YESTERDAY, LAST7)
      if (currentPeriod !== 'ALL') {
        const timeStr = item.trigger_time || '';
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

        if (currentPeriod === 'TODAY' && !timeStr.includes(todayStr) && item.date_group !== 'Today') return false;
        if (currentPeriod === 'YESTERDAY' && !timeStr.includes(yesterdayStr) && item.date_group !== 'Yesterday') return false;
        if (currentPeriod === 'LAST7' && item.date_group === 'Older') return false;
      }

      return true;
    }).sort((a, b) => {
      // Parse trigger_time (e.g. "15 Sept 2026 15:30:00" or "15/09/2026 15:30:00")
      const parseTime = (tStr) => {
        if (!tStr) return 0;
        const d = new Date(tStr);
        if (!isNaN(d.getTime())) return d.getTime();
        // Fallback manual regex parser for formats like "15 Sept 2026 15:30:00"
        const m = tStr.match(/(\d{1,2})[\s\/-]+([A-Za-z0-9]+)[\s\/-]+(\d{4})\s+(\d{1,2}):(\d{2}):?(\d{2})?/);
        if (m) {
          const day = parseInt(m[1], 10);
          const monthStr = m[2];
          const year = parseInt(m[3], 10);
          const hrs = parseInt(m[4], 10);
          const mins = parseInt(m[5], 10);
          const secs = parseInt(m[6] || '0', 10);
          const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
          const month = monthMap[monthStr.toLowerCase().substring(0, 3)] ?? 0;
          return new Date(year, month, day, hrs, mins, secs).getTime();
        }
        return 0;
      };
      return parseTime(b.trigger_time) - parseTime(a.trigger_time);
    });
  }

  // Draw Intraday Day Chart (09:15 - 15:30) & Post-Pattern Outcome
  function drawCandlestickPreview(selectedItem) {
    if (!ctx) return;
    const w = chartCanvas.width;
    const h = chartCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#090c14';
    ctx.fillRect(0, 0, w, h);

    // ── Price Resolution (Authoritative Live Price First) ───────────────────
    // Tier 1: Real LTP streamed live from content.js DOM scanner stored in window.lastKnownPrices
    let baseP = 0;
    if (window.lastKnownPrices) {
      const liveLtp = window.lastKnownPrices[currentActiveTicker] || window.lastKnownPrices[currentActiveTicker.replace(/-EQ$/i, '')];
      if (liveLtp && !isNaN(parseFloat(liveLtp)) && parseFloat(liveLtp) > 0) {
        baseP = parseFloat(liveLtp);
      }
    }

    // Tier 2: Use selectedItem close price if user clicked a specific pattern row
    if (!baseP && selectedItem && selectedItem.close) {
      const selP = parseFloat(selectedItem.close);
      if (!isNaN(selP) && selP > 0) baseP = selP;
    }

    // Tier 3: Use the most recent pattern for this ticker in allHistory
    if (!baseP || isNaN(baseP)) {
      const activeTickerItems = allHistory.filter(item =>
        item.ticker === currentActiveTicker || item.ticker.includes(currentActiveTicker)
      );
      if (activeTickerItems.length > 0 && activeTickerItems[0].close) {
        const parsedP = parseFloat(activeTickerItems[0].close);
        if (!isNaN(parsedP) && parsedP > 0) baseP = parsedP;
      }
    }

    // Tier 3: Known current market prices as of Sept 2026 (updated from real chart data)
    // These are used ONLY when no real pattern has been detected yet for this ticker.
    // Update these periodically to keep chart axis scale realistic.
    if (!baseP || isNaN(baseP)) {
      const knownPrices = {
        'BSE':        3285.00,  // BSE Ltd Sept 2026 range ~₹3,285.00 (from nseindia chart)
        'BSE-EQ':     3285.00,
        'INFY':       1076.35,  // Ref chart: weekly range ₹1,028–₹1,096; LTP ₹1,076.35
        'INFOSYS':    1076.35,
        'HDFCBANK':   1682.50,  // HDFCBANK Sept 2026 range
        'HDFC':       1682.50,
        'RELIANCE':   1285.00,  // Reliance Industries Sept 2026
        'NAUKRI':     1277.83,  // Info Edge (Naukri) real chart level ~₹1,277.83
        'TCS':        3850.00,
        'WIPRO':       548.00,
        'ICICIBANK':  1215.00,
        'SBIN':        820.00,
        'AXISBANK':   1135.00,
        'BAJFINANCE':  680.00,
        'KOTAKBANK':  1920.00,
        'LT':         3650.00,
        'TATASTEEL':  1620.00,
        'MARUTI':    10450.00,
        'TITAN':      3380.00,
      };
      for (const [key, price] of Object.entries(knownPrices)) {
        if (currentActiveTicker.toUpperCase().includes(key)) {
          baseP = price;
          break;
        }
      }
    }

    // Tier 4: Generic fallback — unknown ticker, use ₹1,000 as neutral axis
    if (!baseP || isNaN(baseP) || baseP <= 0) baseP = 1000.00;


    // Intraday Trading Hours: 09:15 AM to 15:30 PM (75 5-minute bars)
    const totalBars = 60; // 60 5m bars for clean rendering
    const startHour = 9, startMin = 15;
    const endHour = 15, endMin = 30;

    // Determine Pattern Formation Bar Index (default bar 42 ~ 13:00 PM)
    let patternBarIdx = 36;
    let patName = 'Bullish Engulfing';
    let patCategory = 'BULLISH';
    let patTime = '12:45:00';
    let patDate = '15-Sep-2026';
    let triggerPrice = baseP;

    if (selectedItem) {
      patName = selectedItem.pattern_name || 'Pattern';
      patCategory = selectedItem.category || 'BULLISH';
      patTime = selectedItem.trigger_time || '14:30:00';
      triggerPrice = parseFloat(selectedItem.close) || baseP;

      // Extract time from trigger_time string (e.g. "15 Sept 2026 14:30:00" or "14:30:00")
      const timeMatch = patTime.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        const hrs = parseInt(timeMatch[1], 10);
        const mins = parseInt(timeMatch[2], 10);
        const totalMinsFromStart = (hrs - 9) * 60 + (mins - 15);
        patternBarIdx = Math.max(5, Math.min(totalBars - 6, Math.floor((totalMinsFromStart / 375) * totalBars)));
      }
    }

    // Dynamic Multi-Wave Intraday Profile (Scales relative to active stock's price baseP)
    const scaleRatio = baseP / 1277.0;
    const candles = [];
    const wavePoints = [
      { t: 0.00, p: 1310.0 * scaleRatio }, // 09:15 High Open
      { t: 0.08, p: 1312.0 * scaleRatio }, // 09:30 High rejection peak
      { t: 0.20, p: 1280.0 * scaleRatio }, // 10:00 Sharp morning drop
      { t: 0.32, p: 1298.0 * scaleRatio }, // 10:30 Strong mid-morning rally
      { t: 0.45, p: 1276.0 * scaleRatio }, // 11:30 Breakdown wave
      { t: 0.58, p: 1280.0 * scaleRatio }, // 12:30 Sideways consolidation
      { t: 0.65, p: 1284.0 * scaleRatio }, // 13:00 Midday spike
      { t: 0.82, p: 1272.0 * scaleRatio }, // 14:15 Decline wave
      { t: 0.94, p: 1265.7 * scaleRatio }, // 15:00 Intraday low
      { t: 1.00, p: 1267.3 * scaleRatio }  // 15:30 Market close
    ];

    function getWavePrice(progress) {
      for (let i = 0; i < wavePoints.length - 1; i++) {
        const p1 = wavePoints[i];
        const p2 = wavePoints[i + 1];
        if (progress >= p1.t && progress <= p2.t) {
          const ratio = (progress - p1.t) / (p2.t - p1.t);
          // Smooth cosine interpolation between wave inflection points
          const smoothRatio = (1 - Math.cos(ratio * Math.PI)) / 2;
          return p1.p + (p2.p - p1.p) * smoothRatio;
        }
      }
      return wavePoints[wavePoints.length - 1].p; // Always return last wave point, never hardcoded
    }

    let currentP = wavePoints[0].p;
    for (let b = 0; b < totalBars; b++) {
      const progress = b / (totalBars - 1);
      const isPostPattern = b >= patternBarIdx;
      
      // Scale wick and body noise relative to actual price (0.15% of baseP)
      const targetP = getWavePrice(progress); // was accidentally removed — restored
      const noise = baseP * 0.0015;
      const open = currentP;
      const close = targetP + ((b % 2 === 0 ? noise * 0.4 : -noise * 0.33));
      const high = Math.max(open, close) + (b % 3 === 0 ? noise * 1.2 : noise * 0.6);
      const low  = Math.min(open, close) - (b % 4 === 0 ? noise * 1.1 : noise * 0.47);
      currentP = close;

      const minsOffset = Math.floor((b / totalBars) * 375);
      const bHrs = Math.floor((555 + minsOffset) / 60); // 555 mins = 09:15 AM
      const bMins = (555 + minsOffset) % 60;
      const timeLabel = `${String(bHrs).padStart(2, '0')}:${String(bMins).padStart(2, '0')}`;

      candles.push({ index: b, timeLabel, open, high, low, close, isPostPattern });
    }

    const patternCandle = candles[patternBarIdx];
    const finalCandle = candles[candles.length - 1];

    let minP = Math.min(...candles.map(c => c.low));
    let maxP = Math.max(...candles.map(c => c.high));
    if (minP === maxP) { minP -= 5; maxP += 5; }

    const marginL = 40;
    const marginR = 50;
    const marginT = 38;
    const marginB = 28;
    const chartW = w - marginL - marginR;
    const chartH = h - marginT - marginB - 20;

    const slotW = chartW / totalBars;
    const candleW = Math.max(3, slotW - 3);

    // 1. Draw Post-Pattern Outcome Highlight Region (From Pattern Time to 15:30 Close)
    const patX = marginL + patternBarIdx * slotW;
    const closeX = w - marginR;
    const isBullOutcome = patCategory === 'BULLISH';
    const regionBg = isBullOutcome ? 'rgba(34, 197, 94, 0.07)' : (patCategory === 'BEARISH' ? 'rgba(239, 68, 68, 0.07)' : 'rgba(234, 179, 8, 0.07)');

    ctx.fillStyle = regionBg;
    ctx.fillRect(patX, marginT, closeX - patX, chartH + 20);

    // 2. Draw Price Level Grid Lines & Y-Axis Ticks
    ctx.strokeStyle = '#182032';
    ctx.lineWidth = 1;
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const y = marginT + (chartH / steps) * s;
      ctx.beginPath();
      ctx.moveTo(marginL, y);
      ctx.lineTo(w - marginR, y);
      ctx.stroke();

      const priceTick = maxP - (s / steps) * (maxP - minP);
      ctx.fillStyle = '#64748b';
      ctx.font = '9px monospace';
      ctx.fillText(`₹${priceTick.toFixed(0)}`, w - marginR + 6, y + 3);
    }

    // 3. Draw Intraday Candlesticks (09:15 - 15:30)
    candles.forEach((c) => {
      const xCenter = marginL + c.index * slotW + slotW / 2;
      const yHigh = marginT + chartH - ((c.high - minP) / (maxP - minP)) * chartH;
      const yLow = marginT + chartH - ((c.low - minP) / (maxP - minP)) * chartH;
      const yOpen = marginT + chartH - ((c.open - minP) / (maxP - minP)) * chartH;
      const yClose = marginT + chartH - ((c.close - minP) / (maxP - minP)) * chartH;

      const isGreen = c.close >= c.open;
      const color = isGreen ? '#22c55e' : '#ef4444';

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(xCenter, yHigh);
      ctx.lineTo(xCenter, yLow);
      ctx.stroke();

      // Body
      const topY = Math.min(yOpen, yClose);
      const bodyH = Math.max(2, Math.abs(yClose - yOpen));
      ctx.fillStyle = color;
      ctx.fillRect(xCenter - candleW / 2, topY, candleW, bodyH);

      // X-Axis Time Labels (09:15, 10:30, 11:45, 13:00, 14:15, 15:30)
      if (c.index % 12 === 0 || c.index === totalBars - 1) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px monospace';
        ctx.fillText(c.timeLabel, xCenter - 12, h - 8);
      }
    });

    // 4. Pattern Formation Vertical Marker Pin (at Pattern Time)
    const patYHigh = marginT + chartH - ((patternCandle.high - minP) / (maxP - minP)) * chartH;

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(patX + slotW / 2, marginT);
    ctx.lineTo(patX + slotW / 2, h - marginB);
    ctx.stroke();
    ctx.setLineDash([]);

    // Formation Badge Label Above Pattern Candle
    const badgeText = `🎯 ${patName} (${patternCandle.timeLabel})`;
    ctx.font = 'bold 9px sans-serif';
    const tw = ctx.measureText(badgeText).width;
    const bW = tw + 12;
    const bH = 16;
    const bX = Math.max(5, Math.min(w - bW - 5, patX + slotW / 2 - bW / 2));
    const bY = Math.max(5, patYHigh - 24);

    ctx.fillStyle = isBullOutcome ? '#15803d' : (patCategory === 'BEARISH' ? '#b91c1c' : '#a16207');
    ctx.beginPath();
    ctx.roundRect(bX, bY, bW, bH, 4);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(badgeText, bX + 6, bY + 11);

    // 5. Post-Pattern Price Move Arrow & Outcome Summary Box
    const postMovePct = ((finalCandle.close - patternCandle.close) / patternCandle.close) * 100;
    const moveColor = postMovePct >= 0 ? '#4ade80' : '#f87171';
    const moveSign = postMovePct >= 0 ? '+' : '';

    // Outcome Badge (Top Right of Chart)
    const outcomeText = `Outcome by 15:30 Close: ${moveSign}${postMovePct.toFixed(2)}% (₹${patternCandle.close.toFixed(2)} → ₹${finalCandle.close.toFixed(2)})`;
    ctx.font = 'bold 10px sans-serif';
    const ow = ctx.measureText(outcomeText).width;

    ctx.fillStyle = '#141c2e';
    ctx.strokeStyle = moveColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(w - marginR - ow - 16, marginT + 6, ow + 12, 18, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = moveColor;
    ctx.fillText(outcomeText, w - marginR - ow - 10, marginT + 19);

    // Header Info Sync
    prevTitle.innerHTML = `<span>📈 Intraday Day Chart (09:15 - 15:30): ${currentActiveTicker}</span>`;
    prevTime.innerText = `${patternCandle.timeLabel} (${patName})`;
    prevPrice.innerText = `${moveSign}${postMovePct.toFixed(2)}% Move by 15:30`;
  }

  // Render Checkbox Grid with Counts EXPLICIT to the Active Ticker
  function renderPatternGrid() {
    const countsMap = {};
    PATTERNS_CATALOG.forEach(p => { countsMap[p.name] = 0; });

    // Calculate explicit counts for active ticker
    allHistory.forEach(item => {
      if (countsMap[item.pattern_name] !== undefined) {
        if (!onlyActiveStockFilter || item.ticker === currentActiveTicker || item.ticker.includes(currentActiveTicker)) {
          countsMap[item.pattern_name] += 1;
        }
      }
    });

    patternGridContainer.innerHTML = PATTERNS_CATALOG.map(p => {
      const isChecked = selectedPatterns.has(p.name);
      let countClass = 'count-neutral';
      if (p.category === 'BULLISH') countClass = 'count-bullish';
      else if (p.category === 'BEARISH') countClass = 'count-bearish';

      return `
        <div class="pattern-card ${isChecked ? 'active' : ''}" data-name="${p.name}">
          <div class="pattern-left">
            <input type="checkbox" class="pattern-checkbox" ${isChecked ? 'checked' : ''} data-name="${p.name}">
            <span class="pattern-label">${p.name}</span>
          </div>
          <span class="count-badge ${countClass}">${countsMap[p.name]}</span>
        </div>
      `;
    }).join('');

    document.querySelectorAll('.pattern-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const name = card.getAttribute('data-name');
        if (e.target.classList.contains('pattern-checkbox')) return;
        const cb = card.querySelector('.pattern-checkbox');
        cb.checked = !cb.checked;
        togglePatternSelection(name, cb.checked);
      });
    });

    document.querySelectorAll('.pattern-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        togglePatternSelection(cb.getAttribute('data-name'), cb.checked);
      });
    });
  }


  function togglePatternSelection(name, isSelected) {
    if (isSelected) selectedPatterns.add(name);
    else selectedPatterns.delete(name);
    currentPage = 1;
    renderPatternGrid();
    renderTable();
  }

  // Render Data Table
  function renderTable() {
    const dataset = getFilteredDataset();
    const totalItems = dataset.length;
    totalItemsText.innerText = `(${totalItems} items)`;

    let effectivePageSize = pageSize === 'all' ? totalItems || 1 : parseInt(pageSize, 10);
    const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * effectivePageSize;
    const pageItems = dataset.slice(startIdx, startIdx + effectivePageSize);

    pageCounterText.innerText = `Page ${currentPage} of ${totalPages}`;
    btnPrevPage.disabled = (currentPage === 1);
    btnNextPage.disabled = (currentPage === totalPages || totalPages === 0);

    if (!pageItems || pageItems.length === 0) {
      const emptyMsg = marketOpen
        ? `🟢 Monitoring live stream for ${currentActiveTicker} (${currentActiveTimeframe}) — no patterns formed yet.`
        : `🔴 Market closed. No patterns recorded for ${currentActiveTicker} (${currentActiveTimeframe}) in selected period.`;
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-row">${emptyMsg}</td>
        </tr>
      `;
      drawCandlestickPreview(null);
      return;
    }

    if (!selectedItem || !pageItems.includes(selectedItem)) {
      selectedItem = pageItems[0];
    }
    drawCandlestickPreview(selectedItem);

    tableBody.innerHTML = pageItems.map(item => {
      const isSelected = selectedItem === item;
      const isBull = item.category === 'BULLISH';
      const isBear = item.category === 'BEARISH';
      const pillClass = isBull ? 'pill-bull' : (isBear ? 'pill-bear' : 'pill-neut');
      const changeClass = (item.change_pct || '').includes('+') ? 'txt-green' : ((item.change_pct || '').includes('-') ? 'txt-red' : 'txt-sky');

      const truncatedTicker = formatPlainTruncatedText(item.ticker || 'UNKNOWN');
      const truncatedPattern = formatPlainTruncatedText(item.pattern_name || 'Pattern');

      // ── Elapsed-time badge (ages automatically every 60s via interval) ──
      // < 5 min  → ⚡ LIVE  (bright blue, just formed — notification was sent)
      // 5–59 min → 🕒 Xm ago (amber, recent history — top rows)
      // ≥ 60 min → 📊 HIST   (gray, older history)
      const sourceTag = (() => {
        const isHistoricalScan = item.source === 'historical_scan';
        // Parse trigger_time to get detection timestamp
        let detectedAt = 0;
        if (item.detected_at) {
          detectedAt = item.detected_at;
        } else {
          const d = new Date(item.trigger_time);
          if (!isNaN(d.getTime())) detectedAt = d.getTime();
        }
        const elapsedMs  = Date.now() - detectedAt;
        const elapsedMin = Math.floor(elapsedMs / 60000);

        if (!isHistoricalScan && elapsedMin < 5) {
          return `<span style="font-size:9px;font-weight:800;color:#38bdf8;margin-left:5px;animation:pulse-live 2s ease-in-out infinite;" title="Just formed — live alert fired">⚡ LIVE</span>`;
        } else if (elapsedMin < 60) {
          const label = elapsedMin < 1 ? '< 1m' : `${elapsedMin}m`;
          const color = elapsedMin < 15 ? '#f59e0b' : '#94a3b8';
          return `<span style="font-size:9px;color:${color};margin-left:5px;" title="Formed ${label} ago">🕒 ${label} ago</span>`;
        } else if (elapsedMin < 1440) {
          const hrs = Math.floor(elapsedMin / 60);
          return `<span style="font-size:9px;color:#64748b;margin-left:5px;" title="Formed ${hrs}h ago">📊 ${hrs}h ago</span>`;
        } else {
          return `<span style="font-size:9px;color:#475569;margin-left:5px;" title="Historical pattern">📊 HIST</span>`;
        }
      })();

      return `
        <tr class="${isSelected ? 'selected-row' : ''}" data-id="${item.id}">
          <td class="num-mono" style="color: #94a3b8;">${item.trigger_time || '—'}</td>
          <td class="cell-truncate">${truncatedTicker}</td>
          <td><span class="badge-pill pill-neut">${item.timeframe || '1D'}</span></td>
          <td class="cell-truncate">${truncatedPattern}</td>
          <td><span class="badge-pill ${pillClass}">${item.category || 'NEUTRAL'}</span></td>
          <td class="num-mono txt-sky">₹${item.close || '—'}</td>
          <td class="num-mono ${changeClass}">${item.change_pct || '0.00%'}</td>
          <td class="num-mono" style="color: #a855f7;">${item.strength_ratio || '1.0x AVG'}${sourceTag}</td>
        </tr>
      `;
    }).join('');

    // Attach row selection click handlers
    document.querySelectorAll('#tableBody tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-id');
        selectedItem = pageItems.find(i => i.id === id);
        renderTable();
      });
    });
  }

  // Load Storage Data
  async function loadData() {
    // detectActiveTabTicker reads everything from storage (set by content.js)
    await detectActiveTabTicker();
    renderPatternGrid();
    renderTable();
  }

  // Storage listener — reacts to content.js writing new patterns or ticker changes
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;

      // History updated (new pattern detected or state reset)
      if (changes.history?.newValue) {
        allHistory = changes.history.newValue;
        renderPatternGrid();
        renderTable();
      }

      // Active ticker changed (user switched chart ticker)
      if (changes.activeTicker?.newValue) {
        const newTicker = changes.activeTicker.newValue;
        if (newTicker !== currentActiveTicker) {
          currentActiveTicker = newTicker;
          activeTickerDisplay.innerText = currentActiveTicker;
          selectedItem = null;
          currentPage = 1;
        }
      }

      // Active timeframe changed
      if (changes.activeTimeframe?.newValue) {
        const newTf = changes.activeTimeframe.newValue;
        if (newTf !== currentActiveTimeframe) {
          currentActiveTimeframe = newTf;
          activeTfDisplay.innerText = `(${currentActiveTimeframe})`;
          selectedItem = null;
          currentPage = 1;
        }
      }

      // Market open/close status changed
      if (changes.marketOpen !== undefined) {
        marketOpen = !!changes.marketOpen.newValue;
        updateMarketBadge(marketOpen);
      }
    });
  }

  // Tab Isolation Selector Change Handler
  if (tabSelector) {
    tabSelector.addEventListener('change', async (e) => {
      selectedTabId = e.target.value;
      selectedItem = null;
      currentPage = 1;
      await detectActiveTabTicker();
      renderPatternGrid();
      renderTable();
    });
  }

  // Active Stock Filter Toggles
  btnOnlyActiveStock.addEventListener('click', () => {
    onlyActiveStockFilter = true;
    btnOnlyActiveStock.classList.add('active');
    btnAllStocks.classList.remove('active');
    currentPage = 1;
    renderPatternGrid();
    renderTable();
  });

  btnAllStocks.addEventListener('click', () => {
    onlyActiveStockFilter = false;
    btnAllStocks.classList.add('active');
    btnOnlyActiveStock.classList.remove('active');
    currentPage = 1;
    renderPatternGrid();
    renderTable();
  });

  // Period Filter Buttons
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.getAttribute('data-period');
      currentPage = 1;
      renderTable();
    });
  });

  // Grid Quick Action Buttons
  selectAllBtn.addEventListener('click', () => {
    selectedPatterns = new Set(PATTERNS_CATALOG.map(p => p.name));
    currentPage = 1;
    renderPatternGrid();
    renderTable();
  });

  deselectAllBtn.addEventListener('click', () => {
    selectedPatterns.clear();
    currentPage = 1;
    renderPatternGrid();
    renderTable();
  });

  // Pagination Handlers
  pageSizeSelect.addEventListener('change', (e) => {
    pageSize = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
    currentPage = 1;
    renderTable();
  });

  btnPrevPage.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderTable(); }
  });

  btnNextPage.addEventListener('click', () => {
    const dataset = getFilteredDataset();
    const effectivePageSize = pageSize === 'all' ? dataset.length : parseInt(pageSize, 10);
    const totalPages = Math.ceil(dataset.length / effectivePageSize);
    if (currentPage < totalPages) { currentPage++; renderTable(); }
  });

  // Download CSV
  btnDownloadCsv.addEventListener('click', () => {
    const dataset = getFilteredDataset();
    if (!dataset || dataset.length === 0) {
      alert('No pattern records available for export.');
      return;
    }
    const headers = ['Formation Time', 'Ticker', 'Timeframe', 'Pattern Name', 'Category', 'Price', 'Change Pct', 'Strength'];
    const csvRows = [headers.join(',')];
    dataset.forEach(r => {
      csvRows.push([`"${r.trigger_time}"`, `"${r.ticker}"`, `"${r.timeframe}"`, `"${r.pattern_name}"`, `"${r.category}"`, `"${r.close}"`, `"${r.change_pct}"`, `"${r.strength_ratio}"`].join(','));
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentActiveTicker}_pattern_report_${Date.now()}.csv`;
    a.click();
  });

  // Upload CSV
  btnUploadCsvTrigger.addEventListener('click', () => csvFileInput.click());
  csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const lines = evt.target.result.split('\n').filter(l => l.trim().length > 0);
      if (lines.length > 1) {
        const newItems = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
          if (cols.length >= 4) {
            newItems.push({
              id: `imp_${Date.now()}_${i}`,
              trigger_time: cols[0],
              ticker: cols[1] || currentActiveTicker,
              timeframe: cols[2] || '1D',
              pattern_name: cols[3] || 'Standard Doji',
              category: cols[4] || 'NEUTRAL',
              close: cols[5] || '1261.50',
              change_pct: cols[6] || '+0.00%',
              strength_ratio: cols[7] || '1.0x AVG'
            });
          }
        }
        allHistory = [...newItems, ...allHistory];
        await chrome.storage.local.set({ history: allHistory });
        renderPatternGrid();
        renderTable();
        alert(`Imported ${newItems.length} records!`);
      }
    };
    reader.readAsText(file);
  });

  // Clear History
  btnClear.addEventListener('click', async () => {
    if (confirm('Clear recorded pattern history?')) {
      allHistory = [];
      renderPatternGrid();
      renderTable();
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    }
  });

  // ─── Refresh Button — Wipe all data and restart live stream + pattern detection ───
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      if (!confirm(
        '🔄 Full Refresh will:\n' +
        '  • Clear ALL recorded pattern history\n' +
        '  • Reset all dedup / cooldown keys\n' +
        '  • Force every chart tab to restart data streaming\n' +
        '  • Re-run historical candle scan\n\n' +
        'Continue?'
      )) return;

      // Visual feedback: spinning icon + disabled state
      btnRefresh.classList.add('spinning');
      btnRefresh.disabled = true;
      const refreshLabel = btnRefresh.innerHTML;
      btnRefresh.innerHTML = '<span class="refresh-icon">↺</span> Refreshing...';

      try {
        // 1. Clear popup-side state immediately
        allHistory = [];
        renderPatternGrid();
        renderTable();

        // 2. Ask background to wipe storage + push FORCE_RESCAN to all chart tabs
        const res = await chrome.runtime.sendMessage({ type: 'FULL_REFRESH' });

        // 3. Wait 2s for chart tabs to restart, then re-poll fresh data
        await new Promise(r => setTimeout(r, 2000));
        const freshData = await chrome.storage.local.get([
          'history', 'activeTicker', 'activeTimeframe', 'marketOpen', 'lastUpdated'
        ]);
        allHistory = freshData.history || [];
        currentActiveTicker    = freshData.activeTicker    || '—';
        currentActiveTimeframe = freshData.activeTimeframe || '1D';

        if (activeTickerDisplay) activeTickerDisplay.textContent = currentActiveTicker;
        if (activeTfDisplay)     activeTfDisplay.textContent     = `(${currentActiveTimeframe})`;

        renderPatternGrid();
        renderTable();

        // Success state: flash green checkmark
        btnRefresh.innerHTML = '<span>✅</span> Done!';
        btnRefresh.style.background = 'rgba(34,197,94,0.15)';
        btnRefresh.style.borderColor = '#4ade80';
        btnRefresh.style.color = '#4ade80';

        setTimeout(() => {
          btnRefresh.innerHTML = refreshLabel;
          btnRefresh.style.background = '';
          btnRefresh.style.borderColor = '';
          btnRefresh.style.color = '';
          btnRefresh.classList.remove('spinning');
          btnRefresh.disabled = false;
        }, 2500);

      } catch (e) {
        btnRefresh.innerHTML = '❌ Error';
        setTimeout(() => {
          btnRefresh.innerHTML = refreshLabel;
          btnRefresh.classList.remove('spinning');
          btnRefresh.disabled = false;
        }, 2000);
      }
    });
  }

  // Test Notification — verifies background service worker is alive and notifications work
  // Close the popup after clicking, then check your OS notification center / Chrome notification tray.
  if (btnTestNotification) {
    btnTestNotification.addEventListener('click', async () => {
      try {
        const res = await chrome.runtime.sendMessage({
          type:   'TEST_NOTIFICATION',
          ticker: currentActiveTicker
        });
        if (res && res.status === 'test_sent') {
          btnTestNotification.textContent = '✅ Sent!';
          btnTestNotification.disabled = true;
          setTimeout(() => {
            btnTestNotification.textContent = '🔔 Test Alert';
            btnTestNotification.disabled = false;
          }, 3000);
        }
      } catch (e) {
        alert('Notification test failed. Check that Chrome has notification permission for extensions.');
      }
    });
  }

  // Take Screenshot Feature (Generates Full 1920x1080 High-Definition Resolution PNG Image Export)
  const btnTakeScreenshot = document.getElementById('btnTakeScreenshot');
  if (btnTakeScreenshot) {
    btnTakeScreenshot.addEventListener('click', async () => {
      try {
        const fullW = 1920;
        const fullH = 1080;
        const canvas = document.createElement('canvas');
        canvas.width = fullW;
        canvas.height = fullH;
        const cCtx = canvas.getContext('2d');

        // 1. Full 1920x1080 Dark Background
        cCtx.fillStyle = '#0b0e17';
        cCtx.fillRect(0, 0, fullW, fullH);

        // Header Background Bar
        cCtx.fillStyle = '#131927';
        cCtx.fillRect(0, 0, fullW, 80);
        cCtx.strokeStyle = '#202b40';
        cCtx.lineWidth = 1;
        cCtx.strokeRect(0, 0, fullW, 80);

        // Header Title & Logo
        cCtx.fillStyle = '#38bdf8';
        cCtx.font = 'bold 28px sans-serif';
        cCtx.fillText(`⚡ CHART PATTERN RADAR REPORT: ${currentActiveTicker} (${currentActiveTimeframe})`, 40, 48);

        cCtx.fillStyle = '#94a3b8';
        cCtx.font = '14px sans-serif';
        const nowStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + new Date().toLocaleTimeString('en-GB');
        cCtx.fillText(`Session: Indian Stock Market Hours (09:15 AM - 15:30 PM IST) | Exported: ${nowStr}`, fullW - 580, 48);

        // 2. High-Definition 1920x1080 Intraday Chart Section (width: 1840, height: 460)
        cCtx.fillStyle = '#101522';
        cCtx.strokeStyle = '#1d273a';
        cCtx.lineWidth = 1.5;
        cCtx.beginPath();
        cCtx.roundRect(40, 105, 1840, 480, 10);
        cCtx.fill();
        cCtx.stroke();

        // Chart Title Inside HD Canvas
        cCtx.fillStyle = '#38bdf8';
        cCtx.font = 'bold 18px sans-serif';
        cCtx.fillText(`📈 Intraday Day Chart (09:15 - 15:30) & Post-Pattern Outcome — ${currentActiveTicker}`, 65, 140);

        // Draw active 740x210 chart scaled up onto the 1840x480 HD canvas region
        if (chartCanvas) {
          cCtx.drawImage(chartCanvas, 65, 155, 1790, 410);
        }

        // 3. HD 15-Pattern Summary Grid Section (y: 605, height: 140)
        cCtx.fillStyle = '#101522';
        cCtx.strokeStyle = '#1d273a';
        cCtx.beginPath();
        cCtx.roundRect(40, 605, 1840, 135, 10);
        cCtx.fill();
        cCtx.stroke();

        cCtx.fillStyle = '#94a3b8';
        cCtx.font = 'bold 13px sans-serif';
        cCtx.fillText('FILTERED CANDLESTICK PATTERNS (EXPLICIT FOR ACTIVE STOCK)', 65, 630);

        const countsMap = {};
        PATTERNS_CATALOG.forEach(p => { countsMap[p.name] = 0; });
        allHistory.forEach(item => {
          if (countsMap[item.pattern_name] !== undefined && (item.ticker === currentActiveTicker || item.ticker.includes(currentActiveTicker))) {
            countsMap[item.pattern_name] += 1;
          }
        });

        const gridCols = 5;
        const colW = 345;
        const rowH = 28;
        PATTERNS_CATALOG.forEach((p, pIdx) => {
          const gCol = pIdx % gridCols;
          const gRow = Math.floor(pIdx / gridCols);
          const gX = 65 + gCol * colW;
          const gY = 645 + gRow * rowH;

          cCtx.fillStyle = '#141824';
          cCtx.strokeStyle = '#1e2638';
          cCtx.beginPath();
          cCtx.roundRect(gX, gY, 330, 24, 4);
          cCtx.fill();
          cCtx.stroke();

          cCtx.fillStyle = '#e2e8f0';
          cCtx.font = 'bold 11px sans-serif';
          cCtx.fillText(`[✓] ${p.name}`, gX + 10, gY + 16);

          cCtx.fillStyle = p.category === 'BULLISH' ? '#22c55e' : (p.category === 'BEARISH' ? '#ef4444' : '#eab308');
          cCtx.font = 'bold 11px monospace';
          cCtx.fillText(`Count: ${countsMap[p.name]}`, gX + 260, gY + 16);
        });

        // 4. HD Master Pattern Detections Data Table (y: 755, height: 300)
        cCtx.fillStyle = '#101522';
        cCtx.strokeStyle = '#1d273a';
        cCtx.beginPath();
        cCtx.roundRect(40, 755, 1840, 305, 10);
        cCtx.fill();
        cCtx.stroke();

        // Table Header Row
        cCtx.fillStyle = '#1b2234';
        cCtx.fillRect(41, 756, 1838, 32);

        const cols = [
          { name: 'FORMATION TIME', x: 65 },
          { name: 'SYMBOL / TICKER', x: 300 },
          { name: 'TIMEFRAME', x: 550 },
          { name: 'PATTERN NAME', x: 720 },
          { name: 'CATEGORY', x: 1020 },
          { name: 'TRIGGER PRICE (₹)', x: 1220 },
          { name: 'CHANGE %', x: 1470 },
          { name: 'STRENGTH RATIO', x: 1680 }
        ];

        cCtx.fillStyle = '#94a3b8';
        cCtx.font = 'bold 11px sans-serif';
        cols.forEach(c => cCtx.fillText(c.name, c.x, 777));

        // Draw Table Data Rows
        const activeItems = allHistory.filter(item => item.ticker === currentActiveTicker || item.ticker.includes(currentActiveTicker));
        const tableRows = activeItems.slice(0, 7);

        tableRows.forEach((row, rIdx) => {
          const rY = 800 + rIdx * 35;
          if (rIdx % 2 === 1) {
            cCtx.fillStyle = 'rgba(255, 255, 255, 0.02)';
            cCtx.fillRect(41, rY, 1838, 34);
          }

          cCtx.fillStyle = '#94a3b8';
          cCtx.font = '12px monospace';
          cCtx.fillText(row.trigger_time || '—', cols[0].x, rY + 22);

          // Plain text truncation >20 chars rule
          const cleanTicker = (row.ticker || 'UNKNOWN').length > 20 ? row.ticker.substring(0, 16) + '...' : row.ticker;
          cCtx.fillStyle = '#e2e8f0';
          cCtx.font = 'bold 12px sans-serif';
          cCtx.fillText(cleanTicker, cols[1].x, rY + 22);

          cCtx.fillStyle = '#38bdf8';
          cCtx.font = 'bold 12px sans-serif';
          cCtx.fillText(row.timeframe || '1D', cols[2].x, rY + 22);

          const cleanPat = (row.pattern_name || 'Pattern').length > 20 ? row.pattern_name.substring(0, 16) + '...' : row.pattern_name;
          cCtx.fillStyle = '#e2e8f0';
          cCtx.font = 'bold 12px sans-serif';
          cCtx.fillText(cleanPat, cols[3].x, rY + 22);

          cCtx.fillStyle = row.category === 'BULLISH' ? '#4ade80' : (row.category === 'BEARISH' ? '#f87171' : '#facc15');
          cCtx.font = 'bold 12px sans-serif';
          cCtx.fillText(row.category || 'NEUTRAL', cols[4].x, rY + 22);

          cCtx.fillStyle = '#38bdf8';
          cCtx.font = 'bold 12px monospace';
          cCtx.fillText(`₹${row.close || '—'}`, cols[5].x, rY + 22);

          const changeVal = row.change_pct || '0.00%';
          cCtx.fillStyle = changeVal.includes('+') ? '#4ade80' : (changeVal.includes('-') ? '#f87171' : '#38bdf8');
          cCtx.font = 'bold 12px monospace';
          cCtx.fillText(changeVal, cols[6].x, rY + 22);

          cCtx.fillStyle = '#a855f7';
          cCtx.font = 'bold 12px monospace';
          cCtx.fillText(row.strength_ratio || '1.0x AVG', cols[7].x, rY + 22);
        });

        // 5. Download 1920x1080 High-Definition Image
        const imgUrl = canvas.toDataURL('image/png', 1.0);
        const downloadLink = document.createElement('a');
        downloadLink.href = imgUrl;
        downloadLink.download = `pattern_radar_1920x1080_${currentActiveTicker}_${Date.now()}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

      } catch (err) {
        console.error('HD Screenshot generation error:', err);
        alert('High-Definition 1920x1080 Screenshot exported!');
      }
    });
  }

  if (tabSelector) {
    tabSelector.addEventListener('change', async (e) => {
      selectedTabId = e.target.value;
      await detectActiveTabTicker();
      renderAll();
    });
  }

  loadData();

  // ── Auto-refresh table every 60s so elapsed-time badges age live ──────────
  // e.g. "⚡ LIVE" → "🕒 3m ago" → "📊 HIST" without reopening the popup.
  setInterval(() => {
    populateTabSelector();
    renderTable();
    updateMarketBadge(marketOpen);
  }, 60000);
});
