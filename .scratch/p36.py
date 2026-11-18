import os, sys, re, glob, json
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

# 2011: portarias 5434/5435 sem padrão
for f in glob.glob(os.path.join(ROOT, "data", "doe", "cache", "txt", "*.txt")):
    t = re.sub(r"\s+", " ", open(f, encoding="utf-8").read())
    if "5.434" in t or "5434" in t:
        for alvo in ("5.434", "5.435"):
            i = t.find(alvo)
            if i > 0:
                print("=" * 90)
                print(f, alvo)
                print(t[max(0, i - 300):i + 1200])
        break

# 2015: página que deu 404
entries = ex.collect(2015)
groups = list(ex.group_pages(entries).values())
print("\n2015 grupos:", len(groups))
for g in groups[:4]:
    print(" ", g["kind"], "urls:", [u[:120] for u in g["urls"]])
    print("     titulos:", g["titles"][:2])
