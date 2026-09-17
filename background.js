// background.js - Service Worker for Chart Pattern Radar (MV3)
//
// KEY PROBLEM SOLVED:
// Chrome MV3 service workers go idle after ~30s of inactivity and get killed by the browser.
// When killed, chrome.notifications.create() never fires even though content.js is still running.
//
// SOLUTION: chrome.alarms API keeps the service worker alive.
// We register a recurring alarm every 25s (below the 30s kill threshold).
// Each alarm ping wakes the service worker before Chrome can terminate it.
// This ensures notifications fire even when the popup is completely closed.

let currentActiveTicker    = 'UNKNOWN';
let currentActiveTimeframe = '1D';
let marketIsOpen           = false;

// ─── IST Market Hours Check (same logic as content.js) ───────────────────────
function isMarketOpenNow() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcMs  = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const istNow = new Date(utcMs + istOffset);
  const day    = istNow.getDay();
  if (day === 0 || day === 6) return false;
  const totalMins = istNow.getHours() * 60 + istNow.getMinutes();
  return totalMins >= (9 * 60 + 15) && totalMins <= (15 * 60 + 30);
}

// ─── Keep-Alive Alarm Setup ───────────────────────────────────────────────────
// Chrome MV3 kills idle service workers after ~30s.
// We use a 25s alarm to wake ourselves before that happens.
// The alarm fires regardless of popup state — this is the key to background notifications.
function setupKeepAliveAlarm() {
  chrome.alarms.get('keepAlive', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 }); // every ~25s
      console.log('⚡ [Pattern Radar] Keep-alive alarm registered (25s cycle)');
    }
  });
}

// ─── Service Worker Init ──────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    history:         [],
    activeTicker:    'UNKNOWN',
    activeTimeframe: '1D',
    marketOpen:      false,
    lastUpdated:     null
  });
  setupKeepAliveAlarm();
  console.log('⚡ [Pattern Radar] Installed. Keep-alive alarm active. Awaiting chart data...');
});

// Wake up on browser start too
chrome.runtime.onStartup.addListener(() => {
  setupKeepAliveAlarm();
  console.log('⚡ [Pattern Radar] Browser started. Keep-alive alarm active.');
});

// ─── Alarm Handler ────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Service worker is now awake. Update market status in storage so popup stays accurate.
    const open = isMarketOpenNow();
    if (open !== marketIsOpen) {
      marketIsOpen = open;
      chrome.storage.local.set({ marketOpen: open });
      console.log(`[Pattern Radar] Market status changed → ${open ? 'OPEN' : 'CLOSED'}`);
    }
    // Log to confirm we're alive (visible in chrome://serviceworker-internals)
    console.log(`[Pattern Radar] Keep-alive ping @ ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST | Market: ${open ? 'OPEN' : 'CLOSED'}`);
  }
});

// ─── Tab-Level State Isolation Event Listeners ────────────────────────────────
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await chrome.storage.local.set({ activeTabId: activeInfo.tabId });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const { tabStates = {} } = await chrome.storage.local.get('tabStates');
    if (tabStates[tabId]) {
      delete tabStates[tabId];
      await chrome.storage.local.set({ tabStates });
      console.log(`🧹 [Pattern Radar] Cleaned isolated tab state for tabId: ${tabId}`);
    }
  } catch (e) {}
});

// ─── Message Handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const { extensionEnabled = true } = await chrome.storage.local.get('extensionEnabled');
    if (!extensionEnabled && message.type !== 'GET_STATUS') {
      sendResponse({ status: 'extension_disabled' });
      return;
    }

    // ── SET_ACTIVE_TICKER: heartbeat from content.js every scan ────────────
    if (message.type === 'SET_ACTIVE_TICKER') {
      const tabId = sender.tab ? sender.tab.id : null;
      const senderUrl = sender.tab?.url || message.url || '';

      // Accept only: Kite /ext/ pop-out charts, Groww stock charts, NSE India charts, or explicitly flagged isExt
      const isKiteExtTab  = senderUrl.includes('/ext/');
      const isGrowwChart  = senderUrl.includes('groww.in/charts/');
      const isNseChart    = senderUrl.includes('nseindia.com');
      const isAccepted    = isKiteExtTab || isGrowwChart || isNseChart || message.isExt === true;

      if (senderUrl && !isAccepted) {
        sendResponse({ status: 'ignored_non_ext_tab' });
        return;
      }

      const newTicker    = (message.ticker    || 'UNKNOWN').toUpperCase();
      const newTimeframe = (message.timeframe || '1D').toUpperCase();
      const closePrice   = message.closePrice ? parseFloat(message.closePrice) : 0;
      marketIsOpen       = !!message.marketOpen;

      const { tabStates = {}, lastKnownPrices = {} } = await chrome.storage.local.get(['tabStates', 'lastKnownPrices']);

      if (closePrice > 0 && newTicker !== 'UNKNOWN') {
        lastKnownPrices[newTicker] = closePrice;
      }

      if (tabId) {
        tabStates[tabId] = {
          tabId,
          url: senderUrl,
          isExt: !!message.isExt,
          ticker: newTicker,
          timeframe: newTimeframe,
          closePrice,
          lastUpdated: Date.now()
        };
      }

      currentActiveTicker    = newTicker;
      currentActiveTimeframe = newTimeframe;

      await chrome.storage.local.set({
        tabStates,
        activeTicker:    newTicker,
        activeTimeframe: newTimeframe,
        marketOpen:      marketIsOpen,
        lastKnownPrices: lastKnownPrices
      });

      const { history = [] } = await chrome.storage.local.get('history');
      const tickerHistory = history.filter(h =>
        (tabId && h.tabId === tabId) || h.ticker === newTicker || h.ticker.includes(newTicker)
      );

      sendResponse({
        status:          'active_ticker_updated',
        tabId:           tabId,
        activeTicker:    newTicker,
        activeTimeframe: newTimeframe,
        marketOpen:      marketIsOpen,
        lastKnownPrices: lastKnownPrices,
        history:         tickerHistory
      });
    }

    // ── RESET_TICKER_STATE: ticker or timeframe changed ────────────────────
    else if (message.type === 'RESET_TICKER_STATE') {
      const newTicker    = (message.ticker    || 'UNKNOWN').toUpperCase();
      const newTimeframe = (message.timeframe || '1D').toUpperCase();

      console.log(`🔄 [Pattern Radar] State reset → ${newTicker} (${newTimeframe})`);

      const { history = [] } = await chrome.storage.local.get('history');
      const preserved = history.filter(h => {
        if (h.ticker !== newTicker) return true;
        if (h.id && h.id.startsWith('imp_')) return true;
        return false;
      });

      await chrome.storage.local.set({
        history:         preserved,
        activeTicker:    newTicker,
        activeTimeframe: newTimeframe,
        lastUpdated:     null
      });

      await chrome.action.setBadgeText({ text: '' }).catch(() => {});
      sendResponse({ status: 'reset_complete', activeTicker: newTicker });
    }

    // ── FULL_REFRESH: wipe all data and force rescan from scratch ────────────
    else if (message.type === 'FULL_REFRESH') {
      console.log('🔄 [Pattern Radar] FULL REFRESH — wiping all state and restarting stream...');

      // 1. Clear all stored data
      await chrome.storage.local.set({
        history:             [],
        lastPattern:         null,
        lastUpdated:         null,
        activeTicker:        null,
        activeTimeframe:     null,
        tabStates:           {},
        lastKnownPrices:     {},
        persistedPatternKeys: [],
        notifCooldowns:      {}
      });

      // 2. Clear the toolbar badge
      await chrome.action.setBadgeText({ text: '' }).catch(() => {});

      // 3. Signal every matching chart tab to reset state and re-run historical scan
      const chartPatterns = [
        '*://kite.zerodha.com/*',
        '*://groww.in/charts/*',
        '*://*.nseindia.com/*'
      ];
      for (const pattern of chartPatterns) {
        try {
          const tabs = await chrome.tabs.query({ url: pattern });
          for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, { type: 'FORCE_RESCAN' }).catch(() => {});
          }
        } catch (e) {}
      }

      console.log('✅ [Pattern Radar] Full refresh complete — stream restarting.');
      sendResponse({ status: 'refresh_complete' });
    }

    // ── PATTERN_DETECTED: from content.js live stream or historical scan ───
    else if (message.type === 'PATTERN_DETECTED') {
      const { pattern } = message;
      if (sender.tab) {
        pattern.tabId = sender.tab.id;
        pattern.tabUrl = sender.tab.url;
      }
      const { history = [] } = await chrome.storage.local.get('history');

      // Helper: filter out legacy corrupt entries (e.g. YESBANK with Nifty index price > 2000)
      const cleanHistory = (list) => (list || []).filter(h => {
        if (!h || !h.ticker || !h.close) return false;
        const p = parseFloat(h.close);
        const t = (h.ticker || '').toUpperCase();
        const isIdx = /NIFTY|BANKNIFTY|SENSEX|FINNIFTY/i.test(t);
        if (!isIdx && p > 2000 && (t === 'YESBANK' || t.includes('YESBANK'))) return false;
        if (!isIdx && p > 15000 && t !== 'MRF' && t !== 'HONAUT') return false;
        return true;
      });

      const sanitizedHistory = cleanHistory(history);

      // Deduplicate: same ticker + pattern + trigger_time
      const isDuplicate = sanitizedHistory.some(h =>
        h.ticker       === pattern.ticker &&
        h.pattern_name === pattern.pattern_name &&
        h.trigger_time === pattern.trigger_time
      );

      if (!isDuplicate) {
        const updatedHistory = [pattern, ...sanitizedHistory].slice(0, 500);
        await chrome.storage.local.set({
          history:     updatedHistory,
          lastPattern: pattern,
          lastUpdated: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
        });

        // ── LIVE vs HISTORICAL ────────────────────────────────────────────
        // Live pattern  (source !== 'historical_scan'):
        //   → Pattern forming NOW on current bar → notification + badge
        //   → Fires even when popup is CLOSED (service worker kept alive by alarm)
        //
        // Historical scan pattern (source === 'historical_scan'):
        //   → Past closed bar from chart hover scan → stored silently, no alert
        const isLive = pattern.source !== 'historical_scan';

        if (isLive) {
          // ── Notification Cooldown: suppress repeat alerts within 5 minutes ─────
          // Prevents OS notification floods if the content.js dedup resets (tab reload).
          const cooldownKey = `${pattern.ticker}_${pattern.pattern_name}_${parseFloat(pattern.close).toFixed(2)}`;
          const { notifCooldowns = {} } = await chrome.storage.local.get('notifCooldowns');
          const lastSent = notifCooldowns[cooldownKey] || 0;
          const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per same ticker+pattern+price

          if (Date.now() - lastSent < COOLDOWN_MS) {
            console.log(`🔕 [Pattern Radar] Suppressed repeat notification (cooldown): ${cooldownKey}`);
          } else {
            notifCooldowns[cooldownKey] = Date.now();
            // Prune old entries (older than 1 hour) to keep storage tidy
            const oneHourAgo = Date.now() - 60 * 60 * 1000;
            Object.keys(notifCooldowns).forEach(k => {
              if (notifCooldowns[k] < oneHourAgo) delete notifCooldowns[k];
            });
            await chrome.storage.local.set({ notifCooldowns });

            // ── System-level desktop notification ──────────────────────────
            const direction = pattern.category === 'BULLISH' ? '🟢' : pattern.category === 'BEARISH' ? '🔴' : '🟡';
            const notifTitle   = `${direction} ${pattern.pattern_name} — ${pattern.ticker}`;
            const notifMessage = [
              `Timeframe: ${pattern.timeframe}`,
              `Time: ${pattern.trigger_time}`,
              `Price: ₹${pattern.close}  ${pattern.change_pct}`,
              `Signal: ${pattern.strength_ratio}`
            ].join('\n');

            try {
              chrome.notifications.create(`pat_${Date.now()}`, {
                type:               'basic',
                iconUrl:            'icons/icon-48.png',
                title:              notifTitle,
                message:            notifMessage,
                priority:           2,
                requireInteraction: false
              });
              console.log(`🔔 [Pattern Radar] Notification sent: ${notifTitle}`);
            } catch (err) {
              console.error('[Pattern Radar] Notification error:', err);
            }

            // Extension badge (visible on the toolbar icon even when popup is closed)
            let badgeColor = '#eab308'; // NEUTRAL
            if (pattern.category === 'BULLISH') badgeColor = '#22c55e';
            else if (pattern.category === 'BEARISH') badgeColor = '#ef4444';

            await chrome.action.setBadgeText({ text: '⚡' }).catch(() => {});
            await chrome.action.setBadgeBackgroundColor({ color: badgeColor }).catch(() => {});
          }
        } // end if (isLive)
        // Historical patterns: stored silently, popup shows 📊 HIST rows
      }

      sendResponse({ status: 'success' });
    }

    // ── TEST_NOTIFICATION: popup button to verify notifications work ───────
    else if (message.type === 'TEST_NOTIFICATION') {
      const ticker = message.ticker || currentActiveTicker || 'INFY';
      try {
        chrome.notifications.create(`test_${Date.now()}`, {
          type:    'basic',
          iconUrl: 'icons/icon-48.png',
          title:   `⚡ [Test] Pattern Radar is Active — ${ticker}`,
          message: `Background monitoring is working.\nNotifications will fire even when popup is closed.\nMarket: ${isMarketOpenNow() ? '🟢 OPEN (09:15–15:30 IST)' : '🔴 CLOSED'}`,
          priority: 2
        });
        console.log('[Pattern Radar] Test notification sent.');
        sendResponse({ status: 'test_sent' });
      } catch (err) {
        console.error('[Pattern Radar] Test notification error:', err);
        sendResponse({ status: 'error', error: String(err) });
      }
    }

    // ── CLEAR_HISTORY ──────────────────────────────────────────────────────
    else if (message.type === 'CLEAR_HISTORY') {
      await chrome.storage.local.set({ history: [], lastPattern: null, lastUpdated: null });
      await chrome.action.setBadgeText({ text: '' }).catch(() => {});
      sendResponse({ status: 'cleared' });
    }

    // ── GET_STATUS ─────────────────────────────────────────────────────────
    else if (message.type === 'GET_STATUS') {
      const data = await chrome.storage.local.get([
        'history', 'activeTicker', 'activeTimeframe', 'marketOpen', 'lastUpdated'
      ]);
      sendResponse({ ...data, currentActiveTicker, marketIsOpen });
    }

  })();
  return true; // Keep message channel open for async sendResponse
});
