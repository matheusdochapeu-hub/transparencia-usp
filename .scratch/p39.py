import json, os, re
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"

h = open(os.path.join(ROOT, ".scratch", "portal.html"), encoding="latin-1").read()
print("selects/options:")
for m in re.finditer(r"<select[^>]*name=\"([^\"]+)\"[^>]*>([\s\S]*?)</select>", h, re.I):
    opts = re.findall(r"<option[^>]*value=\"([^\"]*)\"[^>]*>([^<]*)</option>", m.group(2))
    print(" ", m.group(1), "->", opts[:8], "..." if len(opts) > 8 else "")
print("\nlinks:", sorted(set(re.findall(r'href="([^"]+)"', h)))[:15])

d = json.load(open(os.path.join(ROOT, "docs", "data", "categoria.json"), encoding="utf-8"))
print("\ncategoria keys:", list(d)[:10])
print(json.dumps(d, ensure_ascii=False)[:600])
