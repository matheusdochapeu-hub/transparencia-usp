import os, re, sys

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from extract_doe import strip_tags  # noqa: E402

p = os.path.join(ROOT, "data", "doe", "cache")
files = sorted(os.listdir(p))
texts = {}
for f in files:
    h = open(os.path.join(p, f), encoding="utf-8", errors="replace").read()
    texts[f] = strip_tags(h)

def clean(t):
    return re.sub(r"\s+", " ", t)

# 1) pagina com redistribuicao
for f, t in texts.items():
    c = clean(t)
    if re.search(r"redistribu", c, re.I):
        print("=== REDIST", f, "len", len(c))
        i = re.search(r"redistribu", c, re.I).start()
        print(c[max(0, i - 1200): i + 1200])
        print()
        break

# 2) pagina com varias portarias
for f, t in texts.items():
    c = clean(t)
    n = len(re.findall(r"PORTARIA\s+GR\s+N", c))
    if n >= 3:
        print("=== LOTE", f, "portarias:", n, "len", len(c))
        print(c[:3000])
        print()
        break
