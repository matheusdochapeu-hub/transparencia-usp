import json, os, re, sys, collections

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"

# 1) libs disponiveis
for mod in ("pypdf", "PyPDF2", "pdfminer", "fitz", "bs4", "lxml"):
    try:
        __import__(mod)
        print("lib ok:", mod)
    except Exception as e:
        print("lib NAO:", mod, type(e).__name__)

# 2) scopes/unidades
p = os.path.join(ROOT, "docs", "data", "scopes.json")
d = json.load(open(p, encoding="utf-8"))
print("\nscopes keys:", list(d)[:5])
scopes = d["scopes"] if isinstance(d, dict) else d
units = [s for s in scopes if s.get("type") == "unit"]
print("units:", len(units))
print("exemplo:", json.dumps(units[0], ensure_ascii=False))
names = [u["name"] for u in units]
print("primeiras:", names[:8])
print("campuses:", collections.Counter(u.get("campus") for u in units))
