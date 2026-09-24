// 15 Standard Candlestick Patterns
const PATTERN_NAMES = [
    'Doji (1)', 'Hammer (3)', 'Inverted Hammer (2)', 'Shooting Star (3)', 'Hanging Man (2)',
    'Bullish Engulfing (4)', 'Bearish Engulfing (4)', 'Morning Star (5)', 'Evening Star (5)',
    'Piercing Line (4)', 'Dark Cloud Cover (4)', 'Bullish Harami (2)', 'Bearish Harami (2)',
    'Marubozu Bullish (4)', 'Marubozu Bearish (4)', 'HHHL (3)', 'Cup and Handle (15)'
];

let selectedPatterns = new Set(PATTERN_NAMES);
let currentTicker = 'NAUKRI.NS';
let currentRange = '1mo';
let region = new URLSearchParams(window.location.search).get('region') || 'india';
let allCandles = [];
let activeOptionHistory = [];
let activeOptionDetails = null;
let allPatterns = [];
let filteredPatterns = [];
let knownPatternKeys = new Set();
let isFirstLoad = true;
let currentMomentumVerdict = null;
let currentOrderFlowVerdict = null;
let currentElliottWaveTargets = null;

// TradingView Lightweight Charts instance
let tvChart = null;
let candlestickSeries = null;
let volumeSeries = null;
let activeOptionSeries = null;

// Pagination State
let currentPage = 1;
let pageSize = 10;

document.addEventListener('DOMContentLoaded', () => {
    // Update title based on region
    document.title = region === 'us' ? 'BSA Extension - US Stocks' : 'BSA Extension - India Stocks';
    initPatternCheckboxes();
    setupEventListeners();
    initTradingViewChart();
    
    const urlParams = new URLSearchParams(window.location.search);
    const urlTicker = urlParams.get('ticker');
    
    if (urlTicker) {
        loadWatchlist(urlTicker);
    } else if (region === 'us') {
        loadWatchlist('TSLA');
    } else if (region === 'india_deriv') {
        loadWatchlist('^NSEI');
    } else {
        loadWatchlist('BSE.NS');
    }
    
    // Request notification permission
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
    
    const summaryBtn = document.getElementById('summaryNavBtn');
    if (summaryBtn) summaryBtn.href = `/summary.html?region=${region}`;
    
    // Hook up Replay button
    document.getElementById('replayPatternBtn').addEventListener('click', replayLastPattern);
    
    // Auto sync every 1 minute
    setInterval(() => {
        if (isMarketOpen()) {
            refreshCurrentTicker(true);
        }
    }, 60000);
});

function isMarketOpen() {
    const now = new Date();
    
    // Check if it's weekend (0 is Sunday, 6 is Saturday)
    const day = now.getUTCDay();
    if (day === 0 || day === 6) {
        return false;
    }
    
    if (region === 'india' || region === 'india_deriv') {
        // Indian Market Hours: 9:15 AM to 3:30 PM IST (UTC + 5:30)
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + istOffset);
        
        const hours = istTime.getUTCHours();
        const minutes = istTime.getUTCMinutes();
        
        const timeInMinutes = hours * 60 + minutes;
        const openTime = 9 * 60 + 15;
        const closeTime = 15 * 60 + 30;
        
        return timeInMinutes >= openTime && timeInMinutes <= closeTime;
    } else if (region === 'us') {
        // US Market Hours approximate bound: 9:30 AM to 4:00 PM ET
        // Using UTC 13:30 to 21:00 to safely cover both EST and EDT
        const hours = now.getUTCHours();
        const minutes = now.getUTCMinutes();
        const timeInMinutes = hours * 60 + minutes;
        
        const openTime = 13 * 60 + 30;
        const closeTime = 21 * 60;
        return timeInMinutes >= openTime && timeInMinutes <= closeTime;
    }
    
    return true; // Default to always open for unknown regions
}

function initTradingViewChart() {
    const container = document.getElementById('tvChartContainer');
    if (!container) return false;

    if (typeof LightweightCharts !== 'undefined') {
        if (!tvChart) {
            container.innerHTML = '';
            const width = container.clientWidth || 1500;
            
            tvChart = LightweightCharts.createChart(container, {
                width: width,
                height: 500,
                layout: {
                    background: { type: 'solid', color: '#131722' },
                    textColor: '#d1d4dc',
                },
                grid: {
                    vertLines: { color: '#1f2430' },
                    horzLines: { color: '#1f2430' },
                },
                crosshair: {
                    mode: LightweightCharts.CrosshairMode.Normal,
                },
                rightPriceScale: {
                    borderColor: '#2a2e39',
                    scaleMargins: {
                        top: 0.1,
                        bottom: 0.25,
                    },
                },
                localization: {
                    timeFormatter: (time) => {
                        const date = new Date(time * 1000);
                        return date.toLocaleString('en-IN', {
                            timeZone: region === 'us' ? 'America/New_York' : 'Asia/Kolkata',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        });
                    }
                },
                timeScale: {
                    borderColor: '#2a2e39',
                    timeVisible: true,
                    secondsVisible: false,
                    tickMarkFormatter: (time, tickMarkType, locale) => {
                        const date = new Date(time * 1000);
                        if (tickMarkType === LightweightCharts.TickMarkType.Year || 
                            tickMarkType === LightweightCharts.TickMarkType.Month || 
                            tickMarkType === LightweightCharts.TickMarkType.DayOfMonth) {
                            return date.toLocaleString('en-IN', {
                                timeZone: region === 'us' ? 'America/New_York' : 'Asia/Kolkata',
                                month: 'short',
                                day: 'numeric'
                            });
                        }
                        return date.toLocaleString('en-IN', {
                            timeZone: region === 'us' ? 'America/New_York' : 'Asia/Kolkata',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        });
                    }
                },
            });

            candlestickSeries = tvChart.addCandlestickSeries({
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350',
            });

            volumeSeries = tvChart.addHistogramSeries({
                color: '#26a69a',
                priceFormat: {
                    type: 'volume',
                },
                priceScaleId: '',
                scaleMargins: {
                    top: 0.8,
                    bottom: 0,
                },
            });

            activeOptionSeries = tvChart.addLineSeries({
                color: '#2196F3',
                lineWidth: 2,
                title: 'Most Active Option'
            });

            const ro = new ResizeObserver(entries => {
                for (let entry of entries) {
                    if (tvChart && entry.contentRect.width > 0) {
                        tvChart.applyOptions({ width: entry.contentRect.width });
                    }
                }
            });
            ro.observe(container);
        }
        return true;
    }
    return false;
}

function initPatternCheckboxes() {
    const container = document.getElementById('patternCheckboxesGrid');
    container.innerHTML = '';
    
    PATTERN_NAMES.forEach(p => {
        const item = document.createElement('label');
        item.className = 'pattern-checkbox-item';
        item.innerHTML = `
            <input type="checkbox" value="${p}" checked>
            <span>${p}</span>
        `;
        const cb = item.querySelector('input');
        cb.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedPatterns.add(p);
            } else {
                selectedPatterns.delete(p);
            }
            filterAndRenderTable();
            renderTradingViewChart();
        });
        container.appendChild(item);
    });
}

function setupEventListeners() {
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentRange = e.target.dataset.range;
            refreshCurrentTicker(false);
        });
    });

    document.getElementById('tickerSelect').addEventListener('change', (e) => {
        currentTicker = e.target.value;
        isFirstLoad = true;
        knownPatternKeys.clear();
        refreshCurrentTicker();
    });
    
    document.getElementById('refreshBtn').addEventListener('click', () => {
        refreshCurrentTicker(true);
    });
    
    document.getElementById('addTickerBtn').addEventListener('click', addTicker);
    document.getElementById('removeTickerBtn').addEventListener('click', removeCurrentTicker);
    document.getElementById('cleanDbBtn').addEventListener('click', cleanDatabase);

    // Pattern Select All/None
    const selectAllBtn = document.getElementById('selectAllPatternsBtn');
    const selectNoneBtn = document.getElementById('selectNonePatternsBtn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('#patternCheckboxesGrid input[type="checkbox"]').forEach(cb => {
                cb.checked = true;
            });
            selectedPatterns = new Set(PATTERN_NAMES);
            filterAndRenderTable();
            renderTradingViewChart();
        });
    }
    if (selectNoneBtn) {
        selectNoneBtn.addEventListener('click', () => {
            document.querySelectorAll('#patternCheckboxesGrid input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            selectedPatterns.clear();
            filterAndRenderTable();
            renderTradingViewChart();
        });
    }

    document.getElementById('togglePatternMarkers').addEventListener('change', renderTradingViewChart);
    
    document.getElementById('chartModeSelect').addEventListener('change', (e) => {
        const mode = e.target.value;
        const tvContainer = document.getElementById('tvChartContainer');
        const widgetContainer = document.getElementById('tvWidgetContainer');
        
        if (mode === 'lightweight') {
            tvContainer.style.display = 'block';
            widgetContainer.style.display = 'none';
            renderTradingViewChart();
        } else {
            tvContainer.style.display = 'none';
            widgetContainer.style.display = 'block';
            renderTradingViewWidget();
        }
    });

    // Pagination Controls
    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTablePage();
        }
    });
    
    document.getElementById('nextPageBtn').addEventListener('click', () => {
        const maxPage = pageSize === 'all' ? 1 : Math.ceil(filteredPatterns.length / pageSize);
        if (currentPage < maxPage) {
            currentPage++;
            renderTablePage();
        }
    });
    
    document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
        const val = e.target.value;
        pageSize = val === 'all' ? 'all' : parseInt(val, 10);
        currentPage = 1;
        renderTablePage();
    });

    document.getElementById('downloadCsvBtn').addEventListener('click', downloadCSV);
    document.getElementById('exportScreenshotBtn').addEventListener('click', exportHDScreenshot);
}

function addTicker() {
    const input = document.getElementById('newTickerInput');
    const ticker = input.value.trim().toUpperCase();
    if (!ticker) return;

    if (region === 'india_deriv') {
        if (ticker === 'NSEI' || ticker === 'NIFTY') {
            input.value = '^NSEI';
            return addTicker(); // recursive call with updated value
        }
        if (ticker === 'NSEBANK' || ticker === 'BANKNIFTY') {
            input.value = '^NSEBANK';
            return addTicker(); // recursive call with updated value
        }
        
        if (!ticker.endsWith('.NS') && !ticker.startsWith('^')) {
            alert(`"${ticker}" is not recognized as a valid NSE derivative format. Please use a ticker ending in .NS (e.g. RELIANCE.NS) or an index starting with ^ (e.g. ^NSEI).`);
            return;
        }
    }
    
    fetch(`/api/watchlist/add?region=${region}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: ticker })
    }).then(r => r.json()).then(data => {
        if (data.status === 'ok' || data.success) {
            input.value = '';
            loadWatchlist(data.ticker || ticker);
        } else {
            alert('Failed to add ticker.');
        }
    });
}

function removeCurrentTicker() {
    if (!currentTicker) return;
    if (confirm(`Remove ${currentTicker} from watchlist?`)) {
        fetch(`/api/watchlist/remove?ticker=${encodeURIComponent(currentTicker)}&region=${region}`)
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    loadWatchlist();
                }
            });
    }
}

function cleanDatabase() {
    if (confirm(`Are you sure you want to clean all cached records from the ${region === 'us' ? 'US' : 'India'} database?`)) {
        fetch(`/api/db/clean?region=${region}`)
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert('Database cleaned successfully!');
                    refreshCurrentTicker(true);
                } else {
                    alert('Failed to clean database.');
                }
            });
    }
}

function loadWatchlist(selected = null) {
    fetch(`/api/watchlist?region=${region}`)
        .then(r => r.json())
        .then(data => {
            const select = document.getElementById('tickerSelect');
            select.innerHTML = '';
            data.watchlist.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                if (t === selected) opt.selected = true;
                select.appendChild(opt);
            });
            currentTicker = select.value || (region === 'us' ? 'TSLA' : 'BSE.NS');
            refreshCurrentTicker(false);
        });
}

function refreshCurrentTicker(forceSync = false) {
    const refreshParam = forceSync ? '&refresh=true' : '';
    
    Promise.all([
        fetch(`/api/candles?ticker=${encodeURIComponent(currentTicker)}&range=${currentRange}&region=${region}${refreshParam}`).then(r => r.json()),
        fetch(`/api/patterns?ticker=${encodeURIComponent(currentTicker)}&range=${currentRange}&region=${region}`).then(r => r.json())
    ]).then(([candleData, patternData]) => {
        allCandles = candleData.candles || [];
        activeOptionHistory = candleData.active_option_history || [];
        activeOptionDetails = candleData.active_option_details || null;
        currentMomentumVerdict = candleData.momentum_verdict || null;
        currentOrderFlowVerdict = candleData.order_flow_verdict || null;
        currentElliottWaveTargets = candleData.elliott_wave_targets || null;
        allPatterns = patternData.patterns || [];
        
        let newPatternDetected = null;
        
        // Iterate backwards (oldest to newest) so newPatternDetected ends up being the absolute newest un-seen pattern
        for (let i = allPatterns.length - 1; i >= 0; i--) {
            const p = allPatterns[i];
            const key = `${p.ticker}-${p.timestamp}-${p.pattern_name}`;
            if (!isFirstLoad && !knownPatternKeys.has(key)) {
                newPatternDetected = p; // Will be overwritten by newer ones, ending with the absolute newest
            }
            knownPatternKeys.add(key);
        }
        
        isFirstLoad = false;
        
        if (newPatternDetected) {
            triggerNotification(newPatternDetected);
        }
        
        updateMetricCards();
        
        const mode = document.getElementById('chartModeSelect').value;
        if (mode === 'lightweight') {
            renderTradingViewChart();
        } else {
            renderTradingViewWidget();
        }
        
        filterAndRenderTable();
        fetchOptionChain();
    }).catch(err => {
        console.error('Error refreshing current ticker:', err);
    });
}

function fetchOptionChain() {
    if (region !== 'india_deriv') {
        const sec = document.getElementById('optionChainSection');
        if(sec) sec.style.display = 'none';
        return;
    }
    
    const sec = document.getElementById('optionChainSection');
    if(sec) sec.style.display = 'block';
    
    fetch(`/api/options?ticker=${encodeURIComponent(currentTicker)}&region=${region}`)
        .then(r => r.json())
        .then(data => {
            document.getElementById('optionSpotInfo').textContent = `Spot Price: ₹${data.spot}`;
            document.getElementById('optionChainNote').textContent = data.note || '';
            
            const tbody = document.getElementById('optionsTableBody');
            tbody.innerHTML = '';
            
            if (!data.options || data.options.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No option chain data available.</td></tr>';
                return;
            }
            
            data.options.forEach(opt => {
                const tr = document.createElement('tr');
                
                const callStyle = opt.is_most_active_call ? 'background: rgba(255, 215, 0, 0.2); border-left: 3px solid gold;' : 'background: rgba(35, 134, 54, 0.05);';
                const putStyle = opt.is_most_active_put ? 'background: rgba(255, 215, 0, 0.2); border-right: 3px solid gold;' : 'background: rgba(218, 54, 51, 0.05);';
                
                tr.innerHTML = `
                    <td style="text-align: right; ${callStyle}">${opt.call_oi.toLocaleString()} ${opt.is_most_active_call ? '🔥' : ''}</td>
                    <td style="text-align: right; ${callStyle} font-weight: bold; color: #3fb950;">₹${opt.call_ltp.toFixed(2)}</td>
                    <td style="text-align: center; background: rgba(48, 54, 61, 0.5); font-weight: bold; color: #fff;">${opt.strike}</td>
                    <td style="text-align: left; ${putStyle} font-weight: bold; color: #f85149;">₹${opt.put_ltp.toFixed(2)}</td>
                    <td style="text-align: left; ${putStyle}">${opt.is_most_active_put ? '🔥' : ''} ${opt.put_oi.toLocaleString()}</td>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(err => {
            console.error('Error fetching options:', err);
            document.getElementById('optionsTableBody').innerHTML = '<tr><td colspan="5" style="text-align: center;">Error loading options chain.</td></tr>';
        });
}

function updateMetricCards() {
    document.getElementById('metricTicker').textContent = currentTicker;
    
    if (allCandles.length === 0) {
        document.getElementById('metricPrice').textContent = '₹0.00';
        document.getElementById('metricPriceChange').textContent = '+0.00%';
        document.getElementById('metricHighLow').textContent = '₹0.00 / ₹0.00';
        document.getElementById('metricPatternCount').textContent = '0';
        return;
    }

    const latest = allCandles[allCandles.length - 1];
    const first = allCandles[0];
    const changePct = ((latest.close - first.open) / first.open) * 100;
    
    let high = -Infinity;
    let low = Infinity;
    allCandles.forEach(c => {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
    });

    document.getElementById('metricPrice').textContent = `₹${latest.close.toFixed(2)}`;
    document.getElementById('metricLastTime').textContent = latest.datetime;
    
    const changeEl = document.getElementById('metricPriceChange');
    changeEl.textContent = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
    changeEl.style.color = changePct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    
    document.getElementById('metricHighLow').textContent = `₹${high.toFixed(2)} / ₹${low.toFixed(2)}`;
    document.getElementById('metricRange').textContent = `Spread: ₹${(high - low).toFixed(2)}`;

    const bullCount = allPatterns.filter(p => p.pattern_type === 'Bullish').length;
    const bearCount = allPatterns.filter(p => p.pattern_type === 'Bearish').length;
    
    document.getElementById('metricPatternCount').textContent = allPatterns.length.toString();
    document.getElementById('metricPatternTypes').textContent = `${bullCount} Bullish | ${bearCount} Bearish`;
    
    const latestCard = document.getElementById('latestPatternCard');
    const nameEl = document.getElementById('latestPatternName');
    const detailsEl = document.getElementById('latestPatternDetails');
    
    if (allPatterns.length > 0) {
        const latestP = allPatterns[0];
        nameEl.textContent = `${latestP.pattern_name} @ ₹${latestP.price.toFixed(2)}`;
        detailsEl.textContent = `${latestP.datetime} - ${latestP.details}`;
        
        latestCard.style.backgroundColor = latestP.pattern_type === 'Bullish' ? 'rgba(38, 166, 154, 0.15)' : (latestP.pattern_type === 'Bearish' ? 'rgba(239, 83, 80, 0.15)' : 'var(--card-bg)');
        latestCard.style.borderLeft = latestP.pattern_type === 'Bullish' ? '4px solid #26a69a' : (latestP.pattern_type === 'Bearish' ? '4px solid #ef5350' : 'none');
    } else {
        latestCard.style.backgroundColor = 'var(--card-bg)';
        latestCard.style.borderLeft = 'none';
    }

    const momentumCard = document.getElementById('momentumCard');
    const momentumVerdictText = document.getElementById('momentumVerdictText');
    const momentumDetailsText = document.getElementById('momentumDetailsText');

    if (currentMomentumVerdict) {
        momentumVerdictText.textContent = currentMomentumVerdict.verdict;
        momentumDetailsText.textContent = `MACD: ${currentMomentumVerdict.macd ? '🟢' : '🔴'} | RSI: ${currentMomentumVerdict.rsi ? '🟢' : '🔴'} | EMA: ${currentMomentumVerdict.ema ? '🟢' : '🔴'}`;
        
        if (currentMomentumVerdict.score === 3) {
            momentumCard.style.backgroundColor = 'rgba(38, 166, 154, 0.2)';
            momentumCard.style.borderLeft = '4px solid #26a69a';
        } else if (currentMomentumVerdict.score === 2) {
            momentumCard.style.backgroundColor = 'rgba(38, 166, 154, 0.1)';
            momentumCard.style.borderLeft = '4px solid #81c784';
        } else if (currentMomentumVerdict.score === 1) {
            momentumCard.style.backgroundColor = 'rgba(255, 152, 0, 0.1)';
            momentumCard.style.borderLeft = '4px solid #ff9800';
        } else {
            momentumCard.style.backgroundColor = 'rgba(239, 83, 80, 0.1)';
            momentumCard.style.borderLeft = '4px solid #ef5350';
        }
    } else {
        momentumVerdictText.textContent = '--';
        momentumDetailsText.textContent = 'MACD: -- | RSI: -- | EMA: --';
        momentumCard.style.backgroundColor = 'var(--card-bg)';
        momentumCard.style.borderLeft = '4px solid #8b949e';
    }
    
    const orderFlowCard = document.getElementById('orderFlowCard');
    const orderFlowVerdictText = document.getElementById('orderFlowVerdictText');
    const orderFlowDetailsText = document.getElementById('orderFlowDetailsText');
    
    if (currentOrderFlowVerdict) {
        const hasVol = currentOrderFlowVerdict.volume_expansion;
        const hasOB = currentOrderFlowVerdict.order_block_mitigation;
        
        let verdict = "Neutral";
        if (hasVol && hasOB) {
            verdict = "Strong Accumulation";
            orderFlowCard.style.backgroundColor = 'rgba(38, 166, 154, 0.2)';
            orderFlowCard.style.borderLeft = '4px solid #26a69a';
        } else if (hasVol || hasOB) {
            verdict = "Bullish Order Flow";
            orderFlowCard.style.backgroundColor = 'rgba(38, 166, 154, 0.1)';
            orderFlowCard.style.borderLeft = '4px solid #81c784';
        } else {
            verdict = "No Institutional Buying";
            orderFlowCard.style.backgroundColor = 'rgba(239, 83, 80, 0.1)';
            orderFlowCard.style.borderLeft = '4px solid #ef5350';
        }
        
        orderFlowVerdictText.textContent = verdict;
        orderFlowDetailsText.textContent = `Vol Profile: ${hasVol ? '🟢' : '🔴'} | Demand Zones: ${hasOB ? '🟢' : '🔴'}`;
    } else {
        orderFlowVerdictText.textContent = '--';
        orderFlowDetailsText.textContent = 'Vol Profile: -- | Demand Zones: --';
        orderFlowCard.style.backgroundColor = 'var(--card-bg)';
        orderFlowCard.style.borderLeft = '4px solid #8b949e';
    }

    if (currentElliottWaveTargets) {
        const swing = currentElliottWaveTargets.swing;
        const intra = currentElliottWaveTargets.intraday;
        
        let verdict = "No clear wave structure";
        let color = "#8b949e";
        let details = "W3: -- | W5: --";
        
        if (swing.status === "Active Projection") {
            verdict = "Swing Setup Active";
            color = "#26a69a";
            details = `W3: ₹${swing.w3.toFixed(2)} | W5: ₹${swing.w5.toFixed(2)}`;
        } else if (intra.status === "Active Projection") {
            verdict = "Intraday Setup Active";
            color = "#81c784";
            details = `W3: ₹${intra.w3.toFixed(2)} | W5: ₹${intra.w5.toFixed(2)}`;
        }
        
        document.getElementById('ewVerdictText').textContent = verdict;
        document.getElementById('ewDetailsText').textContent = details;
        document.getElementById('ewCard').style.borderLeft = `4px solid ${color}`;
        document.getElementById('ewCard').style.backgroundColor = (color === "#8b949e") ? 'var(--card-bg)' : `rgba(38, 166, 154, 0.1)`;

        document.getElementById('ewSwingStatus').textContent = swing.status;
        document.getElementById('ewSwingW3').textContent = swing.w3 ? `₹${swing.w3.toFixed(2)}` : '--';
        document.getElementById('ewSwingW5').textContent = swing.w5 ? `₹${swing.w5.toFixed(2)}` : '--';
        
        document.getElementById('ewIntraStatus').textContent = intra.status;
        document.getElementById('ewIntraW3').textContent = intra.w3 ? `₹${intra.w3.toFixed(2)}` : '--';
        document.getElementById('ewIntraW5').textContent = intra.w5 ? `₹${intra.w5.toFixed(2)}` : '--';
        
    } else {
        document.getElementById('ewVerdictText').textContent = 'Analyzing...';
        document.getElementById('ewDetailsText').textContent = 'W3: -- | W5: --';
        document.getElementById('ewCard').style.borderLeft = '4px solid #8b949e';
        document.getElementById('ewCard').style.backgroundColor = 'var(--card-bg)';
        
        document.getElementById('ewSwingStatus').textContent = 'Analyzing...';
        document.getElementById('ewSwingW3').textContent = '--';
        document.getElementById('ewSwingW5').textContent = '--';
        
        document.getElementById('ewIntraStatus').textContent = 'Analyzing...';
        document.getElementById('ewIntraW3').textContent = '--';
        document.getElementById('ewIntraW5').textContent = '--';
    }
}

function renderTradingViewChart() {
    if (!tvChart || !candlestickSeries) {
        const initialized = initTradingViewChart();
        if (!initialized) return;
    }
    if (allCandles.length === 0) {
        candlestickSeries.setData([]);
        volumeSeries.setData([]);
        if (activeOptionSeries) activeOptionSeries.setData([]);
        return;
    }
    // Deduplicate and sort 1-hour candles
    const candleMap = new Map();
    allCandles.forEach(c => candleMap.set(c.timestamp, c));
    const sortedCandles = Array.from(candleMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    const tvData = [];
    const volData = [];
    const markers = [];

    const showMarkers = document.getElementById('togglePatternMarkers').checked;

    sortedCandles.forEach((c) => {
        const timeVal = c.timestamp;
        
        tvData.push({
            time: timeVal,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        });

        volData.push({
            time: timeVal,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
        });

        if (showMarkers) {
            const matches = allPatterns.filter(p => p.timestamp === c.timestamp && selectedPatterns.has(p.pattern_name));
            if (matches.length > 0) {
                const match = matches[0];
                markers.push({
                    time: timeVal,
                    position: match.pattern_type === 'Bullish' ? 'belowBar' : 'aboveBar',
                    color: match.pattern_type === 'Bullish' ? '#26a69a' : '#ef5350',
                    shape: match.pattern_type === 'Bullish' ? 'arrowUp' : 'arrowDown',
                    text: match.pattern_name
                });
            }
        }
    });

    if (region === 'india_deriv') {
        candlestickSeries.setData([]);
        volumeSeries.setData([]);
        
        // Deduplicate and sort active option lines
        const optMap = new Map();
        activeOptionHistory.forEach(c => optMap.set(c.time, c));
        const sortedOpt = Array.from(optMap.values()).sort((a, b) => a.time - b.time);
        
        if (activeOptionSeries) {
            activeOptionSeries.setData(sortedOpt);
            
            if (activeOptionDetails) {
                const optColor = activeOptionDetails.type === 'Call' ? '#3fb950' : '#f85149';
                activeOptionSeries.applyOptions({
                    color: optColor,
                    title: `Active ${activeOptionDetails.type} (${activeOptionDetails.strike})`
                });
            }
        }
    } else {
        candlestickSeries.setData(tvData);
        volumeSeries.setData(volData);
        candlestickSeries.setMarkers(markers);
        if (activeOptionSeries) activeOptionSeries.setData([]);
    }

    setTimeout(() => {
        if (tvChart) {
            tvChart.timeScale().fitContent();
        }
    }, 50);
}

function renderTradingViewWidget() {
    const container = document.getElementById('tvWidgetContainer');
    container.innerHTML = '';

    const cleanSymbol = currentTicker.replace('.NS', '');
    const tvSymbol = `NSE:${cleanSymbol}`;

    let tvInterval = "60";
    let tvRange = "1M";
    if (currentRange === '1d') { tvInterval = "5"; tvRange = "1D"; }
    else if (currentRange === '5d') { tvInterval = "15"; tvRange = "5D"; }
    else if (currentRange === '1mo') { tvInterval = "60"; tvRange = "1M"; }
    else if (currentRange === '3mo') { tvInterval = "60"; tvRange = "3M"; }
    else if (currentRange === '6mo') { tvInterval = "D"; tvRange = "6M"; }

    if (typeof TradingView !== 'undefined') {
        new TradingView.widget({
            "autosize": true,
            "symbol": tvSymbol,
            "interval": tvInterval,
            "range": tvRange,
            "timezone": "Asia/Kolkata",
            "theme": "dark",
            "style": "1",
            "locale": "en",
            "toolbar_bg": "#f1f3f6",
            "enable_publishing": false,
            "allow_symbol_change": true,
            "container_id": "tvWidgetContainer"
        });
    } else {
        container.innerHTML = `<div style="padding: 20px; color: #8b949e;">TradingView Live Widget loading...</div>`;
    }
}

// Master Data Table Filtering & Truncation logic
function filterAndRenderTable() {
    filteredPatterns = allPatterns.filter(p => selectedPatterns.has(p.pattern_name));
    currentPage = 1;
    renderTablePage();
}

function truncateText(str) {
    if (!str) return '';
    if (str.length > 20) {
        return str.substring(0, 16) + '...';
    }
    return str;
}

function renderTablePage() {
    const tbody = document.getElementById('patternsTableBody');
    tbody.innerHTML = '';

    const total = filteredPatterns.length;
    let startIdx = 0;
    let endIdx = total;

    if (pageSize !== 'all') {
        startIdx = (currentPage - 1) * pageSize;
        endIdx = Math.min(startIdx + pageSize, total);
    }

    const pageData = filteredPatterns.slice(startIdx, endIdx);

    if (pageData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #8b949e; padding: 20px;">No patterns detected matching selected criteria.</td></tr>`;
    } else {
        pageData.forEach(p => {
            const tr = document.createElement('tr');

            const badgeClass = p.pattern_type === 'Bullish' ? 'badge-bullish' : (p.pattern_type === 'Bearish' ? 'badge-bearish' : 'badge-neutral');

            tr.innerHTML = `
                <td>${truncateText(p.datetime)}</td>
                <td>${truncateText(p.pattern_name)}</td>
                <td><span class="badge ${badgeClass}">${p.pattern_type}</span></td>
                <td>₹${p.price.toFixed(2)}</td>
                <td style="white-space: normal;">${p.details}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    const totalPages = pageSize === 'all' ? 1 : (Math.ceil(total / pageSize) || 1);
    document.getElementById('paginationInfo').textContent = total === 0 ? 'Showing 0 to 0 of 0 entries' : `Showing ${startIdx + 1} to ${endIdx} of ${total} entries`;
    document.getElementById('pageCounter').textContent = `Page ${currentPage} of ${totalPages}`;
    
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

function downloadCSV() {
    if (filteredPatterns.length === 0) {
        alert('No data to export!');
        return;
    }
    
    let csv = 'Timestamp,Ticker,Pattern Name,Pattern Type,Price,Details\n';
    filteredPatterns.forEach(p => {
        csv += `"${p.datetime}","${p.ticker}","${p.pattern_name}","${p.pattern_type}",${p.price},"${p.details}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${currentTicker}_hourly_pattern_log.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportHDScreenshot() {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 1920;
    offCanvas.height = 1080;
    const ctx = offCanvas.getContext('2d');

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, 1920, 1080);

    ctx.fillStyle = '#161b22';
    ctx.fillRect(40, 40, 1840, 80);
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, 1840, 80);

    ctx.fillStyle = '#58a6ff';
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.fillText(`📊 TRADINGVIEW MULTI-TIMEFRAME REPORT: ${currentTicker} (${currentRange.toUpperCase()})`, 70, 92);

    const dateStr = new Date().toLocaleString();
    ctx.fillStyle = '#8b949e';
    ctx.font = '18px Inter, sans-serif';
    ctx.fillText(`Generated: ${dateStr}`, 1480, 92);

    const mode = document.getElementById('chartModeSelect').value;
    
    if (mode === 'lightweight' && tvChart) {
        // takeScreenshot returns an HTMLCanvasElement
        const chartCanvas = tvChart.takeScreenshot();
        // Scale and draw the chart to fit nicely in the remaining space
        ctx.drawImage(chartCanvas, 40, 160, 1840, 850);
    } else {
        ctx.fillStyle = '#8b949e';
        ctx.font = '24px Inter, sans-serif';
        ctx.fillText(`(Live Embed Widget screenshots are not supported due to browser security restrictions)`, 450, 500);
    }

    const dataUrl = offCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${currentTicker}_tradingview_${currentRange}_report_1920x1080.png`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

function triggerNotification(pattern) {
    const box = document.getElementById('patternBox');
    
    // Remove old classes just in case
    box.classList.remove('notify-green', 'notify-red');
    
    // Add appropriate class
    const notifyClass = pattern.pattern_type === 'Bullish' ? 'notify-green' : 'notify-red';
    box.classList.add(notifyClass);
    
    // Stop highlighting after 1 minute (60000 ms)
    setTimeout(() => {
        box.classList.remove(notifyClass);
    }, 60000);
    
    // Browser System Notification
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("New Pattern Detected", {
            body: `${pattern.pattern_type} ${pattern.pattern_name} detected on ${pattern.ticker} at ${pattern.datetime}`
        });
    }
}

function replayLastPattern() {
    if (allPatterns.length > 0) {
        // Grab the most recent pattern in the list (usually the last one if sorted by time)
        const sortedPatterns = [...allPatterns].sort((a, b) => b.timestamp - a.timestamp);
        triggerNotification(sortedPatterns[0]);
    } else {
        alert("No patterns available to replay.");
    }
}
