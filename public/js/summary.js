let region = new URLSearchParams(window.location.search).get('region') || 'india';

document.addEventListener('DOMContentLoaded', () => {
    document.title = region === 'us' ? 'BSA Summary - US Stocks' : 'BSA Summary - India Stocks';
    document.getElementById('pageTitle').textContent = region === 'us' ? 'US Summary' : 'India Summary';
    
    document.getElementById('analyzerNavBtn').href = `/app.html?region=${region}`;
    
    document.getElementById('refreshSummaryBtn').addEventListener('click', fetchSummary);
    
    fetchSummary();
});

function fetchSummary() {
    fetch(`/api/summary?region=${region}`)
        .then(res => res.json())
        .then(data => {
            const summaryData = data.summary || [];
            renderTable(summaryData);
        })
        .catch(err => {
            console.error('Error fetching summary:', err);
            document.getElementById('summaryTableBody').innerHTML = '<tr><td colspan="8" style="text-align: center; color: #ef5350;">Failed to load data.</td></tr>';
        });
}

function truncateText(str) {
    if (!str) return '';
    const s = str.toString();
    if (s.length > 20) {
        return s.substring(0, 16) + '...';
    }
    return s;
}

function renderTable(summaryData) {
    const tbody = document.getElementById('summaryTableBody');
    tbody.innerHTML = '';
    
    if (summaryData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No patterns found in the database.</td></tr>';
        return;
    }
    
    summaryData.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        tr.addEventListener('click', () => {
            window.location.href = `/app.html?region=${region}&ticker=${encodeURIComponent(p.ticker)}`;
        });
        
        let badgeClass = 'summary-badge-neutral';
        let sentimentText = 'Neutral'; // Although we are using badges, we can leave an empty string or standard symbol
        if (p.pattern_type === 'Bullish') {
            badgeClass = 'summary-badge-bullish';
            sentimentText = '🟢';
        } else if (p.pattern_type === 'Bearish') {
            badgeClass = 'summary-badge-bearish';
            sentimentText = '🔴';
        }
        
        // Truncate details column to obey the 16 character rule, but since it was specifically excluded for app.js, 
        // we will apply it here unless specified otherwise. We'll use truncateText for most text fields.
        tr.innerHTML = `
            <td style="font-weight: bold; color: var(--accent-blue);"><strong>${p.ticker}</strong></td>
            <td>${truncateText(p.pattern_name)}</td>
            <td><span class="${badgeClass}" style="display:inline-block; width:100%; text-align:center;">${sentimentText}</span></td>
            <td><span class="badge" style="background: #30363d;">${p.range}</span></td>
            <td style="font-weight: bold; color: #58a6ff;">₹${p.live_price !== 0.0 ? p.live_price : '--'}</td>
            <td>${p.pattern_price !== '--' ? '₹' + p.pattern_price : '--'}</td>
            <td>${truncateText(p.datetime)}</td>
            <td style="font-size: 0.85em; color: var(--text-secondary);">${truncateText(p.details)}</td>
        `;
        tbody.appendChild(tr);
    });
}
