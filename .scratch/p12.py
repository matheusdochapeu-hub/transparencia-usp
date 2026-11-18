import json, os

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
d = json.load(open(os.path.join(ROOT, "docs", "data", "tecnicos.json"), encoding="utf-8"))
for i, u in enumerate(d["units"]):
    print(f'{i:2d} {u["sigla"]:<8} {u["campus"]:<24} {u["name"]}')
