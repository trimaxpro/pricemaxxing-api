import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
app.use(express.json({ limit: '1mb' }));

// User agent pool for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
];

let browser;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--window-size=1920,1080',
        '--start-maximized',
      ],
    });
  }
  return browser;
}

async function setupPage(page) {
  // Randomize viewport size
  const width = 1920 + Math.floor(Math.random() * 200) - 100;
  const height = 1080 + Math.floor(Math.random() * 200) - 100;
  await page.setViewport({ width, height });

  // Rotate user agent
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  await page.setUserAgent(ua);

  // Comprehensive anti-detection
  await page.evaluateOnNewDocument(() => {
    // Override webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-IN', 'en-US', 'en', 'hi'],
    });

    // Override platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32',
    });

    // Override hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });

    // Override device memory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });

    // Override maxTouchPoints
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 0,
    });

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // Override chrome runtime
    window.chrome = {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      },
    };

    // Override connection
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        rtt: 50,
        downlink: 10,
        effectiveType: '4g',
        saveData: false,
      }),
    });

    // WebGL vendor and renderer
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.apply(this, arguments);
    };
  });

  // Set extra HTTP headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8,hi;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });
}

// ============================================
// MYNTRA
// ============================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Extract product ID from Myntra URL
function extractMyntraProductId(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    // Try pid pattern first
    const pidIndex = pathParts.findIndex(part => part === 'pid');
    if (pidIndex !== -1 && pathParts[pidIndex + 1]) {
      return pathParts[pidIndex + 1];
    }
    // Try last numeric segment
    for (const part of pathParts.reverse()) {
      if (/^\d+$/.test(part)) return part;
    }
  } catch {}
  return null;
}

// Try Myntra internal API (may bypass IP blocking)
async function scrapeMyntraViaApi(url) {
  const productId = extractMyntraProductId(url);
  if (!productId) return null;

  const apiUrls = [
    `https://www.myntra.com/gateway/v2/product/${productId}`,
    `https://www.myntra.com/gateway/v1/product/${productId}`,
  ];

  for (const apiUrl of apiUrls) {
    try {
      const res = await fetch(apiUrl, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json',
          'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7',
          'Referer': 'https://www.myntra.com/',
          'Origin': 'https://www.myntra.com',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const product = data.product || data.data || data;
      if (!product) continue;

      const name = product.name || product.title || '';
      const brand = product.brand?.name || product.brandName || '';
      const title = brand ? `${brand} ${name}` : name;
      const currentPrice = product.price?.amount || product.sellingPrice || product.price || 0;
      const originalPrice = product.price?.mrp || product.mrp || null;
      const discountPercent = product.price?.discountPercent || product.discountPercent || null;
      const imageUrl = product.searchImage || product.image || product.imageUrl || null;
      const availability = product.inventoryInfo?.some(item => item.available) ?? true;

      if (title && currentPrice > 0) {
        return { title, currentPrice, originalPrice, currency: '₹', imageUrl, availability, discountPercent };
      }
    } catch {}
  }
  return null;
}

function extractMyxData(html) {
  const match = html.match(/window\.__myx\s*=\s*(\{.+?\})(?:\s*;)?\s*<\//s);
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
    let imageUrl = pdp?.searchImage || pdp?.image || pdp?.media?.albums?.[0]?.images?.[0]?.secureSrc || pdp?.media?.albums?.[0]?.images?.[0]?.src || null;
    if (imageUrl) imageUrl = imageUrl.replace(/\([^)]*\)/g, '80').replace(/,+/g, ',');
    const availability = !pdp?.flags?.outOfStock;
    if (title && currentPrice > 0) {
      return { title, currentPrice, originalPrice: originalPrice > currentPrice ? originalPrice : null, currency: '₹', imageUrl, availability: availability ?? true, discountPercent: discount || (originalPrice > currentPrice ? Math.round((1 - currentPrice / originalPrice) * 100) : null) };
    }
  } catch {}
  return null;
}

async function scrapeMyntraViaFetch(url) {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  let cookieHeader = '';

  // First request to get cookies
  try {
    const cookieRes = await fetch('https://www.myntra.com/', {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8,hi;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    const setCookie = cookieRes.headers.get('set-cookie') || '';
    cookieHeader = setCookie.split(',').map(c => c.split(';')[0]).join('; ');
  } catch (e) {
    console.error('Myntra cookie fetch error:', e.message);
  }

  // Actual product page request
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8,hi;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.myntra.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(25000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 500 || html.includes('Site Maintenance') || html.includes('Access Denied')) {
      return null;
    }
    return extractMyxData(html);
  } catch (e) {
    console.error('Myntra fetch error:', e.message);
    return null;
  }
}

async function scrapeMyntraViaPuppeteer(url) {
  let page;
  try {
    const bi = await getBrowser();
    page = await bi.newPage();
    await setupPage(page);

    console.log(`Navigating to Myntra: ${url}`);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!resp) {
      console.error('No response from Myntra');
      return null;
    }

    if (resp.status() >= 400) {
      console.error(`Myntra returned status: ${resp.status()}`);
      return null;
    }

    // Wait for page to stabilize
    await new Promise(r => setTimeout(r, 3000));

    // Check current URL
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    // Wait for content to load
    try {
      await page.waitForSelector('script[type="application/ld+json"], [class*="pdp-price"], h1', { timeout: 10000 });
    } catch {
      console.log('Timeout waiting for Myntra content');
    }

    // Additional wait
    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();

    // Check for blocked/maintenance page
    if (html.length < 500 || html.includes('Site Maintenance') || html.includes('Access Denied')) {
      console.error('Myntra returned maintenance/blocked page');
      return null;
    }

    return extractMyxData(html);
  } catch (err) {
    console.error(`Myntra Puppeteer error:`, err.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function scrapeMyntra(url) {
  // Try API first (may bypass IP blocking)
  const apiResult = await scrapeMyntraViaApi(url);
  if (apiResult) return apiResult;

  // Try Puppeteer next
  const puppeteerResult = await scrapeMyntraViaPuppeteer(url);
  if (puppeteerResult) return puppeteerResult;

  // Fallback to fetch
  return scrapeMyntraViaFetch(url);
}

// ============================================
// FLIPKART
// ============================================

// Try Flipkart via direct fetch (may bypass some IP blocking)
async function scrapeFlipkartViaFetch(url) {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8,hi;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 1000) return null;

    // Try to extract ppd data from HTML
    const ppdMatch = html.match(/"ppd"\s*:\s*(\{)/);
    if (ppdMatch) {
      const start = ppdMatch.index + ppdMatch[0].length - 1;
      let depth = 1, i = start;
      while (i < html.length - 1 && depth > 0) {
        i++;
        if (html[i] === '{') depth++;
        if (html[i] === '}') depth--;
      }
      if (depth === 0) {
        try {
          const ppd = JSON.parse(html.substring(start, i + 1));
          const price = ppd?.finalPrice ?? ppd?.fsp ?? ppd?.fkfp ?? null;
          const mrp = ppd?.mrp ?? null;
          if (price && price > 0) {
            // Extract title from HTML
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            const title = (titleMatch?.[1] || '').split(' - ')[0]?.trim() || 'Product';
            return {
              title,
              currentPrice: price,
              originalPrice: mrp > price ? mrp : null,
              currency: '₹',
              imageUrl: null,
              availability: true,
              discountPercent: mrp > price ? Math.round((1 - price / mrp) * 100) : null,
            };
          }
        } catch {}
      }
    }

    // Fallback: regex price extraction
    const pm = html.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (pm) {
      const p = parseFloat(pm[1].replace(/,/g, ''));
      if (p > 10) {
        const tm = html.match(/<title>([^<]+)<\/title>/i);
        return {
          title: (tm?.[1] || '').split(' - ')[0]?.trim() || 'Product',
          currentPrice: p,
          originalPrice: null,
          currency: '₹',
          imageUrl: null,
          availability: true,
          discountPercent: null,
        };
      }
    }
  } catch (e) {
    console.error('Flipkart fetch error:', e.message);
  }
  return null;
}

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

    // Enable request interception for API calls
    const apis = [];
    await page.setRequestInterception(true);

    page.on('request', (request) => {
      // Allow all requests but modify headers for better stealth
      const headers = { ...request.headers() };
      request.continue({ headers });
    });

    page.on('response', async (response) => {
      const u = response.url();
      // Capture Flipkart API responses
      if (u.includes('api.flipkart.com') || u.includes('www.flipkart.com/api')) {
        const ct = response.headers()['content-type'] || '';
        if (ct.includes('json')) {
          try {
            const data = await response.json();
            if (data?.product || data?.data?.product || u.includes('price') || u.includes('offer')) {
              apis.push(data);
            }
          } catch {}
        }
      }
    });

    // Navigate with domcontentloaded first, then wait for network
    console.log(`Navigating to: ${url}`);

    // Try with shorter timeout first
    let resp;
    try {
      resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      console.log(`First navigation attempt failed: ${e.message}`);
      // Try with even shorter timeout and load event
      try {
        resp = await page.goto(url, { waitUntil: 'load', timeout: 15000 });
      } catch (e2) {
        console.error(`All navigation attempts failed: ${e2.message}`);
        return null;
      }
    }

    if (!resp) {
      console.error('No response from Flipkart');
      return null;
    }

    if (resp.status() >= 400) {
      console.error(`Flipkart returned status: ${resp.status()}`);
      return null;
    }

    // Wait for page to stabilize
    await new Promise(r => setTimeout(r, 3000));

    // Check if we got redirected to homepage
    const currentUrl = page.url();
    const pageTitle = await page.title();
    console.log(`Current URL: ${currentUrl}`);
    console.log(`Page title: ${pageTitle}`);

    // If redirected to homepage, try waiting for product content
    if (!currentUrl.includes('/p/') && !currentUrl.includes('itm')) {
      console.log('Redirected to non-product page, waiting for content...');
      await new Promise(r => setTimeout(r, 5000));
    }

    // Try to wait for product-specific elements
    try {
      await page.waitForSelector('h1 span, [class*="price"], [class*="Price"], [data-testid="product-title"]', { timeout: 8000 });
    } catch {
      console.log('Timeout waiting for product elements');
    }

    // Additional wait for API calls
    await new Promise(r => setTimeout(r, 2000));

    // Check intercepted APIs first
    for (const d of apis) {
      const e = tryExtractFlipkartApiData(d);
      if (e) {
        console.log('Extracted data from API response');
        return e;
      }
    }

    // Extract from page content
    const data = await page.evaluate(() => {
      const d = {};

      // Try JSON-LD first
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          if (j.offers) {
            for (const o of (Array.isArray(j.offers) ? j.offers : [j.offers])) {
              const p = parseFloat(o.price);
              if (p > 0) {
                d.currentPrice = p;
                d.title = d.title || j.name;
                d.originalPrice = d.originalPrice || parseFloat(o.highPrice) || null;
                break;
              }
            }
          }
          d.title = d.title || j.name;
        } catch {}
      }

      // Try various price selectors
      const priceSelectors = [
        '[class*="price"]', '[class*="Price"]', '[data-testid="price"]',
        '._30jeq3', '.Nx9bqj', '.CEmiEU', 'div[class*="price"]',
      ];
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const m = (el.textContent || '').match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
          if (m) {
            d.currentPrice = d.currentPrice || parseFloat(m[1].replace(/,/g, ''));
            break;
          }
        }
      }

      // Try MRP selectors
      const mrpSelectors = [
        '[class*="mrp"]', '[class*="original"]', '[class*="strike"]',
        '._3I9_wc', '.yF0R2_', 'del', 's',
      ];
      for (const sel of mrpSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const m = (el.textContent || '').match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
          if (m) {
            const p = parseFloat(m[1].replace(/,/g, ''));
            if (p > 0 && (!d.originalPrice || p > d.currentPrice)) {
              d.originalPrice = p;
            }
          }
        }
      }

      // Fallback: extract all prices from page
      if (!d.currentPrice) {
        const lines = (document.body?.innerText || '').split('\n').filter(l => l.includes('₹'));
        const prices = lines
          .map(l => {
            const m = l.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
            return m ? parseFloat(m[1].replace(/,/g, '')) : null;
          })
          .filter(p => p !== null && p > 20 && p < 10000000);
        if (prices.length > 0) {
          prices.sort((a, b) => a - b);
          d.currentPrice = prices[Math.floor(prices.length / 2)];
          const uniq = [...new Set(prices)].sort((a, b) => a - b);
          if (uniq.length > 1) d.originalPrice = uniq[uniq.length - 1];
        }
      }

      // Title extraction
      d.title = d.title ||
        document.querySelector('h1 span')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() ||
        document.title.split(' - ')[0]?.trim() ||
        document.title.split('|')[0]?.trim() ||
        '';

      // Image extraction
      const imgSelectors = [
        '[class*="image"] img', 'img[src*="flipkart"]', 'img[src*="rukmini"]',
        'img[loading="eager"]', '.CXW8mj img',
      ];
      for (const sel of imgSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          d.imageUrl = el.getAttribute('src') || el.getAttribute('data-src') || null;
          if (d.imageUrl) break;
        }
      }

      // Discount extraction
      const discEl = document.querySelector('[class*="discount"]');
      if (discEl) {
        const m = discEl.textContent.match(/(\d+)%/);
        if (m) d.discountPercent = parseInt(m[1]);
      }
      if (!d.discountPercent && d.originalPrice > d.currentPrice) {
        d.discountPercent = Math.round((1 - d.currentPrice / d.originalPrice) * 100);
      }

      return d;
    });

    if (data.currentPrice > 0) {
      console.log(`Extracted: ${data.title} - ₹${data.currentPrice}`);
      return {
        title: data.title || 'Product',
        currentPrice: data.currentPrice,
        originalPrice: data.originalPrice > data.currentPrice ? data.originalPrice : null,
        currency: '₹',
        imageUrl: data.imageUrl || null,
        availability: true,
        discountPercent: data.discountPercent || null,
      };
    }

    // Last resort: regex from HTML
    const html = await page.content();
    const pm = html.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (pm) {
      const p = parseFloat(pm[1].replace(/,/g, ''));
      if (p > 10) {
        const tm = html.match(/<title>([^<]+)<\/title>/i);
        return {
          title: (tm?.[1] || '').split(' - ')[0]?.trim() || 'Product',
          currentPrice: p,
          originalPrice: null,
          currency: '₹',
          imageUrl: null,
          availability: true,
          discountPercent: null,
        };
      }
    }

    console.error('Could not extract price from Flipkart page');
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
    let result;

    if (isMyntra) {
      result = await scrapeMyntra(url);
    } else {
      // Try fetch first for Flipkart (faster, may work)
      result = await scrapeFlipkartViaFetch(url);
      if (!result) {
        // Fallback to Puppeteer
        result = await scrapeFlipkartViaPuppeteer(url);
      }
    }

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
  let page;

  try {
    const bi = await getBrowser();
    page = await bi.newPage();
    await setupPage(page);

    const apis = [];
    await page.setRequestInterception(true);

    page.on('request', (request) => {
      request.continue();
    });

    page.on('response', async (response) => {
      const u = response.url();
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json')) {
        try {
          apis.push({ url: u.substring(0, 200), status: response.status() });
        } catch {}
      }
    });

    console.log(`Debug navigating to: ${url}`);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for content
    await new Promise(r => setTimeout(r, 5000));

    const currentUrl = page.url();
    const html = await page.content();

    const pd = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      const ps = [...t.matchAll(/₹\s*([\d,]+(?:\.\d{1,2})?)/g)];
      return {
        h1: document.querySelector('h1')?.textContent?.trim() || '',
        title: document.title,
        prices: ps.slice(0, 10).map(m => m[0]),
        url: window.location.href,
        bodyLength: document.body?.innerText?.length || 0,
      };
    });

    // For Myntra, check for window.__myx
    let myntraData = null;
    if (isMyntra) {
      const hasMyx = html.includes('window.__myx');
      const match = html.match(/window\.__myx\s*=\s*(\{.+?\})(?:\s*;)?\s*<\//s);
      try {
        myntraData = match ? { hasWindowMyx: true, pdpKeys: Object.keys(JSON.parse(match[1])?.pdpData || {}).slice(0, 15) } : { hasWindowMyx: false };
      } catch {
        myntraData = { hasWindowMyx: false };
      }
    }

    res.json({
      success: true,
      status: resp?.status(),
      finalUrl: currentUrl,
      htmlLen: html.length,
      pageData: pd,
      myntraData,
      apiCount: apis.length,
      apis: apis.slice(0, 10),
      snippet: html.substring(0, 2000),
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// Test endpoint to verify stealth configuration
app.get('/test-stealth', async (req, res) => {
  let page;
  try {
    const bi = await getBrowser();
    page = await bi.newPage();
    await setupPage(page);

    // Navigate to a detection test page
    await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const results = await page.evaluate(() => {
      return {
        webdriver: navigator.webdriver,
        languages: navigator.languages,
        plugins: navigator.plugins.length,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        chrome: !!window.chrome,
        title: document.title,
      };
    });

    res.json({ success: true, results });
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
