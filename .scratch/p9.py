import os, re, sys, ssl, urllib.request

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex  # noqa: E402

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
base = "http://imprensaoficial.com.br/PortalIO/DO/"
url = base + "GatewayPDF.aspx?pagina=125&caderno=Executivo%20I&data=23/12/2009&link=/2009/executivo%20secao%20i/dezembro/23/pag_0125_8QGK1U121S1L2e0TV3A19CI4FPK.pdf&paginaordenacao=100125"
r = urllib.request.urlopen(urllib.request.Request(url, headers=ex.UA), timeout=60, context=ctx)
h = r.read().decode("utf-8", "replace")
print("status", r.status, "final", r.geturl(), "len", len(h))
print(h[:4000])
print("\n--- candidatos ---")
for u in set(re.findall(r'["\']([^"\']*(?:pdf|gateway|ashx)[^"\']*)["\']', h, re.I)):
    print(u[:250])
