#!/usr/bin/env python3
"""
Raspagem do D.O.E. (Universidade de São Paulo) para empregos públicos.

Fluxo:
  1. lê as páginas anuais do DRH (d-o-e-<ano>) e coleta as portarias que
     mencionam emprego público / cargos / distribuição / redistribuição;
  2. renderiza cada portaria no Chrome headless (o portal do D.O.E. é SPA)
     e guarda o HTML em cache (data/doe/cache);
  3. extrai da prosa: número do emprego, classe/letra, unidade de origem e destino;
  4. monta o livro-razão (data/doe/redistribuicoes.json) e um relatório de cobertura.

Uso:
  python scripts/extract_doe.py --years 2024 2025 2026 --limit 60
  python scripts/extract_doe.py --years 2024 2025 2026 --list-only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOE = os.path.join(ROOT, "data", "doe")
CACHE = os.path.join(DOE, "cache")
DRH = "https://drh.usp.br/biblioteca-drh/legislacao/diario-oficial-do-estado/d-o-e-{year}/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
FILTER = re.compile(r"emprego", re.I)


def chrome_bin() -> str:
    for cand in (
        os.environ.get("CHROME_BIN"),
        shutil.which("google-chrome"),
        shutil.which("chrome"),
        shutil.which("chromium"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ):
        if cand and os.path.exists(cand):
            return cand
    raise SystemExit("Chrome não encontrado (defina CHROME_BIN)")


def get(url: str, timeout=60) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def strip_tags(html: str) -> str:
    txt = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    txt = re.sub(r"<style[\s\S]*?</style>", " ", txt, flags=re.I)
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = txt.replace("&nbsp;", " ").replace("&#8211;", "–").replace("&#8217;", "'")
    txt = txt.replace("&amp;", "&").replace("&quot;", '"').replace("&#8220;", "“").replace("&#8221;", "”")
    return re.sub(r"[ \t]+", " ", txt).strip()


def collect(year: int, throttle: float = 0.0):
    import time

    html = get(DRH.format(year=year)).decode("utf-8", "replace")
    entries = []
    for m in re.finditer(r"<p[^>]*>([\s\S]*?)</p>", html):
        block = m.group(1)
        links = re.findall(r'<a[^>]+href="(https://doe\.sp\.gov\.br[^"]+)"[^>]*>([\s\S]*?)</a>', block)
        text = strip_tags(block)
        if not FILTER.search(text):
            continue
        for url, title in links:
            entries.append(
                {
                    "year": year,
                    "title": strip_tags(title),
                    "desc": text,
                    "url": url,
                }
            )
        if not links and FILTER.search(text):
            entries.append({"year": year, "title": text[:160], "desc": text, "url": None})
        if throttle:
            time.sleep(throttle)
    return entries


def render(url: str) -> str:
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    path = os.path.join(CACHE, key + ".html")
    if os.path.exists(path):
        return open(path, encoding="utf-8", errors="replace").read()
    os.makedirs(CACHE, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="chr-")
    cmd = [
        chrome_bin(), "--headless=new", "--disable-gpu", "--no-first-run",
        "--disable-extensions", f"--user-data-dir={tmp}",
        "--virtual-time-budget=10000", "--dump-dom", url,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=90, encoding="utf-8", errors="replace")
        html = out.stdout or ""
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if len(html) < 500:
        raise RuntimeError("DOM vazio")
    open(path, "w", encoding="utf-8").write(html)
    return html


EMP = re.compile(r"emprego\s+p[úu]blico\s+(?:n[º°]\s*)?(\d{5,7})", re.I)
CLASSE = re.compile(r"\b(Superior|T[ée]cnico|B[áa]sico)\s+([STB]\s?\d)\s*([A-D])?\b", re.I)
REDIST = re.compile(
    r"fica\s+redistribu[íi]d[oa]\s+d[ao]\s+(.+?)\s+para\s+(?:a\s+|o\s+)?(.+?)(?:\.|$)",
    re.I,
)
DISTRIB = re.compile(
    r"fica\s+distribu[íi]d[oa]\s+(?:[àa]|na|no|para\s+a|para\s+o)\s+(.+?)(?:\.|$)",
    re.I,
)
CRIADOS = re.compile(r"ficam?\s+criad[oa]s?\s+(\d+)\s+empregos?\s+p[úu]blicos?", re.I)


def parse(text: str, entry: dict):
    rows = []
    body = re.sub(r"\s+", " ", text)
    if not EMP.search(body):
        return rows
    for para in re.split(r"Artigo\s+1[º°]", body):
        if "emprego" not in para.lower():
            continue
        nums = EMP.findall(para)
        if not nums:
            continue
        cls = CLASSE.search(para)
        red = REDIST.search(para)
        dis = DISTRIB.search(para)
        for n in nums:
            rows.append(
                {
                    "data": entry.get("year"),
                    "portaria": entry.get("title", "")[:120],
                    "url": entry.get("url"),
                    "emprego": n,
                    "classe": (cls.group(1).title() if cls else ""),
                    "letra": (cls.group(2).replace(" ", "").upper() if cls else ""),
                    "grau": (cls.group(3).upper() if cls and cls.group(3) else ""),
                    "de": (red.group(1).strip() if red else ""),
                    "para": (red.group(2).strip() if red else (dis.group(1).strip() if dis else "")),
                    "tipo": "redistribuicao" if red else ("distribuicao" if dis else "outro"),
                }
            )
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", nargs="+", type=int, default=[2024, 2025, 2026])
    ap.add_argument("--limit", type=int, default=0, help="máximo de portarias renderizadas (0 = todas)")
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--out", default=os.path.join(DOE, "redistribuicoes.json"))
    args = ap.parse_args()

    os.makedirs(DOE, exist_ok=True)
    entries = []
    for y in args.years:
        got = collect(y)
        print(f"{y}: {len(got)} entradas com palavras-chave")
        entries.extend(got)

    with_link = [e for e in entries if e.get("url")]
    no_link = [e for e in entries if not e.get("url")]
    print(f"total: {len(entries)} | com link: {len(with_link)} | sem link: {len(no_link)}")

    if args.list_only:
        for e in entries[:40]:
            print(f"  [{e['year']}] {e['title'][:70]} -> {e['url'] or '(sem link)'}")
        return

    todo = with_link[: args.limit] if args.limit else with_link
    rows, fails = [], []
    for i, e in enumerate(todo, 1):
        try:
            html = render(e["url"])
            text = strip_tags(html)
            rows.extend(parse(text, e))
            print(f"  [{i}/{len(todo)}] ok  {e['title'][:60]}")
        except Exception as exc:  # noqa: BLE001
            fails.append({"title": e["title"], "url": e["url"], "erro": str(exc)})
            print(f"  [{i}/{len(todo)}] ERRO {e['title'][:50]}: {exc}")

    uniq = {}
    for r in rows:
        uniq.setdefault(r["emprego"], []).append(r)
    redist = [r for r in rows if r["tipo"] == "redistribuicao"]

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "years": args.years,
        "entries": len(entries),
        "entriesWithLink": len(with_link),
        "entriesWithoutLink": len(no_link),
        "rendered": len(todo) - len(fails),
        "failed": fails,
        "rows": rows,
        "distinctEmpregos": len(uniq),
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    print()
    print(f"portarias renderizadas: {len(todo) - len(fails)}/{len(todo)}")
    print(f"linhas extraídas: {len(rows)} | empregos distintos: {len(uniq)}")
    print(f"redistribuições: {len(redist)} | distribuições: {sum(1 for r in rows if r['tipo']=='distribuicao')}")
    print("gravado em", args.out)


if __name__ == "__main__":
    main()
