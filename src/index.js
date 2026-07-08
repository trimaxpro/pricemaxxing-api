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
      ],
    });
  }
  return browser;
}

function extractProductId(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/').filter(Boolean);
    const pidIdx = parts.findIndex(p => p === 'pid');
    if (pidIdx !== -1 && parts[pidIdx + 1]) return parts[pidIdx + 1];
    for (const part of parts.toReversed()) {
      if (/^\d+$/.test(part)) return part;
    }
    return null;
  } catch { return null; }
}

async function fetchMyntraApi(productId) {
  const apiUrls = [
    `https://www.myntra.com/gateway/v2/product/${productId}`,
    `https://www.myntra.com/gateway/v1/product/${productId}`,
    `https://www.myntra.com/api/product/${productId}`,
  ];

  for (const apiUrl of apiUrls) {
    try {
      const res = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7',
          'Referer': 'https://www.myntra.com/',
          'Origin': 'https://www.myntra.com',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;

      const raw = await res.json();
      const product = raw.product || raw.data || raw;
      if (!product) continue;

      const name = product.name || product.title || '';
      const brand = product.brand?.name || product.brandName || '';
      const title = brand ? `${brand} ${name}` : name;
      const currentPrice = product.price?.amount || product.sellingPrice || product.price || product.price?.sellingPrice || null;
      const originalPrice = product.price?.mrp || product.mrp || null;
      const discount = product.price?.discountPercent || product.discountPercent || null;
      const imageUrl = product.searchImage || product.image || product.imageUrl || product.media?.[0]?.src || null;
      const availability = product.inventoryInfo?.some(i => i.available) ?? true;

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

function isBlockedPage(text) {
  const lower = (text || '').toLowerCase();
  // Only flag if we're clearly blocked — false positives break everything
  const hardBlocks = [
    'cf-captcha', 'challenge-platform', 'just a moment',
    'checking your browser', 'please turn javascript',
  ];
  if (hardBlocks.some(p => lower.includes(p))) return true;
  // Empty pages are also blocked
  if (lower.length < 500) return true;
  return false;
}

function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return (!isNaN(num) && num > 0) ? num : null;
}

function extractFromPage(page) {
  return page.evaluate(() => {
    const data = {};

    // Try JSON-LD
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        if (json.offers) {
          const offers = Array.isArray(json.offers) ? json.offers : [json.offers];
          for (const offer of offers) {
            const p = parseFloat(offer.price);
            if (p > 0) {
              data.title = data.title || json.name;
              data.currentPrice = p;
              data.originalPrice = data.originalPrice || parseFloat(offer.highPrice) || null;
              if (json.image) {
                data.imageUrl = Array.isArray(json.image) ? json.image[0] : json.image;
              }
              break;
            }
          }
        }
        data.title = data.title || json.name;
      } catch (e) {}
    }

    // If JSON-LD failed or incomplete, try store-specific selectors
    const store = document.querySelector('[class*="flipkart"]') ? 'flipkart' : 'myntra';

    if (store === 'flipkart') {
      data.title = data.title || document.querySelector('.B_NuCI')?.textContent?.trim() || '';
      const priceEl = document.querySelector('._30jeq3._16Jk6d') || document.querySelector('._30jeq3') || document.querySelector('.Nx9bqj') || document.querySelector('.CEmiEU') || document.querySelector('[class*="price"]');
      if (priceEl) {
        const parsed = parsePrice(priceEl.textContent);
        if (parsed) data.currentPrice = data.currentPrice || parsed;
      }
      const mrpEl = document.querySelector('._3I9_wc._2p6lqe') || document.querySelector('._3I9_wc') || document.querySelector('.yF0R2_');
      if (mrpEl) {
        const parsed = parsePrice(mrpEl.textContent);
        if (parsed && (!data.originalPrice || parsed > data.currentPrice)) data.originalPrice = parsed;
      }
      const imgEl = document.querySelector('._396cs4 img') || document.querySelector('[class*="image"] img') || document.querySelector('img[src*="flipkart"]');
      data.imageUrl = data.imageUrl || imgEl?.getAttribute('src') || null;
      const discountEl = document.querySelector('.UkUFwK') || document.querySelector('[class*="discount"]');
      if (discountEl) {
        const match = discountEl.textContent.match(/(\d+)%\s*off/i);
        if (match) data.discountPercent = parseInt(match[1]);
      }
    } else {
      // Myntra
      data.title = data.title || document.querySelector('.pdp-title')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || '';
      const priceEl = document.querySelector('.pdp-price') || document.querySelector('[class*="pdp-price"]') || document.querySelector('.pdp-product-price');
      if (priceEl) {
        const parsed = parsePrice(priceEl.textContent);
        if (parsed) data.currentPrice = data.currentPrice || parsed;
      }
      const mrpEl = document.querySelector('.pdp-mrp') || document.querySelector('s') || document.querySelector('del') || document.querySelector('strike');
      if (mrpEl) {
        const parsed = parsePrice(mrpEl.textContent);
        if (parsed && (!data.originalPrice || parsed > data.currentPrice)) data.originalPrice = parsed;
      }
      const imgEl = document.querySelector('.image-grid-image') || document.querySelector('[class*="product-image"] img') || document.querySelector('img[src*="myntra"]');
      data.imageUrl = data.imageUrl || imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;
      const discountEl = document.querySelector('[class*="discount"]');
      if (discountEl) {
        const match = discountEl.textContent.match(/(\d+)%\s*off/i);
        if (match) data.discountPercent = parseInt(match[1]);
      }
    }

    // Calculate discount from prices if not found
    if (!data.discountPercent && data.originalPrice && data.currentPrice && data.originalPrice > data.currentPrice) {
      data.discountPercent = Math.round((1 - data.currentPrice / data.originalPrice) * 100);
    }

    return data;
  });
}

app.post('/scrape', async (req, res) => {
  const { url, store } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: 'url is required' });

  console.log(`Scraping ${store || 'unknown'}: ${url}`);

  // For Myntra, try the internal API first (faster, no Puppeteer)
  if (store === 'myntra' || url.includes('myntra.com')) {
    const productId = extractProductId(url);
    if (productId) {
      const apiResult = await fetchMyntraApi(productId);
      if (apiResult) {
        console.log(`Myntra API success for ${productId}`);
        return res.json({ success: true, data: apiResult });
      }
      console.log(`Myntra API failed for ${productId}, falling back to Puppeteer`);
    } else {
      console.log(`Could not extract product ID from Myntra URL, falling back to Puppeteer`);
    }
  }

  let browserInstance;
  let page = null;

  try {
    browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    // Wait extra for JS-rendered content
    await new Promise(r => setTimeout(r, 3000));

    const html = await page.content();
    console.log(`Page HTML length: ${html.length}`);

    if (isBlockedPage(html)) {
      await page.close();
      // Log first 500 chars for debugging
      console.log(`Blocked page content (first 500 chars): ${html.substring(0, 500)}`);
      return res.json({ success: false, error: 'Blocked by target site' });
    }

    const status = response?.status();
    if (status && status >= 400) {
      await page.close();
      return res.json({ success: false, error: `HTTP ${status}` });
    }

    const data = extractFromPage(page);
    await page.close();

    if (!data.currentPrice) {
      const priceMatch = html.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i);
      if (priceMatch) {
        data.currentPrice = parsePrice(priceMatch[0]);
      }
    }

    if (!data.title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) data.title = titleMatch[1].trim();
    }

    if (!data.currentPrice) {
      return res.json({ success: false, error: 'Could not extract price' });
    }

    res.json({
      success: true,
      data: {
        title: data.title || 'Product',
        currentPrice: data.currentPrice,
        originalPrice: data.originalPrice || null,
        currency: '₹',
        imageUrl: data.imageUrl || null,
        availability: true,
        discountPercent: data.discountPercent || null,
      },
    });
  } catch (err) {
    if (page) await page.close().catch(() => {});
    console.error(`Scrape error for ${url}:`, err.message);
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
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 2000));
    const html = await page.content();
    const status = response?.status();

    res.json({
      success: true,
      status,
      htmlLength: html.length,
      snippet: html.substring(0, 2000),
      isBlocked: isBlockedPage(html),
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

// Graceful shutdown
process.on('SIGINT', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});
process.on('SIGTERM', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});
