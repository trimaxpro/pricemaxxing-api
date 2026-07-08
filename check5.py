from curl_cffi import requests as cffi_requests
import re
import json

url = "https://www.flipkart.com/trend-printed-women-round-neck-black-t-shirt/p/itm3e32702745014?pid=TSHGVRKK2HTQVGBJ"
resp = cffi_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, impersonate="chrome131", timeout=30)
html = resp.text

# Extract ppd
match = re.search(r'"ppd"\s*:\s*(\{)', html)
if match:
    start = match.start() + len(match.group(0)) - 1
    depth = 1
    i = start
    while i < len(html) - 1 and depth > 0:
        i += 1
        if html[i] == '{': depth += 1
        if html[i] == '}': depth -= 1
    if depth == 0:
        ppd = json.loads(html[start:i+1])
        print("ppd keys:", list(ppd.keys()))
        # Look for image-related keys
        for k in ppd:
            if 'image' in k.lower() or 'img' in k.lower() or 'photo' in k.lower():
                print(f"  {k}: {str(ppd[k])[:150]}")

# Also check for imageId
matches = re.findall(r'"imageId"\s*:\s*"([^"]+)"', html)
print("imageId:", matches[:2] if matches else "Not found")

# Check for any rukmini URL
matches = re.findall(r'rukminim[12]\.flixcart\.com[^\s"<>]+', html)
print("rukmini URLs:", matches[:2] if matches else "Not found")
