// 15 Standard Candlestick Patterns
const PATTERN_NAMES = [
    'Doji', 'Hammer', 'Inverted Hammer', 'Shooting Star', 'Hanging Man',
    'Bullish Engulfing', 'Bearish Engulfing', 'Morning Star', 'Evening Star',
    'Piercing Line', 'Dark Cloud Cover', 'Bullish Harami', 'Bearish Harami',
    'Marubozu Bullish', 'Marubozu Bearish'
];

let selectedPatterns = new Set(PATTERN_NAMES);
let currentTicker = 'NAUKRI.NS';
let currentRange = '1mo';
let region = new URLSearchParams(window.location.search).get('region') || 'india';
let allCandles = [];
let allPatterns = [];
let filteredPatterns = [];
let knownPatternKeys = new Set();
let isFirstLoad = true;

// TradingView Lightweight Charts instance
let tvChart = null;
let candlestickSeries = null;
let volumeSeries = null;

// Pagination State
let currentPage = 1;
let pageSize = 10;

document.addEventListener('DOMContentLoaded', () => {
    // Update title based on region
    document.title = region === 'us' ? 'BSA Extension - US Stocks' : 'BSA Extension - India Stocks';
    initPatternCheckboxes();
    setupEventListeners();
    initTradingViewChart();
    loadWatchlist(region === 'us' ? 'TSLA' : 'BSE.NS');
    
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
        refreshCurrentTicker(true);
    }, 60000);
});

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
    const ticker = input.value.trim();
    if (!ticker) return;
    
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
    }).catch(err => {
        console.error('Error refreshing current ticker:', err);
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
        nameEl.textContent = '--';
        detailsEl.textContent = 'Waiting for patterns...';
        latestCard.style.backgroundColor = 'var(--card-bg)';
        latestCard.style.borderLeft = 'none';
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

    candlestickSeries.setData(tvData);
    volumeSeries.setData(volData);
    candlestickSeries.setMarkers(markers);

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
    box.classList.remove('blink-green', 'blink-red');
    
    // Add appropriate class
    const blinkClass = pattern.pattern_type === 'Bullish' ? 'blink-green' : 'blink-red';
    box.classList.add(blinkClass);
    
    // Stop blinking after 1 minute (60000 ms)
    setTimeout(() => {
        box.classList.remove(blinkClass);
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
