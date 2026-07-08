from curl_cffi import requests as cffi_requests
import re

url = "https://www.flipkart.com/trend-printed-women-round-neck-black-t-shirt/p/itm3e32702745014?pid=TSHGVRKK2HTQVGBJ"
resp = cffi_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, impersonate="chrome131", timeout=30)
html = resp.text

# Method 1: Direct rukmini URL search
match = re.search(r'(https?://rukminim[12]\.flixcart\.com/image/\d+/\d+/[^"<>\s]+)', html)
if match:
    print("METHOD 1:", match.group(1))

# Method 2: In JSON with escaped slashes
match2 = re.search(r'rukminim[12]\\u002f\.flixcart\\.com\\u002fimage[^"<>\s]+', html)
if match2:
    print("METHOD 2:", match2.group(0).replace("\\u002f", "/"))

# Method 3: Any flixcart image URL
match3 = re.search(r'(https?://[^"<>\s]*flixcart\.com/image/[^"<>\s]+)', html)
if match3:
    print("METHOD 3:", match3.group(1))
