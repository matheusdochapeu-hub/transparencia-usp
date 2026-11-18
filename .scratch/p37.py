import sys, urllib.request, ssl, urllib.error
sys.path.insert(0, r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp\scripts")
import extract_doe as ex

urls = [
    "http://diariooficial.imprensaoficial.com.br/doflash/prototipo/2015/Dezembro/11/exec1/pdf/pg_0110.pdf",
    "http://diariooficial.imprensaoficial.com.br/doflash/prototipo/2015/dezembro/11/exec1/pdf/pg_0110.pdf",
    "http://diariooficial.imprensaoficial.com.br/doflash/prototipo/2021/Dezembro/24/exec1/pdf/pg_0129.pdf",
    "http://diariooficial.imprensaoficial.com.br/doflash/prototipo/2019/Dezembro/20/exec1/pdf/pg_0100.pdf",
    "https://www.imprensaoficial.com.br/DO/GatewayPDF.aspx?pagina=110&caderno=Executivo%20I&data=11/12/2015",
]
for u in urls:
    try:
        b = ex.get(u, timeout=45)
        print("ok ", len(b), b[:5], u[:100])
    except Exception as e:
        print("ERR", str(e)[:60], u[:100])
