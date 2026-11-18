import os, re, sys, json, urllib.request

ROOT = r"C:\Users\matheus.ribeiro\Desktop\Matheus\5. IA\transparencia-usp"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import extract_doe as ex  # noqa: E402

years = list(range(2009, 2027))
out = {}
for y in years:
    try:
        html = ex.get(ex.DRH.format(year=y)).decode("utf-8", "replace")
    except Exception as e:
        out[y] = {"erro": str(e)}
        print(y, "ERRO", e)
        continue
    all_links = re.findall(r'href="(https://doe\.sp\.gov\.br[^"]+)"', html)
    entries = ex.collect(y)
    withlink = [e for e in entries if e.get("url")]
    out[y] = {"html": len(html), "links": len(all_links), "unique": len(set(all_links)),
              "entries": len(entries), "withlink": len(withlink),
              "uniqueUrls": len({e["url"] for e in withlink})}
    print(y, out[y], flush=True)
json.dump(out, open(os.path.join(ROOT, ".scratch", "years.json"), "w"), indent=1)
