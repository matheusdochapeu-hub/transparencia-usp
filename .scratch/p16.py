import json, os, collections
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
r = json.load(open(os.path.join(ROOT, "data", "doe", "rows.json"), encoding="utf-8"))
print("notas:", len(r["diagnostico"]))
c = collections.Counter(n.split(":")[-1].strip() for n in r["diagnostico"])
for k, v in c.most_common(12):
    print(f"  {v:3d}  {k[:110]}")
print("\nlinhas de exemplo:")
for row in r["linhas"][:6]:
    print(" ", row["data"], row["portaria"], row["tipo"], "|", row["classe"], row["letra"], row["grau"],
          "| qtd", row["qtd"], "|", (row["unidadeKey"] or "?"), "|", row["unidade"][:60])
print("\ntop unidades:")
for u in json.load(open(os.path.join(ROOT, "data", "doe", "ledger.json"), encoding="utf-8"))["unidadesDetalhe"][:12]:
    print(" ", u["key"], u["total"], u["classes"])
