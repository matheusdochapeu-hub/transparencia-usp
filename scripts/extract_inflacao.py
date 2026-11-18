#!/usr/bin/env python3
"""Séries mensais de inflação (IPCA, IGP-M, INPC) via API do Banco Central (SGS)."""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "inflacao.json")
SERIES = {"ipca": 433, "igpm": 189, "inpc": 188}


def main() -> None:
    out = {"series": {}, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    for name, code in SERIES.items():
        url = (
            f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados"
            f"?formato=json&dataInicial=01/01/2010&dataFinal=31/12/{datetime.now().year}"
        )
        req = urllib.request.Request(url, headers=UA)
        data = json.load(urllib.request.urlopen(req, timeout=60))
        rows = []
        for item in data:
            d, m, y = item["data"].split("/")
            rows.append([f"{y}-{m}", float(item["valor"])])
        out["series"][name] = rows
        print(f"  {name}: {len(rows)} meses ({rows[0][0]} .. {rows[-1][0]})")
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("ok", OUT)


if __name__ == "__main__":
    main()
