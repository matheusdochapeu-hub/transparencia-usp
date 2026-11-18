#!/usr/bin/env python3
"""Compacta os arquivos data/scope/*.json (dicts -> arrays) para reduzir o repositório."""

from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "data", "scope")


def compact_rows(rows):
    out = []
    for r in rows:
        if isinstance(r, dict):
            out.append(
                [
                    r.get("label") or "Total",
                    int(r.get("doc") or 0),
                    int(r.get("tecAdm") or 0),
                    int(r.get("docApos") or 0),
                    int(r.get("tecAdmApos") or 0),
                ]
            )
        else:
            out.append(r)
    return out


def main() -> None:
    total_before = total_after = 0
    for name in sorted(os.listdir(DIR)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(DIR, name)
        before = os.path.getsize(path)
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        changed = False
        for cats in (data.get("refs") or {}).values():
            for slug, rows in cats.items():
                new = compact_rows(rows)
                if new is not rows:
                    cats[slug] = new
                    changed = True
        if changed:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, path)
        after = os.path.getsize(path)
        total_before += before
        total_after += after
        print(f"  {name:18} {before/1e6:6.2f} -> {after/1e6:6.2f} MB")
    print(f"total: {total_before/1e6:.1f} -> {total_after/1e6:.1f} MB")


if __name__ == "__main__":
    main()
