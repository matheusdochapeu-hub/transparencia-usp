import os, sys, re
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

for year in (2010, 2011, 2012, 2013, 2015, 2018, 2020, 2022, 2023):
    try:
        entries = ex.collect(year)
    except Exception as e:
        print(year, "ERRO collect:", e)
        continue
    groups = list(ex.group_pages(entries).values())
    if not groups:
        print(year, "sem páginas")
        continue
    g = groups[0]
    text, err = ex.load_page(g)
    if err:
        print(year, "ERRO load:", err[:120])
        continue
    ports, notes = ex.parse_page(text, {"year": year, "url": g["urls"][0], "kind": g["kind"], "date": ""})
    print(f"{year} [{g['kind']}] paginas={len(groups)} chars={len(text)} portarias={len(ports)} "
          f"linhas={sum(len(p['rows']) for p in ports)} notas={len(notes)}")
    for p in ports[:3]:
        print("   ", p["sigla"], p["numero"], p["data"], p["tipo"], "|", p["ementa"][:60])
        for row in p["rows"][:3]:
            print("      ", row["tipo"], row["classe"], row["letra"], row["grau"], row["qtd"],
                  "|", row["unidadeKey"], "|", row["unidade"][:40], "| de:", row["de"][:35] if row["de"] else "")
    if notes:
        print("    notas:", notes[:3])
