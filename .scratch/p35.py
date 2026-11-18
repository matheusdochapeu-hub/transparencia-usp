import re, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

bm = ex.get("https://doe.sp.gov.br/_next/static/zaCymMlg7J-hypjSAmUg-/_buildManifest.js").decode("utf-8", "replace")
names = sorted(set(re.findall(r"static/chunks/(?:774|888|179)-[a-z0-9]+\.js", bm)))
print(names)
for name in names:
    js = ex.get("https://doe.sp.gov.br/_next/" + name).decode("utf-8", "replace")
    eps = sorted(set(re.findall(r'"/v1/[A-Za-z0-9_/\-${}.+]{2,90}"', js)))
    print("\n==", name, len(js), "endpoints:", eps)
    for key in ("publication-get", "/publication/", "publication/"):
        for mm in re.finditer(re.escape(key), js):
            print("   ctx:", repr(js[max(0, mm.start() - 250):mm.start() + 350])[:560])
            break
