import re, sys
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

idx = ex.get("https://drh.usp.br/biblioteca-drh/legislacao/diario-oficial-do-estado/").decode("utf-8", "replace")
links = sorted(set(re.findall(r'href="(https://drh\.usp\.br/biblioteca-drh/legislacao/diario-oficial-do-estado/[^"#?]*)"', idx)))
print("links:", len(links))
for u in links:
    print(" ", u)
for cand in ("d-o-e-2013", "d-o-e-2013-2", "d-o-e-13"):
    try:
        h = ex.get("https://drh.usp.br/biblioteca-drh/legislacao/diario-oficial-do-estado/%s/" % cand)
        print(cand, "OK", len(h))
    except Exception as e:
        print(cand, "ERR", str(e)[:60])
