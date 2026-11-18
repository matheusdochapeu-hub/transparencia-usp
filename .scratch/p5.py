import os, re, sys, collections

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex  # noqa: E402

for y in (2009, 2014, 2021, 2023):
    html = ex.get(ex.DRH.format(year=y)).decode("utf-8", "replace")
    hrefs = re.findall(r'href="([^"]+)"', html)
    print("=" * 100)
    print(y, "html", len(html), "hrefs", len(hrefs))
    print("dominios:", collections.Counter(re.sub(r"^(https?://[^/]+).*", r"\1", h) if "://" in h else h.split(":")[0] for h in hrefs).most_common(8))
    # primeiros hrefs que nao sao assets
    for h in hrefs:
        if re.search(r"doe|diario|pdf", h, re.I):
            print("   ", h[:160])
    # amostra da estrutura em volta de 'emprego'
    t = ex.strip_tags(html)
    m = re.search(r"emprego", t, re.I)
    if m:
        print("TEXTO:", re.sub(r"\s+", " ", t[max(0, m.start() - 300): m.start() + 300]))
