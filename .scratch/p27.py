import re, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

urls = [
    "/_next/static/chunks/389-52f3810177833e90.js",
    "/_next/static/chunks/274-c44ad3519a441e9b.js",
    "/_next/static/chunks/28-e60db289665d6029.js",
    "/_next/static/chunks/pages/_app-d4e53c0360a5052e.js",
]
for u in urls:
    js = ex.get("https://doe.sp.gov.br" + u).decode("utf-8", "replace")
    print("=" * 90)
    print(u, "len", len(js))
    for pat in (r"https?://[^\"'\s]{8,120}", r"\"/api/[^\"']{2,80}\"", r"process\.env\.[A-Z_]+"):
        hits = re.findall(pat, js)
        if hits:
            print(" ", pat, "->", list(dict.fromkeys(hits))[:15])
    m = re.search(r".{100}(?:axios\.create|baseURL|fetch\().{200}", js)
    if m:
        print("  trecho:", repr(m.group(0))[:400])
