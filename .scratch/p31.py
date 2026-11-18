import re, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

js = ex.get("https://doe.sp.gov.br/_next/static/chunks/pages/_app-d4e53c0360a5052e.js").decode("utf-8", "replace")
eps = sorted(set(re.findall(r'"/v1/[A-Za-z0-9_/\-${}.+]{2,90}"', js)))
print(len(eps))
for e in eps:
    print(e)
