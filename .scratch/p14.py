import json, os
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
p = json.load(open(os.path.join(ROOT, "data", "doe", "pages.json"), encoding="utf-8"))["pages"]
print("paginas:", len(p), "ok:", sum(1 for x in p if x["ok"]))
for x in sorted(p, key=lambda x: -x["portarias"])[:8]:
    print(x["portarias"], x["linhas"], x["kind"], x["url"][:110])
print()
r = json.load(open(os.path.join(ROOT, "data", "doe", "rows.json"), encoding="utf-8"))
print("portarias:", r["portarias"], "linhas:", r["rows"])
print("diagnostico:", len(r["diagnostico"]))
for d in r["diagnostico"][:12]:
    print("  ", d[:160])
urls = {x["url"] for x in p if not x["ok"]}
print("\npaginas com erro:", len(urls))
for u in list(urls)[:5]:
    print("  ", u[:140])
