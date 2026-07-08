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
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
  }
  return browser;
}

function isBlockedPage(text) {
  const lower = (text || '').toLowerCase();
  const patterns = [
    'captcha', 'cf-captcha', 'challenge-platform', 'just a moment',
    'enable javascript', 'please turn javascript', 'checking your browser',
    'access denied', 'sorry, you have been blocked', 'robot check',
    'request blocked', 'too many requests', 'rate limit exceeded', '429',
    'something went wrong', 'e002', 'e001',
  ];
  return patterns.some(p => lower.includes(p)) || lower.length < 500;
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

  let browserInstance;
  let page = null;

  try {
    browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    const html = await page.content();

    if (isBlockedPage(html)) {
      await page.close();
      return res.json({ success: false, error: 'Blocked by target site' });
    }

    const status = response?.status();
    if (status && status >= 400) {
      await page.close();
      return res.json({ success: false, error: `HTTP ${status}` });
    }

    // Wait a bit for dynamic content
    await new Promise(r => setTimeout(r, 2000));

    const data = extractFromPage(page);
    await page.close();

    if (!data.currentPrice) {
      // Fallback: try regex on raw HTML
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
