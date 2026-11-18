import re, json, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

url = "https://doe.sp.gov.br/executivo/universidade-de-sao-paulo/portaria-gr-n-8448-de-4-de-junho-de-2024-20240604114211214357603"
h = ex.get(url).decode("utf-8", "replace")
m = re.search(r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>', h)
if m:
    d = json.loads(m.group(1))
    print(json.dumps(d, ensure_ascii=False)[:2000])
print("\n--- scripts ---")
for s in re.findall(r'src="(/_next/static/[^"]+)"', h)[:10]:
    print(s)
print("\n--- links ---")
for s in re.findall(r'href="(/_next/static/[^"]+)"', h)[:10]:
    print(s)
