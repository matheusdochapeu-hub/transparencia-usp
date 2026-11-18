import os, sys, re, glob
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

# 1) SPA 2026 cached
entries = ex.collect(2026)
g = next(g for g in ex.group_pages(entries).values() if "1128" in g["urls"][0])
t = ex.strip_tags(open(ex.legacy_spa_path(ex.sha(g["urls"][0])), encoding="utf-8").read())
print("SPA 1708:", t[:900])
print()

# 2) PDF
txt = sorted(glob.glob(os.path.join(ROOT, "data", "doe", "cache", "txt", "*.txt")), key=os.path.getmtime)[-1]
t2 = re.sub(r"\s+", " ", open(txt, encoding="utf-8").read())
ms = list(ex.PORT_HEADER.finditer(t2))
print("PDF headers:", len(ms))
for m in ms[:6]:
    print("  ", repr(m.group(0)), "| ref:", ex.is_reference(t2, m.start()))
i = t2.find("PORTARIA PRPI Nº 955")
print("\ntrecho:", t2[i:i + 500])
