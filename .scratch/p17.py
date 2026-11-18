import json, os, re, sys
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

r = json.load(open(os.path.join(ROOT, "data", "doe", "rows.json"), encoding="utf-8"))
notes = [n for n in r["diagnostico"] if "cache" not in n]
print("notas relevantes:", len(notes))
for n in notes:
    print("  -", n)

# localizar no cache os trechos das portarias problemáticas
CACHE = os.path.join(ROOT, "data", "doe", "cache")
texts = []
for f in os.listdir(CACHE):
    if f.endswith(".html"):
        t = ex.strip_tags(open(os.path.join(CACHE, f), encoding="utf-8", errors="replace").read())
        texts.append(t)

alvos = [re.match(r"(\S+ \S+)", n).group(1) for n in notes if re.match(r"\S+ \S+", n)]
for alvo in dict.fromkeys(alvos):
    for t in texts:
        m = re.search(re.escape(alvo.replace(" ", " ")), t)
        if m:
            i = t.find(alvo)
            print("\n>>>", alvo)
            print(t[max(0, i - 200):i + 900])
            break
