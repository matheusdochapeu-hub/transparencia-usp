import glob, os, sys, random
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

files = sorted(glob.glob(os.path.join(ROOT, "data", "doe", "cache", "spa", "*.html")))
print("arquivos spa:", len(files))
random.seed(1)
amostra = random.sample(files, min(6, len(files)))
for f in amostra:
    t = ex.strip_tags(open(f, encoding="utf-8", errors="replace").read())
    ports, notes = ex.parse_page(t, {"year": 2024, "url": f, "kind": "spa", "date": ""})
    print(f"  {os.path.basename(f)} chars={len(t):>6} portarias={len(ports)} "
          f"linhas={sum(len(p['rows']) for p in ports)} notas={len(notes)}")
