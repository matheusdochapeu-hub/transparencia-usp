import re, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

bm = ex.get("https://doe.sp.gov.br/_next/static/zaCymMlg7J-hypjSAmUg-/_buildManifest.js").decode("utf-8", "replace")
i = bm.find("titleId")
print(bm[max(0, i - 200):i + 600])
