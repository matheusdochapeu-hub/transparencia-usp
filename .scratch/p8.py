import os, re, sys, ssl, urllib.request

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex  # noqa: E402

url = "http://imprensaoficial.com.br/PortalIO/DO/BuscaDO2001Documento_11_4.aspx?link=/2009/executivo%2520secao%2520i/dezembro/23/pag_0125_8QGK1U121S1L2e0TV3A19CI4FPK.pdf&pagina=125&data=23/12/2009&caderno=Executivo%20I&paginaordenacao=100125"
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
r = urllib.request.urlopen(urllib.request.Request(url, headers=ex.UA), timeout=60, context=ctx)
h = r.read().decode("utf-8", "replace")
print("status", r.status, "len", len(h))
print(h[:3000])
print("\n--- urls no html ---")
for u in set(re.findall(r'(?:src|href)="([^"]+)"', h)):
    print(u[:220])
