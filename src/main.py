import re
import json
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from curl_cffi import requests as cffi_requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8,hi;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]


def extract_flipkart_ppd(html: str) -> dict | None:
    match = re.search(r'"ppd"\s*:\s*(\{)', html)
    if not match:
        return None
    start = match.start() + match[0].length - 1 if hasattr(match[0], 'length') else match.start() + len(match[0]) - 1
    depth = 1
    i = start
    while i < len(html) - 1 and depth > 0:
        i += 1
        if html[i] == '{':
            depth += 1
        if html[i] == '}':
            depth -= 1
    if depth != 0:
        return None
    try:
        return json.loads(html[start:i + 1])
    except Exception:
        return None


def scrape_flipkart(url: str) -> dict | None:
    ua = USER_AGENTS[0]
    headers = {**HEADERS, "User-Agent": ua, "Referer": "https://www.flipkart.com/"}

    try:
        resp = cffi_requests.get(url, headers=headers, impersonate="chrome131", timeout=30)
        if resp.status_code != 200:
            logger.error(f"Flipkart HTTP {resp.status_code}")
            return None

        html = resp.text
        if len(html) < 1000:
            logger.error(f"Flipkart returned short response ({len(html)} bytes)")
            return None

        # Try ppd data
        ppd = extract_flipkart_ppd(html)
        if ppd:
            price = ppd.get("finalPrice") or ppd.get("fsp") or ppd.get("fkfp")
            mrp = ppd.get("mrp")
            if price and price > 0:
                title_match = re.search(r'<title>([^<]+)</title>', html, re.I)
                title = title_match.group(1).split(" - ")[0].strip() if title_match else "Product"
                # Extract image from ppd
                image_url = None
                image_data = ppd.get("imageData") or ppd.get("image") or {}
                if isinstance(image_data, dict):
                    image_url = image_data.get("url") or image_data.get("src")
                if not image_url:
                    image_url = ppd.get("thumbnailUrl") or ppd.get("imageUrl")
                return {
                    "title": title,
                    "currentPrice": price,
                    "originalPrice": mrp if mrp and mrp > price else None,
                    "currency": "₹",
                    "imageUrl": image_url,
                    "availability": True,
                    "discountPercent": round((1 - price / mrp) * 100) if mrp and mrp > price else None,
                }

        # Try JSON-LD
        soup = BeautifulSoup(html, "lxml")
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
                offers = data.get("offers")
                if offers:
                    if isinstance(offers, list):
                        offers = offers[0]
                    price = float(offers.get("price", 0))
                    if price > 0:
                        # Extract image from JSON-LD
                        image_url = data.get("image")
                        if isinstance(image_url, list):
                            image_url = image_url[0] if image_url else None
                        return {
                            "title": data.get("name", "Product"),
                            "currentPrice": price,
                            "originalPrice": float(offers.get("highPrice", 0)) if float(offers.get("highPrice", 0)) > price else None,
                            "currency": "₹",
                            "imageUrl": image_url,
                            "availability": True,
                            "discountPercent": None,
                        }
            except Exception:
                continue

        # Extract image from HTML meta tags or img elements
        image_url = None
        og_image = soup.find("meta", property="og:image")
        if og_image:
            image_url = og_image.get("content")
        if not image_url:
            img_tag = soup.find("img", {"src": re.compile(r'rukmini|flipkart')})
            if img_tag:
                image_url = img_tag.get("src")

        # Try regex fallback
        pm = re.search(r'(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)', html, re.I)
        if pm:
            p = float(pm.group(1).replace(",", ""))
            if p > 10:
                title_match = re.search(r'<title>([^<]+)</title>', html, re.I)
                title = title_match.group(1).split(" - ")[0].strip() if title_match else "Product"
                return {
                    "title": title,
                    "currentPrice": p,
                    "originalPrice": None,
                    "currency": "₹",
                    "imageUrl": image_url,
                    "availability": True,
                    "discountPercent": None,
                }

    except Exception as e:
        logger.error(f"Flipkart error: {e}")

    return None


def scrape_myntra(url: str) -> dict | None:
    ua = USER_AGENTS[0]

    # Get cookies first
    cookie_header = ""
    try:
        cookie_resp = cffi_requests.get(
            "https://www.myntra.com/",
            headers={**HEADERS, "User-Agent": ua},
            impersonate="chrome131",
            timeout=10,
        )
        cookies = cookie_resp.cookies
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())
    except Exception as e:
        logger.error(f"Myntra cookie error: {e}")

    headers = {
        **HEADERS,
        "User-Agent": ua,
        "Referer": "https://www.myntra.com/",
        "Sec-Fetch-Site": "same-origin",
    }
    if cookie_header:
        headers["Cookie"] = cookie_header

    try:
        resp = cffi_requests.get(url, headers=headers, impersonate="chrome131", timeout=30)
        if resp.status_code != 200:
            logger.error(f"Myntra HTTP {resp.status_code}")
            return None

        html = resp.text
        if len(html) < 500 or "Site Maintenance" in html or "Access Denied" in html:
            logger.error("Myntra returned blocked/maintenance page")
            return None

        # Try window.__myx
        match = re.search(r'window\.__myx\s*=\s*(\{.+?\})\s*;?\s*</', html, re.S)
        if match:
            try:
                data = json.loads(match.group(1))
                pdp = data.get("pdpData", {})
                price = pdp.get("price", {})
                brand = pdp.get("brand", {}).get("name", "")
                name = pdp.get("name", "")
                title = f"{brand} {name}".strip() if brand else name
                current_price = price.get("discounted") or price.get("sellingPrice") or price.get("amount")
                original_price = price.get("mrp") or price.get("originalPrice")
                discount = price.get("discountPercent")
                image_url = pdp.get("searchImage") or pdp.get("image")
                if image_url:
                    image_url = re.sub(r'\([^)]*\)', '80', image_url).replace(",,", ",")
                availability = not pdp.get("flags", {}).get("outOfStock", False)

                if title and current_price and current_price > 0:
                    return {
                        "title": title,
                        "currentPrice": current_price,
                        "originalPrice": original_price if original_price and original_price > current_price else None,
                        "currency": "₹",
                        "imageUrl": image_url,
                        "availability": availability if availability is not None else True,
                        "discountPercent": discount or (round((1 - current_price / original_price) * 100) if original_price and original_price > current_price else None),
                    }
            except Exception as e:
                logger.error(f"Myntra JSON parse error: {e}")

        # Try JSON-LD
        soup = BeautifulSoup(html, "lxml")
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
                offers = data.get("offers")
                if offers:
                    if isinstance(offers, list):
                        offers = offers[0]
                    price = float(offers.get("price", 0))
                    if price > 0:
                        return {
                            "title": data.get("name", "Product"),
                            "currentPrice": price,
                            "originalPrice": float(offers.get("highPrice", 0)) if float(offers.get("highPrice", 0)) > price else None,
                            "currency": "₹",
                            "imageUrl": None,
                            "availability": True,
                            "discountPercent": None,
                        }
            except Exception:
                continue

        # Regex fallback
        pm = re.search(r'(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)', html, re.I)
        if pm:
            p = float(pm.group(1).replace(",", ""))
            if p > 10:
                title_tag = soup.find("h1")
                title = title_tag.get_text(strip=True) if title_tag else "Product"
                return {
                    "title": title,
                    "currentPrice": p,
                    "originalPrice": None,
                    "currency": "₹",
                    "imageUrl": None,
                    "availability": True,
                    "discountPercent": None,
                }

    except Exception as e:
        logger.error(f"Myntra error: {e}")

    return None


@app.post("/scrape")
async def scrape(request: Request):
    body = await request.json()
    url = body.get("url")
    store = body.get("store", "")

    if not url:
        return JSONResponse({"success": False, "error": "url is required"}, status_code=400)

    logger.info(f"Scraping {store or 'unknown'}: {url}")

    is_myntra = store == "myntra" or "myntra.com" in url
    result = scrape_myntra(url) if is_myntra else scrape_flipkart(url)

    if result:
        return {"success": True, "data": result}
    return {"success": False, "error": "Could not extract product data"}


@app.get("/health")
async def health():
    return {"success": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
