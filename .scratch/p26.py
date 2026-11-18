import re, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

base = "https://doe.sp.gov.br"
chunk = "/_next/static/chunks/pages/%5Bjournal%5D/%5Bsection%5D/%5BtitleId%5D-d2c49aed801eaebb.js"
js = ex.get(base + chunk).decode("utf-8", "replace")
print("len", len(js))
for pat in (r"https?://[^\"'\s]{8,120}", r"/api/[A-Za-z0-9_\-/]{2,80}", r"graphql", r"supabase", r"firebase", r"aws", r"s3\."):
    hits = re.findall(pat, js, re.I)
    if hits:
        print(pat, "->", list(dict.fromkeys(hits))[:12])
print("\n--- trechos com fetch/axios ---")
for m in re.finditer(r".{140}(?:fetch\(|axios|api).{220}", js):
    print(repr(m.group(0))[:400])
    print("-")
