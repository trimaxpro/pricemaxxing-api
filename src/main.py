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


def extract_flipkart_image(html: str) -> str | None:
    # Try imageURL from script data (unicode escaped with \u002f)
    match = re.search(r'"imageURL"\s*:\s*"((?:[^"\\]|\\.)*)"', html)
    if match:
        url = match.group(1).replace("\\u002f", "/")
        # Replace placeholders with actual values
        url = url.replace("{@width}", "312").replace("{@height}", "416").replace("{@quality}", "80")
        if "rukmini" in url or "flixcart" in url:
            return url

    # Try og:image meta tag
    match = re.search(r'property="og:image"\s+content="([^"]+)"', html, re.I)
    if match:
        return match.group(1)

    # Try any rukmini URL
    match = re.search(r'(https?:\\u002f\\u002frukmini[^\s"<>]+)', html)
    if match:
        url = match.group(1).replace("\\u002f", "/")
        url = url.replace("{@width}", "312").replace("{@height}", "416").replace("{@quality}", "80")
        return url

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
        image_url = extract_flipkart_image(html)
        if ppd:
            price = ppd.get("finalPrice") or ppd.get("fsp") or ppd.get("fkfp")
            mrp = ppd.get("mrp")
            if price and price > 0:
                title_match = re.search(r'<title>([^<]+)</title>', html, re.I)
                title = title_match.group(1).split(" - ")[0].strip() if title_match else "Product"
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
                        # Use image from earlier extraction
                        ld_image = data.get("image")
                        if isinstance(ld_image, list):
                            ld_image = ld_image[0] if ld_image else None
                        return {
                            "title": data.get("name", "Product"),
                            "currentPrice": price,
                            "originalPrice": float(offers.get("highPrice", 0)) if float(offers.get("highPrice", 0)) > price else None,
                            "currency": "₹",
                            "imageUrl": image_url or ld_image,
                            "availability": True,
                            "discountPercent": None,
                        }
            except Exception:
                continue

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

                # Extract image URL
                image_url = pdp.get("searchImage") or pdp.get("image")
                if not image_url:
                    media = pdp.get("media", {})
                    albums = media.get("albums", [])
                    if albums:
                        images = albums[0].get("images", [])
                        if images:
                            image_url = images[0].get("secureSrc") or images[0].get("src")

                # Fix image URL placeholders
                if image_url:
                    image_url = re.sub(r'\(\$height\)', '480', image_url)
                    image_url = re.sub(r'\(\$width\)', '360', image_url)
                    image_url = re.sub(r'\(\$qualityPercentage\)', '80', image_url)
                    image_url = re.sub(r'\([^)]*\)', '80', image_url)
                    image_url = image_url.replace(",,", ",")

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


@app.post("/debug")
async def debug(request: Request):
    body = await request.json()
    url = body.get("url")
    if not url:
        return JSONResponse({"success": False, "error": "url is required"}, status_code=400)

    ua = USER_AGENTS[0]
    headers = {**HEADERS, "User-Agent": ua, "Referer": "https://www.flipkart.com/"}

    try:
        resp = cffi_requests.get(url, headers=headers, impersonate="chrome131", timeout=30)
        html = resp.text
        soup = BeautifulSoup(html, "lxml")

        # Find all img tags
        imgs = []
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or ""
            if "rukmini" in src or "flipkart" in src or "image" in src.lower():
                imgs.append(src[:200])

        # Find og:image
        og = soup.find("meta", property="og:image")
        og_url = og.get("content") if og else None

        # Find any script with image data
        image_scripts = []
        for script in soup.find_all("script"):
            text = script.string or ""
            if "imageData" in text or "imageUrl" in text or "searchImage" in text:
                # Extract a snippet around the image reference
                idx = text.find("imageData") or text.find("imageUrl") or text.find("searchImage")
                if idx >= 0:
                    image_scripts.append(text[max(0, idx-50):idx+200])

        return {
            "success": True,
            "htmlLen": len(html),
            "ogImage": og_url,
            "imgTags": imgs[:5],
            "imageSnippets": image_scripts[:3],
            "title": soup.title.string if soup.title else None,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
