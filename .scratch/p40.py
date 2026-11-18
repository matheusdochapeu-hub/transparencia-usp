import glob, json, os
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
files = sorted(glob.glob(os.path.join(ROOT, "data", "scope", "unit-*.json")))
print("unit scopes:", len(files))
scopes = json.load(open(os.path.join(ROOT, "docs", "data", "scopes.json"), encoding="utf-8"))["scopes"]
units = [s for s in scopes if s["type"] == "unit"]
print("units no indice:", len(units), "| siglas:", [u["unidade"] for u in units][:8])
have = {os.path.basename(f)[5:-5] for f in files}
falta = [u["unidade"] for u in units if u["unidade"] not in have]
print("sem arquivo de recorte:", falta)

d = json.load(open(os.path.join(ROOT, "data", "scope", "unit-EACH.json"), encoding="utf-8"))
refs = sorted(d["refs"])
print("refs:", refs[:2], "...", refs[-3:], "total", len(refs))
for r in refs[-3:]:
    print(r, d["refs"][r]["categoria"][:2])
d2 = json.load(open(os.path.join(ROOT, "data", "scope", "unit-ABCD.json"), encoding="utf-8"))
for r in sorted(d2["refs"])[-3:]:
    print("ABCD", r, d2["refs"][r]["categoria"][:2])
