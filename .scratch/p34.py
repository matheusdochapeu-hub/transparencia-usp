import re, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

bm = ex.get("https://doe.sp.gov.br/_next/static/zaCymMlg7J-hypjSAmUg-/_buildManifest.js").decode("utf-8", "replace")
names = sorted(set(re.findall(r"static/chunks/pages/publicacao/\[id\][^\"']*\.js", bm)))
print(names)
for name in names:
    js = ex.get("https://doe.sp.gov.br/_next/" + name).decode("utf-8", "replace")
    print("\n==", name, len(js))
    for e in sorted(set(re.findall(r'"/v1/[A-Za-z0-9_/\-${}.+]{2,90}"', js))):
        print("   ", e)
    for key in ("publication", "get-publication", "/publicacao"):
        for mm in re.finditer(re.escape(key), js):
            print("   ctx:", repr(js[max(0, mm.start() - 200):mm.start() + 260])[:460])
            break
