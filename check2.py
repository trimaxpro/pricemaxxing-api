from curl_cffi import requests as cffi_requests
import re

url = "https://www.flipkart.com/trend-printed-women-round-neck-black-t-shirt/p/itm3e32702745014?pid=TSHGVRKK2HTQVGBJ"
resp = cffi_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, impersonate="chrome131", timeout=30)
html = resp.text

# Search for rukmini CDN images
matches = re.findall(r'rukmini\.flipkartcdn\.com[^\s"<>]+', html)
print("rukmini:", matches[:3] if matches else "Not found")

# Search for image URLs in scripts
matches2 = re.findall(r'"imageURL"\s*:\s*"([^"]+)"', html)
print("imageURL:", matches2[:3] if matches2 else "Not found")

# Search for imageId
matches3 = re.findall(r'"imageId"\s*:\s*"([^"]+)"', html)
print("imageId:", matches3[:3] if matches3 else "Not found")

# Search for any URL with .jpg or .png
matches4 = re.findall(r'https?://[^\s"<>]+\.(?:jpg|jpeg|png|webp)', html)
print("jpg/png:", matches4[:5] if matches4 else "Not found")
