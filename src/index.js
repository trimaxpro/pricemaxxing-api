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
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browser;
}

async function setupPage(page) {
  await page.setViewport({ width: 1920 + Math.floor(Math.random() * 100), height: 1080 + Math.floor(Math.random() * 100) });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en', 'hi'] });
  });
}

// --- Myntra ---

function extractProductId(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/').filter(Boolean);
    const pidIdx = parts.findIndex(p => p === 'pid');
    if (pidIdx !== -1 && parts[pidIdx + 1]) return parts[pidIdx + 1];
    for (const part of parts.toReversed()) {
      if (/^\d{5,}$/.test(part)) return part;
    }
    return null;
  } catch { return null; }
}

async function seedMyntraCookies() {
  try {
    const res = await fetch('https://www.myntra.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    });
    const cookies = res.headers.getSetCookie?.() || [];
    return cookies.map(c => c.split(';')[0]).join('; ');
  } catch { return ''; }
}

async function fetchMyntraApi(productId, cookie) {
  const apiUrls = [
    `https://www.myntra.com/gateway/v2/product/${productId}`,
    `https://www.myntra.com/gateway/v1/product/${productId}`,
    `https://www.myntra.com/api/product/${productId}`,
  ];

  for (const apiUrl of apiUrls) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7',
        'Referer': `https://www.myntra.com/gateway/v2/product/${productId}`,
        'Origin': 'https://www.myntra.com',
      };
      if (cookie) headers['Cookie'] = cookie;

      const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;

      const raw = await res.json();
      const product = raw.product || raw.data || raw;
      if (!product) continue;

      const sizeData = product.sizes?.[0]?.sizeSellerData?.[0];
      const priceData = product.price || {};
      const name = product.name || product.title || '';
      const brand = product.brand?.name || product.brandName || '';
      const title = brand ? `${brand} ${name}` : name;
      const currentPrice = sizeData?.discountedPrice || priceData.amount || product.sellingPrice || product.price?.sellingPrice || priceData.mrp || null;
      const originalPrice = priceData.mrp || product.mrp || sizeData?.mrp || null;
      const discount = priceData.discountPercent || product.discountPercent || sizeData?.discountPercent || null;
      const imageUrl = product.searchImage || product.image || product.imageUrl || product.media?.albums?.[0]?.images?.[0]?.src || product.media?.[0]?.src || null;
      const availability = !product.flags?.outOfStock && (product.sizes?.some?.(s => s.available) ?? true);

      if (title && currentPrice > 0) {
        return {
          title, currentPrice,
          originalPrice: originalPrice > currentPrice ? originalPrice : null,
          currency: '₹', imageUrl, availability,
          discountPercent: discount || (originalPrice > currentPrice ? Math.round((1 - currentPrice / originalPrice) * 100) : null),
        };
      }
    } catch (e) {
      console.error(`Myntra API error (${apiUrl}):`, e.message);
    }
  }
  return null;
}

async function scrapeMyntraViaPuppeteer(url) {
  let page;
  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    await setupPage(page);

    const apiResults = [];
    await page.setRequestInterception(true);
    page.on('request', req => req.continue());

    page.on('response', async (res) => {
      const reqUrl = res.url();
      if (reqUrl.includes('gateway/v') && reqUrl.includes('/product/')) {
        try {
          const json = await res.json();
          apiResults.push(json);
        } catch {}
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 3000));

    if (apiResults.length > 0) {
      const product = apiResults[0];
      const p = product.product || product.data || product;
      if (p?.name || p?.title) {
        const sizeData = p.sizes?.[0]?.sizeSellerData?.[0];
        const priceData = p.price || {};
        const name = p.name || p.title || '';
        const brand = p.brand?.name || p.brandName || '';
        const title = brand ? `${brand} ${name}` : name;
        const currentPrice = sizeData?.discountedPrice || priceData.amount || p.sellingPrice || null;
        const originalPrice = priceData.mrp || p.mrp || sizeData?.mrp || null;
        const discount = priceData.discountPercent || p.discountPercent || null;
        const imageUrl = p.searchImage || p.image || p.media?.albums?.[0]?.images?.[0]?.src || null;
        const availability = !p.flags?.outOfStock && (p.sizes?.some?.(s => s.available) ?? true);

        if (title && currentPrice > 0) {
          return {
            title, currentPrice,
            originalPrice: originalPrice > currentPrice ? originalPrice : null,
            currency: '₹', imageUrl, availability,
            discountPercent: discount || (originalPrice > currentPrice ? Math.round((1 - currentPrice / originalPrice) * 100) : null),
          };
        }
      }
    }

    const data = await page.evaluate(() => {
      const d = {};
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const j = JSON.parse(s.textContent);
          if (j.offers) {
            const offers = Array.isArray(j.offers) ? j.offers : [j.offers];
            for (const o of offers) {
              const p = parseFloat(o.price);
              if (p > 0) { d.currentPrice = p; d.title = d.title || j.name; d.originalPrice = d.originalPrice || parseFloat(o.highPrice) || null; break; }
            }
          }
          d.title = d.title || j.name;
        } catch {}
      }

      const priceEl = document.querySelector('.pdp-price') || document.querySelector('[class*="pdp-price"]') || document.querySelector('.pdp-product-price') || document.querySelector('[class*="Price"]');
      if (priceEl) d.currentPrice = d.currentPrice || parseFloat((priceEl.textContent || '').replace(/[^0-9.]/g, ''));
      const mrpEl = document.querySelector('.pdp-mrp') || document.querySelector('s') || document.querySelector('del');
      if (mrpEl) {
        const p = parseFloat((mrpEl.textContent || '').replace(/[^0-9.]/g, ''));
        if (p > 0 && (!d.originalPrice || p > d.currentPrice)) d.originalPrice = p;
      }
      d.title = d.title || document.querySelector('.pdp-title')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || '';
      const imgEl = document.querySelector('.image-grid-image') || document.querySelector('[class*="product-image"] img') || document.querySelector('img[src*="myntra"]');
      d.imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;
      const discEl = document.querySelector('[class*="discount"]');
      if (discEl) { const m = discEl.textContent.match(/(\d+)%/); if (m) d.discountPercent = parseInt(m[1]); }
      if (!d.discountPercent && d.originalPrice > d.currentPrice) d.discountPercent = Math.round((1 - d.currentPrice / d.originalPrice) * 100);
      return d;
    });

    if (data.currentPrice > 0) {
      return {
        title: data.title || 'Product', currentPrice: data.currentPrice,
        originalPrice: data.originalPrice > data.currentPrice ? data.originalPrice : null,
        currency: '₹', imageUrl: data.imageUrl || null, availability: true,
        discountPercent: data.discountPercent || null,
      };
    }

    return null;
  } catch (err) {
    console.error(`Myntra Puppeteer error:`, err.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function scrapeMyntra(url) {
  const productId = extractProductId(url);
  if (!productId) return null;

  const cookie = await seedMyntraCookies();
  const apiResult = await fetchMyntraApi(productId, cookie);
  if (apiResult) return apiResult;

  return scrapeMyntraViaPuppeteer(url);
}

// --- Flipkart ---

async function scrapeFlipkartViaPuppeteer(url) {
  let page;
  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    await setupPage(page);

    const apiResponses = [];
    await page.setRequestInterception(true);
    page.on('request', req => req.continue());

    page.on('response', async (res) => {
      const reqUrl = res.url();
      if (reqUrl.includes('.api.flipkart.com') && (reqUrl.includes('/product/') || reqUrl.includes('/page/') || reqUrl.includes('price') || reqUrl.includes('offers'))) {
        try {
          const ct = res.headers()['content-type'] || '';
          if (ct.includes('json')) {
            const json = await res.json();
            apiResponses.push(json);
          }
        } catch {}
      }
    });

    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
    if (!resp || (resp.status() >= 400 && resp.status() < 500)) return null;

    await new Promise(r => setTimeout(r, 4000));

    if (apiResponses.length > 0) {
      for (const data of apiResponses) {
        const extracted = tryExtractFlipkartApiData(data);
        if (extracted) return extracted;
      }
    }

    const data = await page.evaluate(() => {
      const d = {};

      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const j = JSON.parse(s.textContent);
          if (j.offers) {
            const offers = Array.isArray(j.offers) ? j.offers : [j.offers];
            for (const o of offers) {
              const p = parseFloat(o.price);
              if (p > 0) { d.currentPrice = p; d.title = d.title || j.name; d.originalPrice = d.originalPrice || parseFloat(o.highPrice) || null; break; }
            }
          }
          d.title = d.title || j.name;
        } catch {}
      }

      const priceEl = document.querySelector('[class*="price"]') || document.querySelector('[class*="Price"]') || document.querySelector('[class*="amount"]');
      if (priceEl) {
        const t = priceEl.textContent || '';
        const m = t.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
        if (m) d.currentPrice = d.currentPrice || parseFloat(m[1].replace(/,/g, ''));
      }

      const mrpEl = document.querySelector('[class*="mrp"]') || document.querySelector('[class*="MRP"]') || document.querySelector('[class*="original"]');
      if (mrpEl) {
        const t = mrpEl.textContent || '';
        const m = t.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
        if (m) { const p = parseFloat(m[1].replace(/,/g, '')); if (p > 0 && (!d.originalPrice || p > d.currentPrice)) d.originalPrice = p; }
      }

      if (!d.currentPrice) {
        const allText = document.body?.innerText || '';
        const matches = [...allText.matchAll(/₹\s*([\d,]+(?:\.\d{1,2})?)/g)];
        if (matches.length > 0) {
          const prices = matches.map(m => parseFloat(m[1].replace(/,/g, ''))).filter(p => p > 10 && p < 10000000);
          if (prices.length > 0) {
            prices.sort((a, b) => a - b);
            d.currentPrice = prices[0];
            if (prices.length > 1) d.originalPrice = prices[prices.length - 1];
          }
        }
      }

      d.title = d.title || document.querySelector('h1 span')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || document.title.split(' - ')[0]?.trim() || document.title.split('|')[0]?.trim() || '';
      const imgEl = document.querySelector('[class*="image"] img') || document.querySelector('img[src*="flipkart"]') || document.querySelector('img[src*="rukmini"]');
      d.imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;

      const discEl = document.querySelector('[class*="discount"]');
      if (discEl) { const m = discEl.textContent.match(/(\d+)%\s*off/i); if (m) d.discountPercent = parseInt(m[1]); }
      if (!d.discountPercent && d.originalPrice > d.currentPrice) d.discountPercent = Math.round((1 - d.currentPrice / d.originalPrice) * 100);

      return d;
    });

    if (data.currentPrice > 0) {
      return {
        title: data.title || 'Product', currentPrice: data.currentPrice,
        originalPrice: data.originalPrice > data.currentPrice ? data.originalPrice : null,
        currency: '₹', imageUrl: data.imageUrl || null, availability: true,
        discountPercent: data.discountPercent || null,
      };
    }

    const html = await page.content();
    const priceMatch = html.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (priceMatch) {
      const p = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (p > 10) {
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        return {
          title: (titleMatch?.[1] || '').split(' - ')[0]?.trim() || 'Product',
          currentPrice: p, originalPrice: null, currency: '₹',
          imageUrl: null, availability: true, discountPercent: null,
        };
      }
    }

    return null;
  } catch (err) {
    console.error(`Flipkart Puppeteer error:`, err.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function tryExtractFlipkartApiData(data) {
  try {
    const product = data?.product || data?.data?.product || data?.response?.product || data;
    if (product?.title || product?.name) {
      const priceInfo = product?.priceInfo || product?.price || product?.pricing || {};
      const title = product.title || product.name || '';
      const currentPrice = priceInfo.currentPrice || priceInfo.finalPrice || priceInfo.sellingPrice || priceInfo.discountedPrice || product.price?.amount || null;
      const originalPrice = priceInfo.originalPrice || priceInfo.mrp || priceInfo.listPrice || null;
      const discount = priceInfo.discountPercent || product.discountPercent || null;
      const imageUrl = product.image?.url || product.image?.src || product.imageUrl || product.images?.[0]?.url || null;
      if (title && currentPrice > 0) {
        return {
          title, currentPrice,
          originalPrice: originalPrice > currentPrice ? originalPrice : null,
          currency: '₹', imageUrl, availability: true,
          discountPercent: discount || (originalPrice > currentPrice ? Math.round((1 - currentPrice / originalPrice) * 100) : null),
        };
      }
    }
  } catch {}
  return null;
}

// --- Routes ---

app.post('/scrape', async (req, res) => {
  const { url, store } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });

  console.log(`Scraping ${store || 'unknown'}: ${url}`);

  const isMyntra = store === 'myntra' || url.includes('myntra.com');

  try {
    let result = null;

    if (isMyntra) {
      result = await scrapeMyntra(url);
    } else {
      result = await scrapeFlipkartViaPuppeteer(url);
    }

    if (result) {
      return res.json({ success: true, data: result });
    }

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

  let page;
  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    await setupPage(page);

    const apiResponses = [];
    page.on('response', async (r) => {
      if (r.url().includes('api') || r.url().includes('gateway')) {
        try {
          const ct = r.headers()['content-type'] || '';
          if (ct.includes('json')) {
            const j = await r.json();
            apiResponses.push({ url: r.url().substring(0, 200), keys: Object.keys(j).slice(0, 10) });
          }
        } catch {}
      }
    });

    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    const html = await page.content();
    const status = response?.status();

    const pageData = await page.evaluate(() => {
      const allText = document.body?.innerText || '';
      const prices = [...allText.matchAll(/₹\s*([\d,]+(?:\.\d{1,2})?)/g)];
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';
      const title = document.title;
      return { h1, title, priceMatches: prices.slice(0, 10).map(m => m[0]) };
    });

    res.json({
      success: true, status, htmlLength: html.length,
      pageData,
      apiResponses: apiResponses.slice(0, 5),
      isBlocked: html.length < 500,
      snippet: html.substring(0, 1500),
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Railway scraper running on port ${PORT}`);
});

process.on('SIGINT', async () => { if (browser) await browser.close().catch(() => {}); process.exit(0); });
process.on('SIGTERM', async () => { if (browser) await browser.close().catch(() => {}); process.exit(0); });
