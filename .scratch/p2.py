import os, re, json, sys

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from extract_doe import strip_tags  # noqa: E402

p = os.path.join(ROOT, "data", "doe", "cache")
hits = []
for f in sorted(os.listdir(p)):
    h = open(os.path.join(p, f), encoding="utf-8", errors="replace").read()
    t = strip_tags(h)
    if re.search(r"emprego\s+p[úu]blico", t, re.I):
        hits.append((f, h, t))
print("paginas com 'emprego publico':", len(hits), "de", len(os.listdir(p)))

f, h, t = hits[0]
print("\n=== arquivo", f, "html", len(h), "texto", len(t), "===")
i = re.search(r"emprego\s+p[úu]blico", t, re.I).start()
print(t[max(0, i - 800): i + 2000])
print("\n\n=== tags no HTML (amostra) ===")
for m in re.finditer(r"<(p|div|article|section|h\d)[^>]*>", h):
    pass
print(h[:600].replace("\n", " ")[:600])
