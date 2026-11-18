import os, sys, re
ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex

url = ("http://imprensaoficial.com.br/PortalIO/DO/BuscaDO2001Documento_11_4.aspx?"
       "link=/2009/executivo%2520secao%2520i/dezembro/23/pag_0125_8QGK1U121S1L2e0TV3A19CI4FPK.pdf"
       "&pagina=125&data=23/12/2009&caderno=Executivo%20I&paginaordenacao=100125")
text, err = ex.load_page({"kind": "pdf", "urls": [url]}, offline=False)
print("err:", err, "chars:", len(text))
ports, notes = ex.parse_page(text, {"year": 2009, "url": url, "kind": "pdf", "date": ""})
print("portarias:", len(ports), "linhas:", sum(len(p["rows"]) for p in ports))
for p in ports:
    print(" ", p["sigla"], p["numero"], p["data"], p["tipo"], "|", p["ementa"][:55])
    for row in p["rows"]:
        print("     ", row["tipo"], "|", row["classe"], row["letra"], row["grau"], "| qtd", row["qtd"],
              "|", row["unidadeKey"], "|", row["unidade"][:45], "->", row["para"][:40] if row["tipo"] != "distribuicao" else "")
print("notas:", notes)
