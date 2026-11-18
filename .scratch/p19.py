import os, sys, json, time
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

# 1) SPA novo (2026, primeira página sem cache)
entries = ex.collect(2026)
groups = list(ex.group_pages(entries).values())
spa = next(g for g in groups if g["kind"] == "spa")
t0 = time.time()
text, err = ex.load_page(spa, refresh=False)
print("SPA:", spa["urls"][0][:90], "| err:", err, "| chars:", len(text), "| s:", round(time.time() - t0, 1))
if text:
    ports, notes = ex.parse_page(text, {"year": 2026, "url": spa["urls"][0], "kind": "spa", "date": ""})
    print("  portarias:", len(ports), "linhas:", sum(len(p["rows"]) for p in ports), "notas:", notes[:3])

# 2) PDF legado (2024 tem algumas páginas em PDF)
entries = ex.collect(2024)
groups = list(ex.group_pages(entries).values())
pdf = next((g for g in groups if g["kind"] == "pdf"), None)
if pdf:
    t0 = time.time()
    text, err = ex.load_page(pdf, refresh=False)
    print("PDF:", pdf["urls"][0][:90], "| err:", err, "| chars:", len(text), "| s:", round(time.time() - t0, 1))
    if text:
        ports, notes = ex.parse_page(text, {"year": 2024, "url": pdf["urls"][0], "kind": "pdf", "date": ""})
        print("  portarias:", len(ports), "linhas:", sum(len(p["rows"]) for p in ports), "notas:", notes[:3])
