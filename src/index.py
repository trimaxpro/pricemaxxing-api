import json, os, random, re, time, traceback
from flask import Flask, request, jsonify
import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

app = Flask(__name__)

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')

_browser = None
_playwright = None

def get_browser():
    global _browser, _playwright
    if _browser is None or not _browser.is_connected():
        if _playwright is None:
            _playwright = sync_playwright().start()
        _browser = _playwright.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--disable-blink-features=AutomationControlled',
            ]
        )
    return _browser

# ─── MYNTRA ───────────────────────────────────────────────────────────────────

def scrape_myntra(url):
    s = requests.Session()
    s.headers.update({
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
        'Referer': 'https://www.myntra.com/',
    })
    try:
        s.get('https://www.myntra.com/', timeout=10)
        time.sleep(random.uniform(0.5, 1.5))
    except:
        pass

    r = s.get(url, timeout=30)
    if r.status_code != 200:
        return None

    m = re.search(r'window\.__myx\s*=\s*(\{.+?\});', r.text, re.DOTALL)
    if not m:
        return None

    data = json.loads(m.group(1))
    pdp = data.get('pdpData', {}) or {}
    price = pdp.get('price', {}) or {}
    brand = (pdp.get('brand') or {}).get('name', '') or ''
    name = pdp.get('name', '') or ''
    title = name if brand in name else f'{brand} {name}'.strip()
    cp = price.get('discounted') or price.get('sellingPrice') or price.get('amount')
    op = price.get('mrp') or price.get('originalPrice')
    disc = price.get('discountPercent')
    img = pdp.get('searchImage') or pdp.get('image') or (pdp.get('media') or [None])[0] if isinstance(pdp.get('media'), list) else None
    avail = not (pdp.get('flags') or {}).get('outOfStock', False)

    if title and cp and cp > 0:
        if op and cp >= op:
            op = None
        if not disc and op and op > cp:
            disc = round((1 - cp / op) * 100)
        return {
            'title': title, 'currentPrice': cp, 'originalPrice': op,
            'currency': '₹', 'imageUrl': img, 'availability': avail,
            'discountPercent': disc,
        }
    return None

# ─── FLIPKART ─────────────────────────────────────────────────────────────────

def try_extract_fk_api(data):
    p = data.get('product') or (data.get('data') or {}).get('product') or (data.get('response') or {}).get('product') or data
    title = p.get('title') or p.get('name') or ''
    if not title:
        return None
    price = p.get('priceInfo') or p.get('price') or p.get('pricing') or {}
    cp = price.get('currentPrice') or price.get('finalPrice') or price.get('sellingPrice') or price.get('discountedPrice')
    op = price.get('originalPrice') or price.get('mrp') or price.get('listPrice')
    disc = price.get('discountPercent') or p.get('discountPercent')
    img = (p.get('image') or {}).get('url') or (p.get('image') or {}).get('src') or p.get('imageUrl') or (p.get('images') or [None])[0] if isinstance(p.get('images'), list) else None
    if title and cp and cp > 0:
        if op and cp >= op:
            op = None
        if not disc and op and op > cp:
            disc = round((1 - cp / op) * 100)
        return {'title': title, 'currentPrice': cp, 'originalPrice': op, 'currency': '₹', 'imageUrl': img, 'availability': True, 'discountPercent': disc}
    return None

def scrape_flipkart(url):
    browser = get_browser()
    context = browser.new_context(
        viewport={'width': 1920 + random.randint(0, 100), 'height': 1080 + random.randint(0, 100)},
        user_agent=UA,
        locale='en-IN',
    )
    page = context.new_page()

    apis = []
    def on_response(response):
        u = response.url
        if '.api.flipkart.com' in u and ('/product/' in u or '/page/' in u or 'price' in u or 'offers' in u):
            try:
                ct = response.headers.get('content-type', '')
                if 'json' in ct:
                    apis.append(response.json())
            except:
                pass

    page.on('response', on_response)

    try:
        r = page.goto(url, wait_until='networkidle', timeout=35000)
        if r and 400 <= r.status < 500:
            return None
        page.wait_for_timeout(4000)

        for d in apis:
            r = try_extract_fk_api(d)
            if r:
                return r

        data = page.evaluate('''() => {
            const d = {};
            document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
                try {
                    const j = JSON.parse(s.textContent);
                    if (j.offers) {
                        (Array.isArray(j.offers) ? j.offers : [j.offers]).forEach(o => {
                            const p = parseFloat(o.price);
                            if (p > 0) { d.currentPrice = p; d.title = d.title || j.name; d.originalPrice = d.originalPrice || parseFloat(o.highPrice) || null; }
                        });
                    }
                    d.title = d.title || j.name;
                } catch(e) {}
            });
            const pe = document.querySelector('[class*="price"]') || document.querySelector('[class*="Price"]');
            if (pe) { const m = (pe.textContent || '').match(/₹\\s*([\\d,]+(?:\\.\\d{1,2})?)/); if (m) d.currentPrice = d.currentPrice || parseFloat(m[1].replace(/,/g, '')); }
            const me = document.querySelector('[class*="mrp"]') || document.querySelector('[class*="original"]');
            if (me) { const m = (me.textContent || '').match(/₹\\s*([\\d,]+(?:\\.\\d{1,2})?)/); if (m) { const p = parseFloat(m[1].replace(/,/g, '')); if (p > 0 && (!d.originalPrice || p > d.currentPrice)) d.originalPrice = p; }}
            if (!d.currentPrice) {
                const lines = (document.body?.innerText || '').split('\\n').filter(l => l.includes('₹'));
                const prices = lines.map(l => { const m = l.match(/₹\\s*([\\d,]+(?:\\.\\d{1,2})?)/); return m ? parseFloat(m[1].replace(/,/g, '')) : null; }).filter(p => p !== null && p > 20 && p < 10000000);
                if (prices.length > 0) {
                    prices.sort((a, b) => a - b);
                    d.currentPrice = prices[Math.floor(prices.length / 2)];
                    const uniq = [...new Set(prices)].sort((a, b) => a - b);
                    if (uniq.length > 1) d.originalPrice = uniq[uniq.length - 1];
                }
            }
            d.title = d.title || document.querySelector('h1 span')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || document.title.split(' - ')[0]?.trim() || document.title.split('|')[0]?.trim() || '';
            const img = document.querySelector('[class*="image"] img') || document.querySelector('img[src*="flipkart"]') || document.querySelector('img[src*="rukmini"]');
            d.imageUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || null;
            const de = document.querySelector('[class*="discount"]');
            if (de) { const m = de.textContent.match(/(\\d+)%/); if (m) d.discountPercent = parseInt(m[1]); }
            if (!d.discountPercent && d.originalPrice > d.currentPrice) d.discountPercent = Math.round((1 - d.currentPrice / d.originalPrice) * 100);
            return d;
        }''')

        if data.get('currentPrice') and data['currentPrice'] > 0:
            return {
                'title': data.get('title', 'Product'),
                'currentPrice': data['currentPrice'],
                'originalPrice': data.get('originalPrice') if data.get('originalPrice', 0) > data['currentPrice'] else None,
                'currency': '₹',
                'imageUrl': data.get('imageUrl'),
                'availability': True,
                'discountPercent': data.get('discountPercent'),
            }

        html = page.content()
        pm = re.search(r'(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)', html, re.IGNORECASE)
        if pm:
            p = float(pm.group(1).replace(',', ''))
            if p > 10:
                tm = re.search(r'<title>([^<]+)</title>', html)
                return {'title': (tm.group(1) if tm else '').split(' - ')[0].strip() or 'Product', 'currentPrice': p, 'originalPrice': None, 'currency': '₹', 'imageUrl': None, 'availability': True, 'discountPercent': None}
        return None
    except Exception as e:
        print(f'Flipkart error: {e}')
        return None
    finally:
        context.close()

# ─── ROUTES ────────────────────────────────────────────────────────────────────

@app.route('/scrape', methods=['POST'])
def scrape():
    body = request.get_json(silent=True) or {}
    url = body.get('url')
    store = body.get('store', '')
    if not url:
        return jsonify({'success': False, 'error': 'url is required'}), 400

    print(f'Scraping {store or "unknown"}: {url}')
    try:
        is_myntra = store == 'myntra' or 'myntra.com' in url
        result = scrape_myntra(url) if is_myntra else scrape_flipkart(url)
        if result:
            return jsonify({'success': True, 'data': result})
        return jsonify({'success': False, 'error': 'Could not extract product data'})
    except Exception as e:
        print(f'Scrape error: {e}\\n{traceback.format_exc()}')
        return jsonify({'success': False, 'error': str(e)})

@app.route('/health')
def health():
    return jsonify({'success': True, 'uptime': time.time()})

@app.route('/debug', methods=['POST'])
def debug():
    body = request.get_json(silent=True) or {}
    url = body.get('url')
    if not url:
        return jsonify({'success': False, 'error': 'url is required'}), 400

    if 'myntra.com' in url:
        s = requests.Session()
        s.headers.update({'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8'})
        s.get('https://www.myntra.com/', timeout=15)
        r = s.get(url, timeout=20)
        has_myx = 'window.__myx' in r.text
        m = re.search(r'window\.__myx\s*=\s*(\{.+?\});', r.text, re.DOTALL)
        pdp = json.loads(m.group(1)).get('pdpData', {}) if m else None
        return jsonify({
            'success': True, 'status': r.status_code, 'htmlLen': len(r.text),
            'hasWindowMyx': has_myx,
            'pdpKeys': list(pdp.keys())[:15] if pdp else None,
            'snippet': r.text[:1500],
        })

    browser = get_browser()
    context = browser.new_context(user_agent=UA, viewport={'width': 1920, 'height': 1080})
    page = context.new_page()
    apis = []
    def on_resp(response):
        if 'api' in response.url and 'json' in response.headers.get('content-type', ''):
            apis.append({'url': response.url[:200], 'status': response.status})
    page.on('response', on_resp)

    try:
        r = page.goto(url, wait_until='networkidle', timeout=30000)
        page.wait_for_timeout(3000)
        html = page.content()
        pd = page.evaluate('''() => {
            const t = document.body?.innerText || '';
            return { h1: document.querySelector('h1')?.textContent?.trim() || '', title: document.title, prices: [...t.matchAll(/₹\\s*([\\d,]+(?:\\.\\d{1,2})?)/g)].slice(0,10).map(m => m[0]) };
        }''')
        return jsonify({
            'success': True, 'status': r.status if r else None, 'htmlLen': len(html),
            'pageData': pd, 'apis': apis[:5], 'snippet': html[:1500],
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
    finally:
        context.close()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(host='0.0.0.0', port=port)
