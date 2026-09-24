import sqlite3
import json
import os
import urllib.request
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
import yfinance as yf
from datetime import datetime, timezone, timedelta
try:
    from zoneinfo import ZoneInfo
except ImportError:
    import pytz as ZoneInfo
import math

def get_db_path(region):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if region == 'us':
        return os.path.join(base_dir, 'us_database.sqlite')
    if region == 'india_deriv':
        return os.path.join(base_dir, 'ind_deriv_database.sqlite')
    return os.path.join(base_dir, 'ind_database.sqlite')

def init_db(region='india'):
    conn = sqlite3.connect(get_db_path(region))
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS candles_range (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            range_key TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            datetime_str TEXT NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume INTEGER NOT NULL,
            UNIQUE(ticker, range_key, timestamp)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS patterns_range (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            range_key TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            datetime_str TEXT NOT NULL,
            pattern_name TEXT NOT NULL,
            pattern_type TEXT NOT NULL,
            price REAL NOT NULL,
            details TEXT NOT NULL,
            UNIQUE(ticker, range_key, timestamp, pattern_name)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS watchlist (
            ticker TEXT PRIMARY KEY,
            added_at TEXT NOT NULL
        )
    ''')
    # Default watchlist
    if region == 'us':
        default_tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']
    elif region == 'india_deriv':
        default_tickers = ['^NSEI', '^BSESN', '^NSEBANK']
    else:
        default_tickers = ['NAUKRI.NS', 'INFY.NS', 'HDFCBANK.NS', 'RELIANCE.NS', 'BSE.NS']
        
    for t in default_tickers:
        cursor.execute("INSERT OR IGNORE INTO watchlist (ticker, added_at) VALUES (?, datetime('now'))", (t,))
    
    conn.commit()
    conn.close()

def fetch_yahoo_range(ticker, range_key='1mo', region='india'):
    """
    Fetch candle data for given range from Yahoo Finance API.
    range_key options: '1d', '5d', '1mo', '3mo', '6mo'
    """
    if range_key in ['1d', '5d']:
        interval = '15m' if range_key == '5d' else '5m'
    elif range_key in ['1mo', '3mo']:
        interval = '60m'
    else: # 6mo
        interval = '1d'
        
    try:
        tkr = yf.Ticker(ticker)
        df = tkr.history(period=range_key, interval=interval)
        df.dropna(subset=['Open', 'High', 'Low', 'Close'], inplace=True)
        if df.empty:
            return 0
            
        candles = []
        
        tz_name = 'America/New_York' if region == 'us' else 'Asia/Kolkata'
        try:
            tz = ZoneInfo(tz_name)
        except TypeError:
            tz = ZoneInfo.timezone(tz_name)
            
        for ts, row in df.iterrows():
            if hasattr(ts, 'astimezone'):
                dt_local = ts.astimezone(tz)
            else:
                dt_local = datetime.fromtimestamp(ts.timestamp(), tz=tz)
                
            dt_str = dt_local.strftime('%Y-%m-%d %H:%M')
            ts_unix = int(ts.timestamp())
            o, h, l, c, v = row['Open'], row['High'], row['Low'], row['Close'], row['Volume']
            candles.append((ticker, range_key, ts_unix, dt_str, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v or 0)))
            
        if candles:
            conn = sqlite3.connect(get_db_path(region))
            cursor = conn.cursor()
            cursor.executemany('''
                INSERT OR REPLACE INTO candles_range (ticker, range_key, timestamp, datetime_str, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', candles)
            conn.commit()
            conn.close()
            evaluate_patterns_range(ticker, range_key, region)
        return len(candles)
    except Exception as e:
        print(f"Error fetching range {range_key} for {ticker}: {e}")
        return 0

def evaluate_patterns_range(ticker, range_key, region='india'):
    """Evaluate 15 Candlestick patterns on candles of specified range using higher timeframe aggregation to reduce noise"""
    conn = sqlite3.connect(get_db_path(region))
    cursor = conn.cursor()
    cursor.execute("SELECT timestamp, datetime_str, open, high, low, close, volume FROM candles_range WHERE ticker=? AND range_key=? ORDER BY timestamp ASC", (ticker, range_key))
    rows = cursor.fetchall()
    conn.close()
    
    if len(rows) < 5:
        return
        
    # Aggregation Logic
    grouped_blocks = {}
    for r in rows:
        ts, dt_str, o, h, l, c, v = r
        if range_key == '1d':
            # Group by YYYY-MM-DD HH (hourly)
            group_key = dt_str[:13]
        elif range_key in ['5d', '1mo', '3mo']:
            # Group by YYYY-MM-DD (daily)
            group_key = dt_str[:10]
        else:
            # 6mo -> Group by ISO week (%Y-W%W)
            dt_obj = datetime.strptime(dt_str, '%Y-%m-%d %H:%M')
            group_key = dt_obj.strftime('%Y-W%W')
            
        if group_key not in grouped_blocks:
            grouped_blocks[group_key] = []
        grouped_blocks[group_key].append(r)
        
    synthetic_rows = []
    for k, block in grouped_blocks.items():
        # Open from first candle
        agg_open = block[0][2]
        # Close, ts, dt_str from last candle
        agg_close = block[-1][5]
        agg_ts = block[-1][0]
        agg_dt = block[-1][1]
        # Max high, Min low, Sum vol
        agg_high = max(r[3] for r in block)
        agg_low = min(r[4] for r in block)
        agg_vol = sum(r[6] for r in block)
        synthetic_rows.append((agg_ts, agg_dt, agg_open, agg_high, agg_low, agg_close, agg_vol))
        
    synthetic_rows.sort(key=lambda x: x[0])
    
    if len(synthetic_rows) < 3:
        return
        
    detected = []
    
    for i in range(2, len(synthetic_rows)):
        prev2 = synthetic_rows[i-2]
        prev = synthetic_rows[i-1]
        curr = synthetic_rows[i]
        
        ts, dt_str, c_o, c_h, c_l, c_c, c_v = curr
        p_ts, p_dt, p_o, p_h, p_l, p_c, p_v = prev
        
        body = abs(c_c - c_o)
        upper_wick = c_h - max(c_o, c_c)
        lower_wick = min(c_o, c_c) - c_l
        total_range = c_h - c_l
        
        if total_range == 0:
            continue
            
        is_bullish = c_c > c_o
        is_bearish = c_c < c_o
        
        # 1. Doji
        if body <= total_range * 0.1:
            detected.append((ticker, range_key, ts, dt_str, 'Doji (1)', 'Neutral', c_c, f'Body {round(body,2)} <= 10% of range {round(total_range,2)}'))
            
        # 2. Hammer
        if lower_wick >= 2 * body and upper_wick <= body * 0.5 and is_bullish:
            detected.append((ticker, range_key, ts, dt_str, 'Hammer (3)', 'Bullish', c_c, f'Lower wick {round(lower_wick,2)} >= 2x body {round(body,2)}'))
            
        # 3. Inverted Hammer
        if upper_wick >= 2 * body and lower_wick <= body * 0.5 and is_bullish:
            detected.append((ticker, range_key, ts, dt_str, 'Inverted Hammer (2)', 'Bullish', c_c, f'Upper wick {round(upper_wick,2)} >= 2x body {round(body,2)}'))
            
        # 4. Shooting Star
        if upper_wick >= 2 * body and lower_wick <= body * 0.5 and is_bearish:
            detected.append((ticker, range_key, ts, dt_str, 'Shooting Star (3)', 'Bearish', c_c, f'Upper wick {round(upper_wick,2)} >= 2x body {round(body,2)}'))
            
        # 5. Hanging Man
        if lower_wick >= 2 * body and upper_wick <= body * 0.5 and is_bearish:
            detected.append((ticker, range_key, ts, dt_str, 'Hanging Man (2)', 'Bearish', c_c, f'Lower wick {round(lower_wick,2)} >= 2x body {round(body,2)}'))
            
        # 6. Bullish Engulfing
        p_body = abs(p_c - p_o)
        if p_c < p_o and is_bullish and c_c > p_o and c_o < p_c:
            detected.append((ticker, range_key, ts, dt_str, 'Bullish Engulfing (4)', 'Bullish', c_c, f'Green body ({round(body,2)}) > red body ({round(p_body,2)})'))
            
        # 7. Bearish Engulfing
        if p_c > p_o and is_bearish and c_c < p_o and c_o > p_c:
            detected.append((ticker, range_key, ts, dt_str, 'Bearish Engulfing (4)', 'Bearish', c_c, f'Red body ({round(body,2)}) > green body ({round(p_body,2)})'))
            
        # 8. Morning Star (3 candles)
        if len(synthetic_rows) > i and i >= 2:
            if p_c < p_o and body <= total_range * 0.3 and c_c > c_o and c_c > p_o + (abs(p_o - p_c) / 2):
                detected.append((ticker, range_key, ts, dt_str, 'Morning Star (5)', 'Bullish', c_c, f'Close ({round(c_c,2)}) > mid of red body ({round(p_o + (abs(p_o - p_c) / 2),2)})'))
                
        # 9. Evening Star
        if len(synthetic_rows) > i and i >= 2:
            if p_c > p_o and body <= total_range * 0.3 and c_c < c_o and c_c < p_o - (abs(p_o - p_c) / 2):
                detected.append((ticker, range_key, ts, dt_str, 'Evening Star (5)', 'Bearish', c_c, f'Close ({round(c_c,2)}) < mid of green body ({round(p_o - (abs(p_o - p_c) / 2),2)})'))
                
        # 10. Piercing Line
        if p_c < p_o and is_bullish and c_o < p_l and c_c > (p_o + p_c)/2 and c_c < p_o:
            detected.append((ticker, range_key, ts, dt_str, 'Piercing Line (4)', 'Bullish', c_c, f'Bullish close above midpoint of previous red candle'))
            
        # 11. Dark Cloud Cover
        if p_c > p_o and is_bearish and c_o > p_h and c_c < (p_o + p_c)/2 and c_c > p_o:
            detected.append((ticker, range_key, ts, dt_str, 'Dark Cloud Cover (4)', 'Bearish', c_c, f'Bearish close below midpoint of previous green candle'))
            
        # 12. Bullish Harami
        if p_c < p_o and is_bullish and c_o > p_c and c_c < p_o:
            detected.append((ticker, range_key, ts, dt_str, 'Bullish Harami (2)', 'Bullish', c_c, f'Small green candle inside previous red candle'))
            
        # 13. Bearish Harami
        if p_c > p_o and is_bearish and c_o < p_c and c_c > p_o:
            detected.append((ticker, range_key, ts, dt_str, 'Bearish Harami (2)', 'Bearish', c_c, f'Small red candle inside previous green candle'))
            
        # 14. Marubozu Bullish
        if is_bullish and upper_wick <= total_range * 0.05 and lower_wick <= total_range * 0.05:
            detected.append((ticker, range_key, ts, dt_str, 'Marubozu Bullish (4)', 'Bullish', c_c, f'Full body bullish candle'))
            
        # 15. Marubozu Bearish
        if is_bearish and upper_wick <= total_range * 0.05 and lower_wick <= total_range * 0.05:
            detected.append((ticker, range_key, ts, dt_str, 'Marubozu Bearish (4)', 'Bearish', c_c, f'Full body bearish candle'))
            
    try:
        conn = sqlite3.connect(get_db_path(region))
        cursor = conn.cursor()
        if len(detected) > 0:
            cursor.executemany('''
                INSERT OR IGNORE INTO patterns_range (ticker, range_key, timestamp, datetime_str, pattern_name, pattern_type, price, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', detected)
            conn.commit()
    except Exception as e:
        print("DB error during pattern insert:", e)
    finally:
        conn.close()

class RequestHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        public_dir = os.path.join(base_dir, 'public')
        if path == '/' or path == '/index.html':
            return os.path.join(public_dir, 'index.html')
        elif path.startswith('/css/') or path.startswith('/js/') or path == '/app.html' or path == '/summary.html':
            return public_dir + path
        return super().translate_path(path)
        
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        query = urllib.parse.parse_qs(parsed_path.query)
        region = query.get('region', ['india'])[0]
        
        if path == '/api/watchlist':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            conn = sqlite3.connect(get_db_path(region))
            cursor = conn.cursor()
            cursor.execute("SELECT ticker FROM watchlist ORDER BY added_at DESC")
            tickers = [row[0] for row in cursor.fetchall()]
            conn.close()
            
            self.wfile.write(json.dumps({'watchlist': tickers}).encode('utf-8'))
            
        elif path == '/api/watchlist/add':
            ticker = query.get('ticker', [''])[0].upper()
            if ticker:
                conn = sqlite3.connect(get_db_path(region))
                cursor = conn.cursor()
                cursor.execute("INSERT OR IGNORE INTO watchlist (ticker, added_at) VALUES (?, datetime('now'))", (ticker,))
                conn.commit()
                conn.close()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}).encode('utf-8'))
            else:
                self.send_error(400, "Missing ticker")
                
        elif path == '/api/watchlist/remove':
            ticker = query.get('ticker', [''])[0].upper()
            if ticker:
                conn = sqlite3.connect(get_db_path(region))
                cursor = conn.cursor()
                cursor.execute("DELETE FROM watchlist WHERE ticker=?", (ticker,))
                conn.commit()
                conn.close()
                self._send_json({'success': True})
            else:
                self._send_json({'success': False, 'message': 'Missing ticker'})
                
        elif path == '/api/db/clean':
            conn = sqlite3.connect(get_db_path(region))
            cursor = conn.cursor()
            cursor.execute("DELETE FROM candles_range")
            cursor.execute("DELETE FROM patterns_range")
            conn.commit()
            
            # Reclaim disk space
            conn.execute("VACUUM")
            
            conn.close()
            self._send_json({'success': True, 'message': 'Database cleaned successfully'})
                
        elif path == '/api/candles':
            ticker = query.get('ticker', [''])[0].upper()
            range_key = query.get('range', ['1mo'])[0]
            
            if ticker:
                conn = sqlite3.connect(get_db_path(region))
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM candles_range WHERE ticker=? AND range_key=?", (ticker, range_key))
                count = cursor.fetchone()[0]
                conn.close()
                
                if count == 0 or query.get('refresh', ['false'])[0] == 'true':
                    fetch_yahoo_range(ticker, range_key, region)
                    
                conn = sqlite3.connect(get_db_path(region))
                cursor = conn.cursor()
                cursor.execute("SELECT timestamp, datetime_str, open, high, low, close, volume FROM candles_range WHERE ticker=? AND range_key=? ORDER BY timestamp ASC", (ticker, range_key))
                rows = cursor.fetchall()
                conn.close()
                
                candles = [{'timestamp': r[0], 'datetime': r[1], 'open': r[2], 'high': r[3], 'low': r[4], 'close': r[5], 'volume': r[6]} for r in rows]
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'ticker': ticker, 'range': range_key, 'candles': candles}).encode('utf-8'))
            else:
                self.send_error(400, "Missing ticker")
                
        elif path == '/api/patterns':
            ticker = query.get('ticker', [''])[0].upper()
            range_key = query.get('range', ['1mo'])[0]
            
            if ticker:
                conn = sqlite3.connect(get_db_path(region))
                cursor = conn.cursor()
                cursor.execute("SELECT timestamp, datetime_str, pattern_name, pattern_type, price, details FROM patterns_range WHERE ticker=? AND range_key=? ORDER BY timestamp DESC", (ticker, range_key))
                rows = cursor.fetchall()
                conn.close()
                
                patterns = [{'timestamp': r[0], 'datetime': r[1], 'pattern_name': r[2], 'pattern_type': r[3], 'price': r[4], 'details': r[5]} for r in rows]
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'ticker': ticker, 'range': range_key, 'patterns': patterns}).encode('utf-8'))
            else:
                self.send_error(400, "Missing ticker")
                
        elif path == '/api/summary':
            conn = sqlite3.connect(get_db_path(region))
            cursor = conn.cursor()
            
            # 1. Get all tickers in watchlist
            cursor.execute("SELECT ticker FROM watchlist")
            watchlist_tickers = [row[0] for row in cursor.fetchall()]
            
            if not watchlist_tickers:
                conn.close()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'region': region, 'summary': []}).encode('utf-8'))
                return

            # 2. Fetch the most recent pattern per ticker across any timeframe
            cursor.execute("""
                SELECT ticker, range_key, timestamp, datetime_str, pattern_name, pattern_type, price, details
                FROM patterns_range 
                WHERE (ticker, timestamp) IN (
                    SELECT ticker, MAX(timestamp) 
                    FROM patterns_range 
                    GROUP BY ticker
                )
            """)
            pattern_rows = cursor.fetchall()
            conn.close()
            
            # Map patterns by ticker
            patterns_by_ticker = {
                r[0]: {
                    'range': r[1],
                    'timestamp': r[2],
                    'datetime': r[3],
                    'pattern_name': r[4],
                    'pattern_type': r[5],
                    'pattern_price': r[6],
                    'details': r[7]
                } for r in pattern_rows
            }
            
            # 3. Fetch live prices via yfinance for all watchlist tickers simultaneously
            live_prices = {}
            try:
                import yfinance as yf
                data = yf.download(watchlist_tickers, period='1d', interval='1m', progress=False)
                if not data.empty and 'Close' in data:
                    live_prices = data['Close'].iloc[-1].to_dict()
            except Exception as e:
                print("Error fetching live prices in summary:", e)
            
            # 4. Construct final summary payload
            summary = []
            for t in watchlist_tickers:
                p_data = patterns_by_ticker.get(t, {})
                summary.append({
                    'ticker': t,
                    'live_price': round(live_prices.get(t, 0.0), 2) if not __import__('math').isnan(live_prices.get(t, 0.0)) else 0.0,
                    'range': p_data.get('range', '--'),
                    'timestamp': p_data.get('timestamp', 0),
                    'datetime': p_data.get('datetime', '--'),
                    'pattern_name': p_data.get('pattern_name', 'No Pattern'),
                    'pattern_type': p_data.get('pattern_type', 'Neutral'),
                    'pattern_price': p_data.get('pattern_price', '--'),
                    'details': p_data.get('details', '--')
                })
            
            # Sort by pattern timestamp descending, then ticker
            summary.sort(key=lambda x: (x['timestamp'], x['ticker']), reverse=True)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'region': region, 'summary': summary}).encode('utf-8'))
            
        elif path == '/api/options':
            conn = sqlite3.connect(get_db_path(region))
            cursor = conn.cursor()
            cursor.execute("SELECT close FROM candles_range WHERE ticker=? ORDER BY timestamp DESC LIMIT 1", (ticker,))
            row = cursor.fetchone()
            conn.close()
            
            spot = row[0] if row else 24000.0  # Fallback
            
            import random
            random.seed(spot) # Stable random for demonstration
            base = round(spot / 50) * 50
            strikes = [base + i*50 for i in range(-5, 6)]
            options = []
            for s in strikes:
                call_ltp = max(0.5, 300 - (s - spot)*0.5 + random.uniform(-10, 10))
                put_ltp = max(0.5, 300 + (s - spot)*0.5 + random.uniform(-10, 10))
                options.append({
                    'strike': s,
                    'call_ltp': round(call_ltp, 2),
                    'call_oi': random.randint(1000, 150000),
                    'put_ltp': round(put_ltp, 2),
                    'put_oi': random.randint(1000, 150000)
                })
                
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'ticker': ticker, 
                'spot': spot,
                'options': options,
                'note': 'Simulated Option Chain due to Yahoo Finance restrictions'
            }).encode('utf-8'))
            
        else:
            super().do_GET()
            
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        region = query.get('region', ['india'])[0]
        
        if path == '/api/watchlist/add':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            ticker = body.get('ticker', '').strip().upper()
            if ticker:
                conn = sqlite3.connect(get_db_path(region))
                cursor = conn.cursor()
                cursor.execute("INSERT OR IGNORE INTO watchlist (ticker, added_at) VALUES (?, datetime('now'))", (ticker,))
                conn.commit()
                conn.close()
                fetch_yahoo_range(ticker, '1mo', region)
                self._send_json({'status': 'ok', 'ticker': ticker})
            else:
                self._send_json({'status': 'error', 'message': 'Invalid ticker'}, 400)
        else:
            self._send_json({'status': 'error', 'message': 'Not found'}, 404)
            
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    init_db('india')
    init_db('us')
    init_db('india_deriv')
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    public_dir = os.path.join(base_dir, 'public')
    os.chdir(public_dir)
    server = HTTPServer(('0.0.0.0', 8001), RequestHandler)
    print("Serving Multi-Timeframe Pattern Analyzer App on http://localhost:8001")
    server.serve_forever()
