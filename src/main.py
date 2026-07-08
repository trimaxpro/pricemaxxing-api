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

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8,hi;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
}


def fetch_html(url: str, extra_headers: dict = None) -> str | None:
    headers = {**HEADERS, **(extra_headers or {})}
    try:
        resp = cffi_requests.get(url, headers=headers, impersonate="chrome131", timeout=30)
        if resp.status_code == 200 and len(resp.text) > 500:
            return resp.text
    except Exception as e:
        logger.error(f"Fetch error for {url}: {e}")
    return None


def extract_flipkart(html: str) -> dict | None:
    # Extract ppd data for price
    ppd = None
    match = re.search(r'"ppd"\s*:\s*\{', html)
    if match:
        start = match.start() + match[0].__len__() - 1
        depth, i = 1, start
        while i < len(html) - 1 and depth > 0:
            i += 1
            if html[i] == '{': depth += 1
            if html[i] == '}': depth -= 1
        if depth == 0:
            try:
                ppd = json.loads(html[start:i + 1])
            except Exception:
                pass

    price = ppd.get("finalPrice") or ppd.get("fsp") if ppd else None
    mrp = ppd.get("mrp") if ppd else None

    if not price:
        pm = re.search(r'"finalPrice"\s*:\s*(\d+)', html)
        if pm: price = int(pm.group(1))
    if not mrp:
        pm = re.search(r'"mrp"\s*:\s*(\d+)', html)
        if pm: mrp = int(pm.group(1))

    if not price or price <= 0:
        return None

    # Extract title
    tm = re.search(r'<title>([^<]+)</title>', html, re.I)
    title = tm.group(1).split(" - ")[0].strip() if tm else "Product"

    # Extract image - search for rukminim2 flixcart URL
    image_url = None
    img_match = re.search(r'(https?://rukminim[12]\.flixcart\.com/image/\d+/\d+/[^"<>\s]+)', html)
    if img_match:
        image_url = img_match.group(1)
        if "?" not in image_url:
            image_url += "?q=90"

    return {
        "title": title,
        "currentPrice": price,
        "originalPrice": mrp if mrp and mrp > price else None,
        "currency": "₹",
        "imageUrl": image_url,
        "availability": True,
        "discountPercent": round((1 - price / mrp) * 100) if mrp and mrp > price else None,
    }


def extract_myntra(html: str) -> dict | None:
    match = re.search(r'window\.__myx\s*=\s*(\{.+?\})\s*;?\s*</', html, re.S)
    if not match:
        return None

    try:
        data = json.loads(match.group(1))
        pdp = data.get("pdpData", {})
        price_data = pdp.get("price", {})
        brand = pdp.get("brand", {}).get("name", "")
        name = pdp.get("name", "")
        title = f"{brand} {name}".strip() if brand else name
        current_price = price_data.get("discounted") or price_data.get("sellingPrice") or price_data.get("amount")
        original_price = price_data.get("mrp") or price_data.get("originalPrice")
        discount = price_data.get("discountPercent")

        # Extract image
        image_url = pdp.get("searchImage") or pdp.get("image")
        if not image_url:
            media = pdp.get("media", {})
            albums = media.get("albums", [])
            if albums and albums[0].get("images"):
                image_url = albums[0]["images"][0].get("secureSrc") or albums[0]["images"][0].get("src")

        if image_url:
            image_url = image_url.replace("($height)", "720").replace("($width)", "540")
            image_url = image_url.replace("($qualityPercentage)", "90").replace("($quality)", "90")

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
        logger.error(f"Myntra parse error: {e}")

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

    if is_myntra:
        # Get cookies first
        cookie_header = ""
        try:
            cookie_resp = cffi_requests.get("https://www.myntra.com/", headers=HEADERS, impersonate="chrome131", timeout=10)
            cookie_header = "; ".join(f"{k}={v}" for k, v in cookie_resp.cookies.items())
        except Exception:
            pass

        extra = {"Referer": "https://www.myntra.com/", "Sec-Fetch-Site": "same-origin"}
        if cookie_header:
            extra["Cookie"] = cookie_header
        html = fetch_html(url, extra)
        result = extract_myntra(html) if html else None
    else:
        html = fetch_html(url, {"Referer": "https://www.flipkart.com/"})
        result = extract_flipkart(html) if html else None

    if result:
        return {"success": True, "data": result}
    return {"success": False, "error": "Could not extract product data"}


@app.get("/health")
async def health():
    return {"success": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
