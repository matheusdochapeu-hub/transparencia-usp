#!/usr/bin/env python3
"""
Extrator do Portal da Transparência da USP — Informações de Servidores.

O portal não expõe API REST: a página carrega os dados via DWR (Direct Web
Remoting). Este script conversa diretamente com o endpoint DWR, o que é mais
rápido e estável do que raspar HTML.

Métodos usados:
  listarReferencia()                        -> competências disponíveis
  listarCampus()                            -> campi
  listarUnidade()                           -> unidades
  listarInfoServidor(proc, data, und, cam)  -> linhas agregadas

Cada linha traz contagens por vínculo:
  doc         Docente (ativo)
  tecAdm      Técnico Administrativo (ativo)
  docApos     Docente Aposentado
  tecAdmApos  Técnico Administrativo Aposentado

Uso:
  python scripts/extract.py                 # incremental (padrão)
  python scripts/extract.py --full          # rebaixa todo o histórico
  python scripts/extract.py --refresh-last 3
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://uspdigital.usp.br/portaltransparencia"
DWR_PATH = "/dwr/call/plaincall/InformacaoServidorControleDWR.{method}.dwr"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Ordem de exibição e títulos "bonitos" (o portal usa abreviações internas).
CATEGORIES = [
    ("categoria", "informacaoServidorCategoria", "Categoria"),
    ("classe", "informacaoServidorClasse", "Classe"),
    ("faixa-etaria", "informacaoServidorFaixaEtaria", "Faixa Etária"),
    ("formacao", "informacaoServidorFormacaoAcademica", "Formação Acadêmica"),
    ("funcao", "informacaoServidorFuncao", "Função"),
    ("funcao-estrutura", "informacaoServidorFuncaoEstrutura", "Função Estrutura"),
    ("jornada", "informacaoServidorJornada", "Jornada"),
    ("nacionalidade", "informacaoServidorNacionalidade", "Nacionalidade"),
    ("raca-cor", "informacaoServidorRacaCor", "Raça/Cor"),
    ("sexo", "informacaoServidorSexo", "Sexo"),
    ("tempo-usp", "informacaoServidorTempoUSP", "Tempo USP"),
]

OBJ_RE = re.compile(r"\{[^{}]*\}")
FIELD_RE = re.compile(r'(\w+):("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)')
ASSIGN_RE = re.compile(r'(s\d+)\.(\w+)=("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null);')
CALLBACK_RE = re.compile(
    r'handleCallback\(\s*"0"\s*,\s*"0"\s*,\s*(.*?)\s*\)\s*;\s*\}\)\(\);?\s*$', re.S
)


def log(*a):
    print(*a, flush=True)


def _scalar(tok):
    if tok.startswith('"'):
        return json.loads(tok)
    if tok == "null":
        return None
    if tok == "true":
        return True
    if tok == "false":
        return False
    return float(tok) if "." in tok else int(tok)


def parse_payload(payload: str):
    """Converte o literal JavaScript devolvido pelo DWR em lista de dicts."""
    records = []
    for m in OBJ_RE.finditer(payload):
        body = m.group(0)[1:-1]
        rec = {}
        for fm in FIELD_RE.finditer(body):
            rec[fm.group(1)] = _scalar(fm.group(2))
        if rec:
            records.append(rec)
    if not records and "=" in payload:
        # Formato alternativo do DWR: var s0={}; s0.campo="valor";
        buckets: dict[str, dict] = {}
        for am in ASSIGN_RE.finditer(payload):
            buckets.setdefault(am.group(1), {})[am.group(2)] = _scalar(am.group(3))
        records = list(buckets.values())
    return records


class Session:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.opener.addheaders = [("User-Agent", UA), ("Accept-Language", "pt-BR,pt;q=0.9")]
        self.page = "informacaoServidorCategoria"

    def warm(self):
        url = f"{BASE}/{self.page}"
        with self.opener.open(url, timeout=90) as r:
            r.read()
        return self

    def dwr(self, method: str, *params, timeout=180):
        lines = [
            "callCount=1",
            "page=" + urllib.parse.quote("/portaltransparencia/" + self.page, safe=""),
            "httpSessionId=",
            "scriptSessionId=",
            "instanceId=0",
            "windowName=",
            "c0-scriptName=InformacaoServidorControleDWR",
            "c0-methodName=" + method,
            "c0-id=0",
        ]
        for i, p in enumerate(params):
            if isinstance(p, bool) or p is None:
                lines.append(f"c0-param{i}=null")
            elif isinstance(p, int):
                lines.append(f"c0-param{i}=number:{p}")
            else:
                lines.append(f"c0-param{i}=string:{p}")
        lines.append("batchId=0")
        body = "\n".join(lines).encode("utf-8")
        req = urllib.request.Request(BASE + DWR_PATH.format(method=method), data=body)
        req.add_header("Content-Type", "text/plain")
        req.add_header("User-Agent", UA)
        with self.opener.open(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", "replace")
        if "handleException" in text:
            m = re.search(r'message:"(.*?)"', text, re.S)
            raise RuntimeError("DWR exception: " + (m.group(1) if m else text[:300]))
        m = CALLBACK_RE.search(text)
        if not m:
            raise RuntimeError("Resposta DWR inesperada: " + text[:300])
        return parse_payload(m.group(1))


def call_with_retry(sess: Session, method: str, *params, attempts=4):
    last = None
    for i in range(attempts):
        try:
            return sess.dwr(method, *params)
        except Exception as exc:  # noqa: BLE001
            last = exc
            wait = 1.5 * (i + 1) + random.random()
            log(f"    ! {method} falhou ({exc}); retry em {wait:.1f}s")
            time.sleep(wait)
            try:
                sess.warm()
            except Exception:  # noqa: BLE001
                sess.__init__()
    raise RuntimeError(f"Falha definitiva em {method}: {last}")


def ref_id_from_dtainictc(value: str) -> str:
    """'10/01/2026' -> '2026-10' (o portal usa MM/01/YYYY como competência)."""
    d, _, y = value.split("/")
    return f"{y}-{int(d):02d}"


def discover_procedures(sess: Session):
    """Lê os hidden inputs de cada página (procedure/descricao) como fallback."""
    found = {}
    for slug, page, _ in CATEGORIES:
        try:
            with sess.opener.open(f"{BASE}/{page}", timeout=60) as r:
                html = r.read().decode("iso-8859-1", "replace")
            proc = re.search(r'value="([^"]+)"\s+id="procedure"', html)
            desc = re.search(r'value="([^"]*)"\s+id="descricao"', html)
            if proc:
                found[slug] = (proc.group(1), desc.group(1).strip() if desc else None)
        except Exception as exc:  # noqa: BLE001
            log(f"  aviso: não foi possível ler {page}: {exc}")
    return found


def fetch_references(sess: Session):
    rows = call_with_retry(sess, "listarReferencia")
    refs = []
    for r in rows:
        raw = r.get("dtainictc")
        if not raw:
            continue
        label = (r.get("dtainictcExibicao") or "").strip()
        label = re.sub(r"\s*/\s*", "/", label)
        refs.append(
            {
                "id": ref_id_from_dtainictc(raw),
                "label": label,
                "serverDate": raw,
            }
        )
    # ordena do mais antigo para o mais recente
    refs.sort(key=lambda x: x["id"])
    # dedup (o portal repete a competência em várias linhas)
    out, seen = [], set()
    for r in refs:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        out.append(r)
    return out


def fetch_categories(sess: Session, proc_map, server_date: str):
    data = {}
    for slug, _, title in CATEGORIES:
        proc = proc_map.get(slug)
        if not proc:
            log(f"    aviso: procedure ausente para {slug}")
            continue
        rows = call_with_retry(sess, "listarInfoServidor", proc, server_date, "", "")
        clean = []
        for r in rows:
            label = (r.get("descricao") or "").strip() or "Total"
            clean.append(
                {
                    "label": label,
                    "doc": int(r.get("doc") or 0),
                    "tecAdm": int(r.get("tecAdm") or 0),
                    "docApos": int(r.get("docApos") or 0),
                    "tecAdmApos": int(r.get("tecAdmApos") or 0),
                }
            )
        clean.sort(key=lambda x: -x["doc"] - x["tecAdm"] - x["docApos"] - x["tecAdmApos"])
        data[slug] = clean
        time.sleep(0.12)
    return data


def write_json(path: str, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def load_json(path: str, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default


VOLATILE = {"fetchedAt", "checkedAt"}


def _strip_volatile(obj):
    if isinstance(obj, dict):
        return {k: _strip_volatile(v) for k, v in obj.items() if k not in VOLATILE}
    if isinstance(obj, list):
        return [_strip_volatile(v) for v in obj]
    return obj


def write_if_changed(path: str, obj) -> bool:
    """Só grava se os dados mudaram (ignora timestamps), mantendo o diff limpo."""
    prev = load_json(path)
    if prev is not None and _strip_volatile(prev) == _strip_volatile(obj):
        return False
    write_json(path, obj)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="rebaixa todo o histórico")
    ap.add_argument("--refresh-last", type=int, default=2, help="reaplica N competências mais recentes")
    ap.add_argument("--with-campus", action="store_true", help="também coleta totais por campus")
    ap.add_argument("--campus-categories", action="store_true", help="coleta todas as categorias por campus (último mês)")
    ap.add_argument("--only", default="", help="restringe a competências (ex.: 2026-10,2026-11)")
    ap.add_argument("--out", default="data/raw")
    args = ap.parse_args()

    sess = Session().warm()
    log("Sessão iniciada.")

    refs = fetch_references(sess)
    log(f"{len(refs)} competências: {refs[0]['id']} .. {refs[-1]['id']}")

    proc_map = {slug: f"SPlistarInfoServidor{''.join(w.capitalize() for w in slug.split('-'))}"
                for slug, _, _ in CATEGORIES}
    # Os nomes reais no portal são abreviados; descobre na fonte para garantir.
    discovered = discover_procedures(sess)
    for slug, (proc, _desc) in discovered.items():
        proc_map[slug] = proc
    write_if_changed(os.path.join(args.out, "_refs.json"), {"refs": refs, "procedures": proc_map})

    todo = refs
    if args.only:
        wanted = {x.strip() for x in args.only.split(",") if x.strip()}
        todo = [r for r in refs if r["id"] in wanted]
    elif not args.full:
        cached = [r for r in refs if os.path.exists(os.path.join(args.out, r["id"] + ".json"))]
        fresh = [r for r in refs if r not in cached]
        recent = cached[-args.refresh_last:] if args.refresh_last > 0 else []
        todo = fresh + recent
        todo.sort(key=lambda x: x["id"])
        log(f"Cache: {len(cached)} ok, {len(fresh)} novas, {len(recent)} reaplicadas")

    t0 = time.time()
    missing = []
    for i, r in enumerate(todo, 1):
        dest = os.path.join(args.out, r["id"] + ".json")
        log(f"[{i}/{len(todo)}] {r['id']} ({r['label']}) ...")
        cats = fetch_categories(sess, proc_map, r["serverDate"])
        # A competência só é válida se o total oficial (categoria "Total") existe.
        # Sem ele, o mês está incompleto no portal (já vimos meses com apenas
        # uma das 11 categorias publicada).
        official = sum(
            row["doc"] + row["tecAdm"] + row["docApos"] + row["tecAdmApos"]
            for row in (cats.get("categoria") or [])
        )
        total = official or 0
        if total == 0:
            # O portal não publicou esta competência (lacuna real) ou houve
            # indisponibilidade momentânea. Nunca sobrescrevemos um snapshot bom.
            if os.path.exists(dest):
                prev = load_json(dest) or {}
                prev_total = sum(
                    row.get("doc", 0) + row.get("tecAdm", 0) + row.get("docApos", 0) + row.get("tecAdmApos", 0)
                    for row in ((prev.get("categories") or {}).get("categoria") or [])
                )
                if prev_total > 0:
                    log("    portal devolveu vazio; mantendo snapshot anterior")
                    continue
                os.remove(dest)
            log("    sem dados publicados para esta competência (lacuna do portal)")
            missing.append({"ref": r["id"], "label": r["label"], "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            continue
        changed = write_if_changed(
            dest,
            {
                "ref": r["id"],
                "label": r["label"],
                "serverDate": r["serverDate"],
                "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "categories": cats,
            },
        )
        n = sum(len(v) for v in cats.values())
        log(f"    {n} linhas em {len(cats)} categorias{' (sem mudanças)' if not changed else ''} ({time.time() - t0:.0f}s)")

    if missing:
        write_if_changed(
            os.path.join(args.out, "_missing.json"),
            {"missing": missing},
        )
        log(f"Competências sem publicação: {', '.join(m['ref'] for m in missing)}")

    if args.with_campus:
        campuses = call_with_retry(sess, "listarCampus")
        camps = [{"code": str(c.get("codcam")), "name": c.get("nomcam")} for c in campuses]
        write_if_changed(os.path.join(args.out, "..", "raw-campus-meta.json"), {"campuses": camps})

        prev = load_json(os.path.join(args.out, "campus-series.json")) or {}
        prev_rows = {(r["ref"], str(r["campus"])): r for r in prev.get("rows", [])}
        recent = set() if args.full else {r["id"] for r in refs[-max(args.refresh_last, 0):]}

        # monta a lista de (competência, campus) que realmente precisa ser consultada
        cached_rows, todo_campus = [], []
        for r in refs:
            for c in camps:
                key = (r["id"], c["code"])
                if not args.full and key in prev_rows and r["id"] not in recent:
                    cached_rows.append(prev_rows[key])
                else:
                    todo_campus.append((r, c))

        log(f"Campus: {len(todo_campus)} consultas novas, {len(cached_rows)} reaproveitadas")
        rows = []
        for k, (r, c) in enumerate(todo_campus, 1):
            try:
                out = call_with_retry(
                    sess, "listarInfoServidor", proc_map["categoria"], r["serverDate"], "", c["code"]
                )
            except Exception as exc:  # noqa: BLE001
                log(f"    campus {c['code']} {r['id']}: {exc}")
                continue
            if not out:
                continue
            row = out[0]
            rows.append(
                {
                    "ref": r["id"],
                    "campus": c["code"],
                    "doc": int(row.get("doc") or 0),
                    "tecAdm": int(row.get("tecAdm") or 0),
                    "docApos": int(row.get("docApos") or 0),
                    "tecAdmApos": int(row.get("tecAdmApos") or 0),
                }
            )
            if k % 60 == 0:
                log(f"    campus {k}/{len(todo_campus)}")
            time.sleep(0.1)

        all_rows = cached_rows + rows
        all_rows.sort(key=lambda x: (x["ref"], x["campus"]))
        write_if_changed(
            os.path.join(args.out, "campus-series.json"),
            {"campuses": camps, "rows": all_rows, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")},
        )
        log(f"Campus: {len(all_rows)} linhas.")

    if args.campus_categories and refs:
        latest = refs[-1]
        campuses = call_with_retry(sess, "listarCampus")
        camps = [{"code": str(c.get("codcam")), "name": c.get("nomcam")} for c in campuses]
        by_campus = {}
        for c in camps:
            log(f"  campus {c['name']} ({c['code']}) categorias ...")
            by_campus[c["code"]] = {}
            for slug, _, _ in CATEGORIES:
                out = call_with_retry(
                    sess, "listarInfoServidor", proc_map[slug], latest["serverDate"], "", c["code"]
                )
                by_campus[c["code"]][slug] = [
                    {
                        "label": (row.get("descricao") or "").strip() or "Total",
                        "doc": int(row.get("doc") or 0),
                        "tecAdm": int(row.get("tecAdm") or 0),
                        "docApos": int(row.get("docApos") or 0),
                        "tecAdmApos": int(row.get("tecAdmApos") or 0),
                    }
                    for row in out
                ]
                time.sleep(0.1)
        write_if_changed(
            os.path.join(args.out, "campus-categories.json"),
            {
                "ref": latest["id"],
                "label": latest["label"],
                "campuses": camps,
                "data": by_campus,
                "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
        )
        log("Categorias por campus: ok.")

    log(f"Concluído em {time.time() - t0:.0f}s.")


if __name__ == "__main__":
    main()
