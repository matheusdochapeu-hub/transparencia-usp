import os, re, sys, ssl, urllib.request

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex  # noqa: E402

html = ex.get(ex.DRH.format(year=2009)).decode("utf-8", "replace")
# blocos <p> com emprego e hrefs
blocks = re.findall(r"<p[^>]*>([\s\S]*?)</p>", html)
print("blocos p:", len(blocks))
shown = 0
for b in blocks:
    t = ex.strip_tags(b)
    if not re.search(r"emprego", t, re.I):
        continue
    hrefs = re.findall(r'href="([^"]+)"', b)
    pdfs = [h for h in hrefs if re.search(r"\.pdf|imprensaoficial", h, re.I)]
    if not pdfs:
        continue
    print("-" * 100)
    print("TEXTO:", re.sub(r"\s+", " ", t)[:400])
    for h in pdfs:
        print("   LINK:", h[:200])
    shown += 1
    if shown >= 4:
        break

# testa o primeiro pdf
link = None
for b in blocks:
    t = ex.strip_tags(b)
    if re.search(r"emprego", t, re.I):
        for h in re.findall(r'href="([^"]+)"', b):
            if ".pdf" in h.lower():
                link = h
                break
    if link:
        break
print("\nTESTE:", link)
if link:
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(link, headers=ex.UA)
    r = urllib.request.urlopen(req, timeout=60, context=ctx)
    b = r.read()
    print("status", r.status, r.geturl(), "bytes", len(b), "magic", b[:5])
