import os, re, sys, ssl, urllib.request, urllib.parse

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex  # noqa: E402
import pymupdf  # noqa: E402

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=ex.UA), timeout=90, context=ctx).read()

viewer = "http://imprensaoficial.com.br/PortalIO/DO/BuscaDO2001Documento_11_4.aspx?link=/2009/executivo%2520secao%2520i/dezembro/23/pag_0125_8QGK1U121S1L2e0TV3A19CI4FPK.pdf&pagina=125&data=23/12/2009&caderno=Executivo%20I&paginaordenacao=100125"
h = fetch(viewer).decode("utf-8", "replace")
m = re.search(r'<iframe[^>]+src="([^"]*GatewayPDF[^"]*)"', h)
print("iframe:", m.group(1)[:200] if m else None)
src = m.group(1).replace("&amp;", "&")
pdf_url = urllib.parse.urljoin(viewer, src).replace(" ", "%20")
raw = fetch(pdf_url)
print("bytes", len(raw), raw[:5])
doc = pymupdf.open(stream=raw, filetype="pdf")
t = "\n".join(p.get_text() for p in doc)
print("paginas", doc.page_count, "chars", len(t))
print("=" * 100)
print(t[:7000])
