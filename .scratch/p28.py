import re, sys, json
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

tid = "20240604114211214357603"
cands = [
    f"https://do-api-publication-pdf.doe.sp.gov.br/hub/publication-document/{tid}",
    f"https://do-api-publication-pdf.doe.sp.gov.br/hub/publication-document?id={tid}",
    f"https://do-api-publication-workflow.doe.sp.gov.br/hub/publication-document/{tid}",
    f"https://do-api-publication-workflow.doe.sp.gov.br/publication-document/{tid}",
    f"https://do-api-publication-workflow.doe.sp.gov.br/hub/publication/{tid}",
]
for u in cands:
    try:
        b = ex.get(u, timeout=40)
        print(u, "->", len(b), b[:60])
        if b[:4] == b"%PDF":
            print("   PDF!")
            import pymupdf
            doc = pymupdf.open(stream=b, filetype="pdf")
            t = "\n".join(p.get_text() for p in doc)
            print("   texto:", len(t), re.sub(r"\s+", " ", t)[:300])
    except Exception as e:
        print(u, "-> ERRO", str(e)[:120])
