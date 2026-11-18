#!/usr/bin/env python3
"""Tabelas de vencimentos dos funcionários (DRH/USP) — CSVs oficiais.

A página do DRH publica a tabela de vencimentos por Grau/Faixa (1–10) e letra
(A–D), uma edição por mês/ano. Aqui baixamos todas as edições disponíveis e
guardamos em data/vencimentos/<AAAA-MM>.json.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
PAGE = "https://drh.usp.br/trabalhe-na-usp/carreiras-usp/carreira-funcionarios/tabelas-salariais/tabelas-salariais-funcionarios/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "vencimentos")


def get(url: str, timeout=60) -> bytes:
    safe = urllib.parse.quote(url, safe=":/?&=%#")
    return urllib.request.urlopen(urllib.request.Request(safe, headers=UA), timeout=timeout).read()


def parse_csv(text: str):
    rows = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(";")]
        if len(parts) < 5 or not parts[0].isdigit():
            continue
        try:
            grau = int(parts[0])
            vals = [float(p.replace(".", "").replace(",", ".")) for p in parts[1:5]]
        except ValueError:
            continue
        rows.append([grau, *vals])
    return rows


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    html = get(PAGE).decode("utf-8", "replace")
    links = sorted(set(re.findall(r'https://drh\.usp\.br/wp-content/uploads/[^"\']+\.csv', html, re.I)))
    editions = {}
    for link in links:
        m = re.search(r"vencimentos-funcionarios-(\d{2})-(\d{4})", link, re.I)
        if not m:
            continue
        month, year = int(m.group(1)), int(m.group(2))
        key = f"{year}-{month:02d}"
        # prefere a versão https e o nome canônico
        editions.setdefault(key, link)
    print(f"{len(editions)} edições encontradas")

    for key, link in sorted(editions.items()):
        try:
            rows = parse_csv(get(link).decode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001
            print(f"  {key}: falhou ({exc})")
            continue
        if len(rows) < 5:
            print(f"  {key}: tabela vazia")
            continue
        payload = {
            "ref": key,
            "rows": rows,
            "source": link,
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        path = os.path.join(OUT, key + ".json")
        prev = None
        if os.path.exists(path):
            try:
                prev = json.load(open(path, encoding="utf-8"))
            except Exception:  # noqa: BLE001
                prev = None
        if prev and prev.get("rows") == payload["rows"]:
            continue
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"  {key}: {len(rows)} faixas")
    print("ok")


if __name__ == "__main__":
    main()
