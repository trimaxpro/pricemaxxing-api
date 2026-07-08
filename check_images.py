from curl_cffi import requests as cffi_requests
import re

url = "https://www.flipkart.com/trend-printed-women-round-neck-black-t-shirt/p/itm3e32702745014?pid=TSHGVRKK2HTQVGBJ"
resp = cffi_requests.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}, impersonate="chrome131", timeout=30)
html = resp.text

# Find image patterns
for pattern in ["rukmini", "imageId", "imageUrl", "og:image", "data-imgurl", "searchImage"]:
    matches = re.findall(rf'{pattern}["\s:]+([^\s"<>]+)', html[:100000])
    if matches:
        print(f"{pattern}: {matches[:3]}")

# Find all img tags with src
from bs4 import BeautifulSoup
soup = BeautifulSoup(html, "lxml")
imgs = soup.find_all("img", src=True)
for img in imgs[:10]:
    src = img["src"]
    if "rukmini" in src or "image" in src.lower():
        print(f"IMG: {src[:200]}")
