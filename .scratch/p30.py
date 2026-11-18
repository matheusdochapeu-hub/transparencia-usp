import re, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

for u in ("/_next/static/chunks/28-e60db289665d6029.js", "/_next/static/chunks/pages/_app-d4e53c0360a5052e.js"):
    js = ex.get("https://doe.sp.gov.br" + u).decode("utf-8", "replace")
    print("=" * 100)
    print(u, len(js))
    for key in ("do-api-publication-workflow", "publication-document", "hub/"):
        for m in re.finditer(re.escape(key), js):
            print(f"--[{key}]--")
            print(repr(js[max(0, m.start() - 500):m.start() + 500]))
            break
