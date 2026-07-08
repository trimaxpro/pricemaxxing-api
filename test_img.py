from curl_cffi import requests as cffi_requests
import re

url = "https://www.flipkart.com/trend-printed-women-round-neck-black-t-shirt/p/itm3e32702745014?pid=TSHGVRKK2HTQVGBJ"
resp = cffi_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, impersonate="chrome131", timeout=30)
html = resp.text

# Test the regex pattern
match = re.search(r'"imageURL"\s*:\s*"([^"]+)"', html)
if match:
    url = match.group(1).replace("\\u002f", "/")
    print("Found imageURL:", url[:150])
else:
    print("No imageURL found")

# Check if the pattern exists at all
idx = html.find("imageURL")
if idx >= 0:
    print("imageURL at index:", idx)
    print("Context:", html[idx:idx+100])
else:
    print("imageURL not in HTML at all")
