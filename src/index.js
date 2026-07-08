import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
app.use(express.json({ limit: '1mb' }));

let browser;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--no-zygote', '--single-process',
        '--disable-blink-features=AutomationControlled', '--disable-http2',
      ],
    });
  }
  return browser;
}

async function setupPage(page) {
  await page.setViewport({ width: 1920 + Math.floor(Math.random() * 100), height: 1080 + Math.floor(Math.random() * 100) });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en', 'hi'] });
  });
}

// ============================================
// MYNTRA — extract window.__myx from HTML
// ============================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function extractMyxData(html) {
  const match = html.match(/window\.__myx\s*=\s*(\{.+?\});/s);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const pdp = data?.pdpData || {};
    const price = pdp?.price || {};
    const brand = pdp?.brand?.name || '';
    const name = pdp?.name || '';
    const title = name.includes(brand) ? name : `${brand} ${name}`.trim();
    const currentPrice = price?.discounted || price?.sellingPrice || price?.amount || null;
    const originalPrice = price?.mrp || price?.originalPrice || null;
    const discount = price?.discountPercent || null;
    const imageUrl = pdp?.searchImage || pdp?.image || pdp?.media?.[0]?.src || null;
    const availability = !pdp?.flags?.outOfStock;
    if (title && currentPrice > 0) {
      return { title, currentPrice, originalPrice: originalPrice > currentPrice ? originalPrice : null, currency: '₹', imageUrl, availability: availability ?? true, discountPercent: discount || (originalPrice > currentPrice ? Math.round((1 - currentPrice / originalPrice) * 100) : null) };
    }
  } catch {}
  return null;
}

async function scrapeMyntra(url) {
  let cookieHeader = '';
  try {
    const cookieRes = await fetch('https://www.myntra.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': 'https://www.myntra.com/' },
      signal: AbortSignal.timeout(8000),
    });
    const setCookie = cookieRes.headers.get('set-cookie') || '';
    cookieHeader = setCookie.split(',').map(c => c.split(';')[0]).join('; ');
  } catch {}

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
      'Referer': 'https://www.myntra.com/',
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return null;

  const html = await res.text();
  return extractMyxData(html);
}

// ============================================
// FLIPKART — Puppeteer with intercept + DOM
// ============================================

function tryExtractFlipkartApiData(data) {
  try {
    const p = data?.product || data?.data?.product || data?.response?.product || data;
    if (p?.title || p?.name) {
      const price = p?.priceInfo || p?.price || p?.pricing || {};
      const title = p.title || p.name || '';
      const cp = price.currentPrice || price.finalPrice || price.sellingPrice || price.discountedPrice || null;
      const op = price.originalPrice || price.mrp || price.listPrice || null;
      const disc = price.discountPercent || p.discountPercent || null;
      const img = p.image?.url || p.image?.src || p.imageUrl || p.images?.[0]?.url || null;
      if (title && cp > 0) {
        return { title, currentPrice: cp, originalPrice: op > cp ? op : null, currency: '₹', imageUrl: img, availability: true, discountPercent: disc || (op > cp ? Math.round((1 - cp / op) * 100) : null) };
      }
    }
  } catch {}
  return null;
}

async function scrapeFlipkartViaPuppeteer(url) {
  let page;
  try {
    const bi = await getBrowser();
    page = await bi.newPage();
    await setupPage(page);

    const apis = [];
    await page.setRequestInterception(true);
    page.on('request', r => r.continue());
    page.on('response', async (r) => {
      const u = r.url();
      if (u.includes('.api.flipkart.com') && (u.includes('/product/') || u.includes('/page/') || u.includes('price') || u.includes('offers'))) {
        try {
          const ct = r.headers()['content-type'] || '';
          if (ct.includes('json')) apis.push(await r.json());
        } catch {}
      }
    });

    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
    if (!resp || (resp.status() >= 400 && resp.status() < 500)) return null;
    await new Promise(r => setTimeout(r, 4000));

    for (const d of apis) { const e = tryExtractFlipkartApiData(d); if (e) return e; }

    const data = await page.evaluate(() => {
      const d = {};
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          if (j.offers) {
            for (const o of (Array.isArray(j.offers) ? j.offers : [j.offers])) {
              const p = parseFloat(o.price);
              if (p > 0) { d.currentPrice = p; d.title = d.title || j.name; d.originalPrice = d.originalPrice || parseFloat(o.highPrice) || null; break; }
            }
          }
          d.title = d.title || j.name;
        } catch {}
      }

      const priceEl = document.querySelector('[class*="price"]') || document.querySelector('[class*="Price"]');
      if (priceEl) { const m = (priceEl.textContent || '').match(/₹\s*([\d,]+(?:\.\d{1,2})?)/); if (m) d.currentPrice = d.currentPrice || parseFloat(m[1].replace(/,/g, '')); }
      const mrpEl = document.querySelector('[class*="mrp"]') || document.querySelector('[class*="original"]');
      if (mrpEl) { const m = (mrpEl.textContent || '').match(/₹\s*([\d,]+(?:\.\d{1,2})?)/); if (m) { const p = parseFloat(m[1].replace(/,/g, '')); if (p > 0 && (!d.originalPrice || p > d.currentPrice)) d.originalPrice = p; }}

      if (!d.currentPrice) {
        const lines = (document.body?.innerText || '').split('\n').filter(l => l.includes('₹'));
        const prices = lines.map(l => { const m = l.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/); return m ? parseFloat(m[1].replace(/,/g, '')) : null; }).filter(p => p !== null && p > 20 && p < 10000000);
        if (prices.length > 0) {
          prices.sort((a, b) => a - b);
          d.currentPrice = prices[Math.floor(prices.length / 2)];
          const uniq = [...new Set(prices)].sort((a, b) => a - b);
          if (uniq.length > 1) d.originalPrice = uniq[uniq.length - 1];
        }
      }

      d.title = d.title || document.querySelector('h1 span')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || document.title.split(' - ')[0]?.trim() || document.title.split('|')[0]?.trim() || '';
      const imgEl = document.querySelector('[class*="image"] img') || document.querySelector('img[src*="flipkart"]') || document.querySelector('img[src*="rukmini"]');
      d.imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;
      const discEl = document.querySelector('[class*="discount"]');
      if (discEl) { const m = discEl.textContent.match(/(\d+)%/); if (m) d.discountPercent = parseInt(m[1]); }
      if (!d.discountPercent && d.originalPrice > d.currentPrice) d.discountPercent = Math.round((1 - d.currentPrice / d.originalPrice) * 100);
      return d;
    });

    if (data.currentPrice > 0) {
      return { title: data.title || 'Product', currentPrice: data.currentPrice, originalPrice: data.originalPrice > data.currentPrice ? data.originalPrice : null, currency: '₹', imageUrl: data.imageUrl || null, availability: true, discountPercent: data.discountPercent || null };
    }

    const html = await page.content();
    const pm = html.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (pm) {
      const p = parseFloat(pm[1].replace(/,/g, ''));
      if (p > 10) {
        const tm = html.match(/<title>([^<]+)<\/title>/i);
        return { title: (tm?.[1] || '').split(' - ')[0]?.trim() || 'Product', currentPrice: p, originalPrice: null, currency: '₹', imageUrl: null, availability: true, discountPercent: null };
      }
    }
    return null;
  } catch (err) {
    console.error(`Flipkart error:`, err.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ============================================
// ROUTES
// ============================================

app.post('/scrape', async (req, res) => {
  const { url, store } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });
  console.log(`Scraping ${store || 'unknown'}: ${url}`);

  try {
    const isMyntra = store === 'myntra' || url.includes('myntra.com');
    const result = isMyntra ? await scrapeMyntra(url) : await scrapeFlipkartViaPuppeteer(url);
    if (result) return res.json({ success: true, data: result });
    res.json({ success: false, error: 'Could not extract product data' });
  } catch (err) {
    console.error(`Scrape error:`, err.message);
    res.json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ success: true, uptime: process.uptime() });
});

app.post('/debug', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });

  const isMyntra = url.includes('myntra.com');
  if (isMyntra) {
    let c = '';
    try { const cr = await fetch('https://www.myntra.com/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }); c = (cr.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0]).join('; '); } catch {}
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', ...(c ? { 'Cookie': c } : {}) }, signal: AbortSignal.timeout(25000) });
    const html = await r.text();
    const hasMyx = html.includes('window.__myx');
    const match = html.match(/window\.__myx\s*=\s*(\{.+?\});/s);
    const pdpData = match ? (JSON.parse(match[1])?.pdpData || {}) : null;
    return res.json({ success: true, status: r.status, htmlLen: html.length, hasWindowMyx: hasMyx, pdpKeys: pdpData ? Object.keys(pdpData).slice(0, 15) : null, snippet: html.substring(0, 1500) });
  }

  let page;
  try {
    const bi = await getBrowser();
    page = await bi.newPage();
    await setupPage(page);
    const apis = [];
    page.on('response', async (r) => {
      if (r.url().includes('api') && (r.headers()['content-type'] || '').includes('json')) {
        try { apis.push({ url: r.url().substring(0, 200), status: r.status() }); } catch {}
      }
    });
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    const html = await page.content();
    const pd = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      const ps = [...t.matchAll(/₹\s*([\d,]+(?:\.\d{1,2})?)/g)];
      return { h1: document.querySelector('h1')?.textContent?.trim() || '', title: document.title, prices: ps.slice(0, 10).map(m => m[0]) };
    });
    res.json({ success: true, status: resp?.status(), htmlLen: html.length, pageData: pd, apis: apis.slice(0, 5), snippet: html.substring(0, 1500) });
  } catch (err) {
    res.json({ success: false, error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Railway scraper running on port ${PORT}`); });
process.on('SIGINT', async () => { if (browser) await browser.close().catch(() => {}); process.exit(0); });
process.on('SIGTERM', async () => { if (browser) await browser.close().catch(() => {}); process.exit(0); });
