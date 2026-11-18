import os, re, sys

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex  # noqa: E402

CACHE = os.path.join(ROOT, "data", "doe", "cache")
shown = 0
for f in os.listdir(CACHE):
    if not f.endswith(".html"):
        continue
    txt = ex.strip_tags(open(os.path.join(CACHE, f), encoding="utf-8", errors="replace").read())
    for needle in ("PORTARIA PRPI Nº 1001", "PORTARIA PRPI Nº 994", "PORTARIA GR Nº 4215"):
        i = txt.find(needle)
        if i >= 0:
            print("=" * 90)
            print(f, "|", needle)
            print(txt[i:i + 1100])
            shown += 1
    if shown >= 3:
        break
