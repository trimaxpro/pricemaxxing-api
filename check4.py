from curl_cffi import requests as cffi_requests
import re
import json

url = "https://www.myntra.com/perfume/fraganote/fraganote-drunken-cake-long-lasting-eau-de-parfum---50-ml/35151846/buy"
resp = cffi_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, impersonate="chrome131", timeout=30)
html = resp.text

# Find window.__myx
match = re.search(r'window\.__myx\s*=\s*(\{.+?\})\s*;?\s*</', html, re.S)
if match:
    try:
        data = json.loads(match.group(1))
        pdp = data.get("pdpData", {})
        print("searchImage:", pdp.get("searchImage"))
        print("image:", pdp.get("image"))
        media = pdp.get("media", {})
        albums = media.get("albums", [])
        if albums:
            images = albums[0].get("images", [])
            if images:
                print("album image:", images[0].get("secureSrc") or images[0].get("src"))
    except Exception as e:
        print("Parse error:", e)
else:
    print("No window.__myx found")
    # Check HTML length
    print("HTML length:", len(html))
