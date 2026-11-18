import json, os, re, sys
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

r = json.load(open(os.path.join(ROOT, "data", "doe", "rows.json"), encoding="utf-8"))
notes = [n for n in r["diagnostico"] if "cache" not in n and "sem cabeçalho" not in n]
CACHE = os.path.join(ROOT, "data", "doe", "cache")
texts = [ex.strip_tags(open(os.path.join(CACHE, f), encoding="utf-8", errors="replace").read())
         for f in os.listdir(CACHE) if f.endswith(".html")]

for n in notes:
    num = re.search(r"(\d{3,5})", n)
    if not num:
        continue
    num = num.group(1)
    for t in texts:
        for m in re.finditer(r"PORTARIA\s+GR\s+N[º°]\s*" + num + r"\s*,", t):
            i = m.start()
            print("=" * 100)
            print(n)
            print(t[i:i + 800])
            break
        else:
            continue
        break
