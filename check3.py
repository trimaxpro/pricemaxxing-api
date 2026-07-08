from curl_cffi import requests as cffi_requests
import re

url = "https://www.myntra.com/perfume/fraganote/fraganote-drunken-cake-long-lasting-eau-de-parfum---50-ml/35151846/buy"
resp = cffi_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, impersonate="chrome131", timeout=30)
html = resp.text

# Search for images.myntra.com
matches = re.findall(r'images\.myntra\.com[^\s"<>]+', html)
print("myntra images:", matches[:3] if matches else "Not found")

# Search for searchImage in JSON
matches2 = re.findall(r'"searchImage"\s*:\s*"([^"]+)"', html)
print("searchImage:", matches2[:3] if matches2 else "Not found")

# Search for any image URL
matches3 = re.findall(r'https?://images\.myntra\.com[^\s"<>]+', html)
print("full URLs:", matches3[:3] if matches3 else "Not found")
