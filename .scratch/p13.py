import os, re, sys, json

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex  # noqa: E402

CACHE = os.path.join(ROOT, "data", "doe", "cache")
target = None
for f in os.listdir(CACHE):
    if not f.endswith(".html"):
        continue
    raw = open(os.path.join(CACHE, f), encoding="utf-8", errors="replace").read()
    txt = ex.strip_tags(raw)
    if "8463" in txt and "8464" in txt:
        target = (f, txt)
        break
print("arquivo:", target[0] if target else None)
txt = target[1]
print("len texto:", len(txt))
print("headers encontrados:", len(ex.PORT_HEADER.findall(txt)))
for m in list(ex.PORT_HEADER.finditer(txt))[:5]:
    print("  header:", repr(txt[m.start():m.end()]))
ports, notes = ex.parse_page(txt, {"year": 2024, "url": "x", "kind": "spa"})
print("portarias:", len(ports), "linhas:", sum(len(p['rows']) for p in ports))
for p in ports[:6]:
    print(" ", p["sigla"], p["numero"], p["data"], p["tipo"], "|", p["ementa"][:60], "| rows:", len(p["rows"]))
print("notas:", notes[:10])
i = txt.find("PORTARIA GR Nº 8463")
print("\nTRECHO:", txt[i:i+1200])
