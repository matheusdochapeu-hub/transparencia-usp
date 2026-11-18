#!/usr/bin/env python3
"""
Raspagem do D.O.E. (Universidade de São Paulo) para empregos públicos.

O que faz
---------
1. Lê as páginas anuais do DRH (d-o-e-<ano>) e coleta toda publicação que
   mencione "emprego público" — tanto as páginas novas do portal
   doe.sp.gov.br (SPA, 2023+) quanto os PDFs do acervo antigo da Imprensa
   Oficial (2009–2022).
2. Renderiza/baixa cada página UMA vez (dedupe por página, não por portaria:
   uma única página do D.O.E. costuma trazer dezenas de portarias em lote).
3. Extrai da prosa, portaria a portaria: número do emprego, classe/letra/grau,
   quantidade, unidade de origem e de destino — inclusive as tabelas
   "Grupo / Faixa / Nível" do formato antigo e "Grupo / Qtde." do novo.
4. Casa a unidade com a sigla do Anuário Estatístico (scripts/doe_units.py).
5. Monta o livro-razão (distribuições criam estoque, redistribuições movem) e
   mede a cobertura contra o efetivo técnico-administrativo do Anuário.

Uso
---
  python scripts/extract_doe.py --list-only --years 2024 2025 2026
  python scripts/extract_doe.py --years 2024 2025 2026 --jobs 4
  python scripts/extract_doe.py --years 2009 2010 --offline      # só cache
  python scripts/extract_doe.py --years 2024 --limit 5 --refresh

Saídas (data/doe/)
------------------
  rows.json      uma linha por (portaria, emprego/classe) + diagnóstico
  ledger.json    estoque por unidade/classe, série anual e cobertura vs Anuário
  pages.json     índice de páginas (url, formato, status, nº de portarias)
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html as html_mod
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, OrderedDict, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from doe_units import match_unit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOE = os.path.join(ROOT, "data", "doe")
CACHE = os.path.join(DOE, "cache")
DRH = "https://drh.usp.br/biblioteca-drh/legislacao/diario-oficial-do-estado/d-o-e-{year}/"
LEGINF = "https://leginf.usp.br/portarias-indices-anuais-completos/?ano={year}"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

FILTER = re.compile(r"emprego", re.I)  # a página parseada decide o que é emprego público
SECURE = ssl.create_default_context()
INSECURE = ssl.create_default_context()
INSECURE.check_hostname = False
INSECURE.verify_mode = ssl.CERT_NONE

MONTHS = {
    "janeiro": 1, "fevereiro": 2, "marco": 3, "abril": 4, "maio": 5, "junho": 6,
    "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
}


# ---------------------------------------------------------------- utilidades

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


def get(url: str, timeout: int = 90) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=SECURE).read()
    except urllib.error.URLError as exc:
        if "CERTIFICATE" in str(exc).upper():
            return urllib.request.urlopen(req, timeout=timeout, context=INSECURE).read()
        raise


def strip_tags(html: str) -> str:
    txt = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    txt = re.sub(r"<style[\s\S]*?</style>", " ", txt, flags=re.I)
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = html_mod.unescape(txt)
    txt = txt.replace("\u00ad", "")
    txt = re.sub(r"(?i)\bNormal\s+0\s+21\s+false\s+false\s+false\s+PT-BR\s+X-NONE\s+X-NONE\b", " ", txt)
    return re.sub(r"\s+", " ", txt).strip()


def to_iso(raw: str, default: str = "") -> str:
    if not raw:
        return default
    raw = raw.strip()
    m = re.match(r"(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})", raw)
    if m:
        day, mon, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if year < 100:
            year += 2000
        if 1 <= mon <= 12 and 1 <= day <= 31:
            return f"{year:04d}-{mon:02d}-{day:02d}"
    m = re.match(r"(\d{1,2})\s+de\s+([a-zçãõáéíóúâêô]+)\s+de\s+(\d{4})", raw, re.I)
    if m:
        mon = MONTHS.get(re.sub(r"[^a-z]", "", m.group(2).lower()))
        if mon:
            return f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(1)):02d}"
    return default


def sha(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:16]


def cache_path(kind: str, key: str, ext: str) -> str:
    return os.path.join(CACHE, kind, key + ext)


def legacy_spa_path(key: str) -> str:
    return os.path.join(CACHE, key + ".html")


# ------------------------------------------------------------------ coleta

LINK_HREF = re.compile(r'href="([^"]+)"')
PAGE_NUM = re.compile(r"P[áa]gina\s*(\d+)", re.I)
TITLE_NUM = re.compile(r"(Portaria[^|]{0,90}?)(?:\s*\|\s*P[áa]gina|\s*$)", re.I)


def classify_link(raw: str):
    url = html_mod.unescape(raw).strip()
    low = url.lower()
    if low.startswith("#") or low.startswith("javascript"):
        return None
    if "doe.sp.gov.br" in low and ".pdf" not in low:
        return "spa"
    if ".pdf" in low or "imprensaoficial" in low or "gatewaypdf" in low:
        return "pdf"
    return None


def pdf_page_key(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    for name in ("link", "Link"):
        if name in query:
            return query[name][0]
    return url


def collect(year: int):
    """Lista de entradas (uma por portaria listada) com url e formato."""
    html = get(DRH.format(year=year)).decode("utf-8", "replace")
    entries = []
    for block in re.findall(r"<p[^>]*>([\s\S]*?)</p>", html):
        text = strip_tags(block)
        if not FILTER.search(text):
            continue
        tm = TITLE_NUM.search(text)
        title = (tm.group(1) if tm else text[:140]).strip()
        page = PAGE_NUM.search(text)
        date = re.search(r"\bde\s+(\d{1,2}[./]\d{1,2}[./]\d{2,4})", text)
        base = {
            "year": year,
            "title": re.sub(r"\s+", " ", title)[:160],
            "page": int(page.group(1)) if page else None,
            "date": to_iso(date.group(1)) if date else "",
        }
        links = []
        for raw in LINK_HREF.findall(block):
            kind = classify_link(raw)
            if kind:
                links.append((kind, html_mod.unescape(raw)))
        if not links:
            entries.append({**base, "url": None, "kind": None})
            continue
        seen = set()
        for kind, url in links:
            if url in seen:
                continue
            seen.add(url)
            entries.append({**base, "url": url, "kind": kind})
    return entries


def collect_leginf(year: int):
    """Índice anual de portarias da Normas USP (fonte alternativa, cobre 2013)."""
    html = get(LEGINF.format(year=year)).decode("utf-8", "replace")
    entries = []
    for art in re.findall(r"<article[^>]*>([\s\S]*?)</article>", html):
        link = re.search(r'<h1[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)</a>', art)
        if not link:
            continue
        data = re.search(r"D\.O\.E\.:\s*(\d{1,2}/\d{1,2}/\d{2,4})", art)
        resumo = re.search(r'<div class="entry-summary">([\s\S]*?)</div>', art)
        ementa = strip_tags(resumo.group(1)) if resumo else ""
        titulo = strip_tags(link.group(2))
        if not FILTER.search(ementa) and not FILTER.search(titulo):
            continue
        entries.append({
            "year": year,
            "title": re.sub(r"\s+", " ", titulo)[:160],
            "desc": ementa[:300],
            "url": html_mod.unescape(link.group(1)),
            "kind": "leginf",
            "date": to_iso(data.group(1)) if data else "",
            "page": None,
        })
    return entries


def group_pages(entries):
    """Agrupa entradas por página do D.O.E. (uma renderização por página)."""
    groups = OrderedDict()
    for entry in entries:
        if not entry.get("url"):
            continue
        kind = entry["kind"]
        key = entry["url"] if kind in ("spa", "leginf") else pdf_page_key(entry["url"])
        group = groups.setdefault(key, {
            "key": key, "kind": kind, "year": entry["year"],
            "urls": [], "entries": [], "titles": [],
        })
        if entry["url"] not in group["urls"]:
            group["urls"].append(entry["url"])
        group["entries"].append(entry)
        if entry.get("title") and entry["title"] not in group["titles"]:
            group["titles"].append(entry["title"])
    # URLs diretas de PDF primeiro; depois o visualizador antigo
    for group in groups.values():
        if group["kind"] == "pdf":
            group["urls"].sort(key=lambda u: (0 if u.lower().endswith(".pdf") and "buscado" not in u.lower() else 1))
    return groups


# ------------------------------------------------------------- renderização

def render_spa(url: str, refresh: bool = False, offline: bool = False) -> str:
    key = sha(url)
    for path in (cache_path("spa", key, ".html"), legacy_spa_path(key)):
        if os.path.exists(path) and not refresh:
            return open(path, encoding="utf-8", errors="replace").read()
    if offline:
        raise RuntimeError("página não está no cache (offline)")
    path = cache_path("spa", key, ".html")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="chr-")
    cmd = [
        chrome_bin(), "--headless=new", "--disable-gpu", "--no-first-run",
        "--disable-extensions", "--no-sandbox", f"--user-data-dir={tmp}",
        "--virtual-time-budget=20000", "--dump-dom", url,
    ]
    try:
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
            encoding="utf-8", errors="replace",
        )
        html = out.stdout or ""
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if len(html) < 1000:
        raise RuntimeError("DOM vazio")
    open(path, "w", encoding="utf-8").write(html)
    return html


def pdf_from_viewer(html_text: str, viewer_url: str):
    m = re.search(r'<iframe[^>]+src="([^"]*(?:GatewayPDF|\.pdf)[^"]*)"', html_text, re.I)
    if not m:
        return None
    src = html_mod.unescape(m.group(1)).replace(" ", "%20")
    return urllib.parse.urljoin(viewer_url, src)


def download_pdf(urls, refresh: bool = False, offline: bool = False) -> str:
    """Baixa (ou lê do cache) o PDF da página e devolve o texto extraído."""
    key = sha(pdf_page_key(urls[0]))
    txt_path = cache_path("txt", key, ".txt")
    if os.path.exists(txt_path) and not refresh:
        return open(txt_path, encoding="utf-8", errors="replace").read()
    if offline:
        raise RuntimeError("página não está no cache (offline)")

    raw = None
    errors = []
    for url in urls:
        try:
            body = get(url)
            if body[:4] == b"%PDF":
                raw = body
                break
            html_text = body.decode("utf-8", "replace")
            candidate = pdf_from_viewer(html_text, url)
            if candidate:
                body2 = get(candidate)
                if body2[:4] == b"%PDF":
                    raw = body2
                    break
            errors.append(f"{url}: não é PDF")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{url}: {exc}")
    if raw is None:
        raise RuntimeError("; ".join(errors)[:300])

    import pymupdf

    doc = pymupdf.open(stream=raw, filetype="pdf")
    text = "\n".join(pg.get_text() for pg in doc)
    os.makedirs(os.path.dirname(txt_path), exist_ok=True)
    open(txt_path, "w", encoding="utf-8").write(text)
    pdf_path = cache_path("pdf", key, ".pdf")
    os.makedirs(os.path.dirname(pdf_path), exist_ok=True)
    open(pdf_path, "wb").write(raw)
    return text


def load_page(group, refresh: bool = False, offline: bool = False):
    """Devolve (texto, erro) para uma página, usando cache quando possível."""
    try:
        if group["kind"] == "spa":
            text = strip_tags(render_spa(group["urls"][0], refresh=refresh, offline=offline))
        elif group["kind"] == "leginf":
            titulo = group["titles"][0] if group.get("titles") else ""
            text = load_leginf(group["urls"][0], titulo, refresh=refresh, offline=offline)
        else:
            text = download_pdf(group["urls"], refresh=refresh, offline=offline)
        return text, None
    except Exception as exc:  # noqa: BLE001
        return "", str(exc)


def load_leginf(url: str, titulo: str = "", refresh: bool = False, offline: bool = False) -> str:
    key = sha("leginf:" + url)
    path = cache_path("txt", key, ".txt")
    if os.path.exists(path) and not refresh:
        return open(path, encoding="utf-8", errors="replace").read()
    if offline:
        raise RuntimeError("página não está no cache (offline)")
    html = get(url).decode("utf-8", "replace")
    m = re.search(r'<div class="entry-content[^"]*"[^>]*>([\s\S]*?)(?:<footer|</article>)', html)
    corpo = strip_tags(m.group(1) if m else html)
    # a página da Normas USP não repete o cabeçalho da portaria: reconstruímos
    text = (titulo + ". " + corpo).strip() if titulo else corpo
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)
    return text


# ------------------------------------------------------------------ parser

PORT_HEADER = re.compile(
    r"(?i)\bportaria\s+(?P<meta>[a-zçãõáéíóúâêôà ]{0,24}?)\s*[-–]?\s*"
    r"(?:n[º°o]\.?\s*)?(?P<num>\d[\d.]{2,8})\s*,\s*(?:de\s+)?"
    r"(?P<data>\d{1,2}[-./]\d{1,2}[-./]\d{2,4}"
    r"|\d{1,2}(?:\s+de\s+\d{1,2})?\s+de\s+[a-zçãõáéíóúâêô]+\s+de\s+\d{4})"
)

DIST = re.compile(
    r"(?i)distribu[íi]d[oa]s?\s*,?\s+(?:junto\s+)?"
    r"(?:aos?|às?|à|ao|as?|nos?|nas?|na|no|para\s+a|para\s+o)\s+"
    r"(?P<unit>.+?)\s*,?\s*(?P<qtd>\d{1,3})\s*"
    r"(?:\((?P<qtdw>[^)]{1,60})\))?\s*(?:emprego|empregos)\s+p[úu]blicos?"
)

ROW = re.compile(
    r"(?i)\b(?P<classe>b[áa]sico|t[ée]cnico|superior)\s+"
    r"(?P<letra>[a-z]{1,2}\d{0,2}|[ivx]{1,4}|\d{1,2})\s+"
    r"(?P<grau>[a-z])\s+"
    r"(?:(?P<cat>[^\W\d_][^\d]{1,60}?)\s+)?"
    r"(?P<qtd>\d{1,3})\b"
)

MOV = re.compile(
    r"(?i)(?:redistribu|transfer)[íi]d[oa]s?\s+(?P<de>.+?)\s+para\s+"
    r"(?:a\s+|o\s+|à\s+|ao\s+)?(?P<para>.+?)(?:\.|;|$)"
)

EMP_NUM = re.compile(r"(?i)empregos?\s+p[úu]blicos?\s+(\d{6,7})")

MULTI_HEAD = re.compile(
    r"(?i)empregos?\s+p[úu]blicos?\s+relacionad[oa]s\s+abaixo"
    r"|emprego\s+p[úu]blico\s+grupo\s*/?\s*faixa"
)
MULTI_ROW = re.compile(
    r"(?P<num>\d{6,7})\s+(?P<classe>Superior|T[ée]cnico|B[áa]sico)\s+"
    r"(?P<letra>[A-Z0-9]{1,3})\s+(?P<grau>[A-Z])\s+(?P<port>\d{3,4}/\d{4})\s+"
    r"(?P<unit>.+?)(?=(?:\s+\d{6,7}\s+(?:Superior|T[ée]cnico|B[áa]sico))|$)"
)


def parse_multi_moves(chunk: str):
    """Tabelas do tipo 'emprego | grupo/faixa/nível | portaria | unidade'."""
    if not MULTI_HEAD.search(chunk):
        return None
    tabela = re.search(r"(?i)emprego\s+p[úu]blico\s+grupo", chunk)
    if not tabela:
        return None
    pre = chunk[:tabela.start()]
    dest = re.search(
        r"(?i)redistribu[íi]d[oa]s?\s+.{0,200}?\s+para\s+(?:a\s+|o\s+|à\s+|ao\s+)?(?P<para>[^:.]+?)\s*(?::|\.|$)",
        pre,
    )
    if not dest:
        return None
    para = clean_unit(dest.group("para"))
    seg = re.split(r"(?i)artigo\s+2", chunk[tabela.end():])[0]
    itens = []
    for rm in MULTI_ROW.finditer(seg):
        unit = clean_unit(rm.group("unit"))
        if not unit:
            continue
        itens.append((rm.group("num"), rm.group("classe"), rm.group("letra"),
                      rm.group("grau"), unit))
    return (para, itens) if itens else None

REF_BEFORE = re.compile(
    r"(?i)(?:pela|pelo|pelas|pelos|da|do|das|dos|conforme|nos\s+termos\s+d[ao])\s+(?:a\s+|o\s+)?$"
)


def is_reference(text: str, start: int) -> bool:
    """Evita tratar 'pela Portaria GR 4215, de 25/05/2009' como cabeçalho."""
    return bool(REF_BEFORE.search(text[max(0, start - 45):start]))


def parse_classe(text: str):
    m = re.search(r"(?i)\b(b[áa]sico|t[ée]cnico|superior)\b", text)
    if not m:
        return "", "", ""
    classe = m.group(1).title()
    rest = text[m.end():]
    m2 = re.match(
        r"\s*(?:classe\s*)?[-–]?\s*(?P<letra>[a-z]{1,2}\d{0,2}|[ivx]{1,4}|\d{1,2})\b"
        r"\s*[-–]?\s*(?P<grau>[a-z])?\b",
        rest, re.I,
    )
    letra = (m2.group("letra") or "").upper() if m2 else ""
    grau = (m2.group("grau") or "").upper() if m2 and m2.group("grau") else ""
    return classe, letra, grau


def clean_unit(raw: str) -> str:
    text = re.sub(r"\s+", " ", raw or "").strip(" ,.;:-–")
    text = re.sub(
        r"(?i)^(?:junto\s+)?(?:aos?|às?|à|ao|as?|nos?|nas?|na|no|de|da|do|das|dos|para\s+a|para\s+o)\s+",
        "", text,
    )
    text = re.sub(r"\s*\([A-Za-z]{1,8}\)\s*$", "", text)  # sigla entre parênteses
    return text.strip(" ,.;:-–")


def classify(ementa: str, body: str) -> str:
    """Classifica a portaria pelo que ela efetivamente faz (não só pela ementa)."""
    low = ementa.lower()
    if "prorroga" in low:
        return "outro"
    if "cargo" in low and "emprego" not in low:
        return "outro"
    if not re.search(r"(?i)empregos?\s+p[úu]blicos?", body):
        return "outro"
    # movimento com origem e destino explícitos
    if re.search(r"(?i)(?:redistribu|transfer)[íi]d[oa]s?\s+.{3,160}?\s+para\s+", body):
        if re.search(r"(?i)\btransfer", low) or re.search(r"(?i)\btransfer", body):
            return "transferencia"
        return "redistribuicao"
    # PROCONTES: muda o destinatário, não a unidade ("redistribuído conforme segue")
    if re.search(r"(?i)(?:redistribu|transfer)[íi]d[oa]s?\s+conforme\s+segue", body):
        return "destinacao"
    if "procontes" in body.lower() or "destina" in low:
        return "destinacao"
    if re.search(r"(?i)\bdistribu[íi]d[oa]s?\b", body) or "distribui" in low:
        return "distribuicao"
    return "outro"


def parse_page(text: str, meta: dict):
    """Devolve (portarias, diagnostico) de uma página do D.O.E."""
    portarias, notes = [], []
    if not text:
        return portarias, notes
    text = re.sub(r"\s+", " ", text).strip()
    # PDFs quebram palavras com hífen no fim da linha ("Facul- dade")
    text = re.sub(r"(?<=[a-zà-ú])-\s+(?=[a-zà-ú])", "", text)
    starts = [m for m in PORT_HEADER.finditer(text) if not is_reference(text, m.start())]
    if not starts:
        return portarias, ["sem cabeçalho de portaria"]

    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
        chunk = text[m.start():end]
        data = to_iso(m.group("data"), meta.get("date", ""))
        page_year = meta.get("year")
        if data and page_year and abs(int(data[:4]) - int(page_year)) > 1:
            continue  # citação a portaria de outro ano, não é cabeçalho
        rest = text[m.end():m.end() + 300]
        ementa = re.split(r"(?i)artigo\s+1", rest)[0].strip(" .;:-–")
        em = re.match(r"(?i)^[^.]{6,220}", ementa)
        ementa = (em.group(0) if em else ementa)[:220].strip()

        tipo = classify(ementa, chunk)
        if tipo == "outro" and not EMP_NUM.search(chunk):
            continue

        data = to_iso(m.group("data"), meta.get("date", ""))
        sigla = re.sub(r"\s+", " ", m.group("meta")).strip().upper() or "GR"
        port = {
            "sigla": sigla,
            "numero": re.sub(r"\.", "", m.group("num")),
            "data": data,
            "ano": int(data[:4]) if data else meta.get("year"),
            "ementa": ementa,
            "tipo": tipo,
            "url": meta.get("url"),
            "fonte": meta.get("kind"),
            "rows": [],
        }

        if tipo == "distribuicao":
            dm = DIST.search(chunk)
            if not dm:
                notes.append(f"{port['sigla']} {port['numero']}: distribuição sem padrão")
                continue
            unit_raw = clean_unit(dm.group("unit"))
            qtd_total = int(dm.group("qtd"))
            key, uname, campus = match_unit(unit_raw)
            seg = chunk[dm.end():]
            tabela = ROW.findall(seg)
            if not tabela:
                cls, letra, grau = parse_classe(chunk)
                tabela = [(cls, letra, grau, "", str(qtd_total))] if cls else []
            if not tabela:
                notes.append(f"{port['sigla']} {port['numero']}: sem classe/letra")
                continue
            soma = sum(int(t[4]) for t in tabela)
            if soma != qtd_total:
                notes.append(f"{port['sigla']} {port['numero']}: tabela {soma} != prosa {qtd_total}")
            for cls, letra, grau, cat, qtd in tabela:
                port["rows"].append({
                    "tipo": "distribuicao", "ano": port["ano"], "data": data,
                    "portaria": f"{port['sigla']} {port['numero']}".strip(),
                    "ementa": ementa, "url": port["url"], "fonte": port["fonte"],
                    "emprego": "", "classe": cls, "letra": letra.upper(), "grau": grau.upper(),
                    "qtd": int(qtd), "unidade": unit_raw, "unidadeKey": key, "campus": campus,
                    "de": "", "para": unit_raw, "deKey": None, "paraKey": key,
                    "categoria": re.sub(r"\s+", " ", cat).strip(" ,;") if cat else "",
                })
        elif tipo in ("redistribuicao", "transferencia"):
            multi = parse_multi_moves(chunk)
            if multi:
                para_raw, itens = multi
                para_key, para_name, campus = match_unit(para_raw)
                for num, cls, letra, grau, unidade in itens:
                    de_key, _, _ = match_unit(unidade)
                    port["rows"].append({
                        "tipo": "redistribuicao", "ano": port["ano"], "data": data,
                        "portaria": f"{port['sigla']} {port['numero']}".strip(),
                        "ementa": ementa, "url": port["url"], "fonte": port["fonte"],
                        "emprego": num, "classe": cls, "letra": letra, "grau": grau, "qtd": 1,
                        "unidade": unidade, "unidadeKey": de_key, "campus": campus,
                        "de": unidade, "para": para_raw, "deKey": de_key, "paraKey": para_key,
                    })
                portarias.append(port)
                continue
            em = EMP_NUM.search(chunk)
            num = em.group(1) if em else ""
            pos = em.end() if em else 0
            if not em:
                em2 = re.search(r"(?i)emprego\s+p[úu]blico", chunk)
                pos = em2.end() if em2 else 0
            cls_txt = re.match(r"\s*,?\s*([^,.;]{0,50})", chunk[pos:pos + 70]) if pos else None
            classe, letra, grau = parse_classe(cls_txt.group(1) if cls_txt else "")
            mv = MOV.search(chunk)
            if mv:
                de_raw = clean_unit(mv.group("de"))
                para_raw = clean_unit(mv.group("para"))
            else:
                mv2 = re.search(
                    r"(?i)(?:redistribu|transfer)[íi]d[oa]s?\s+para\s+(?P<para>.+?)(?:\.|;|$)", chunk)
                if not mv2:
                    notes.append(f"{port['sigla']} {port['numero']}: sem origem/destino")
                    continue
                para_raw = clean_unit(mv2.group("para"))
                om = re.search(
                    r"(?i)distribu[íi]d[oa]s?\s+para\s+(?P<de>.+?)\s+pela\s+Portaria", chunk)
                de_raw = clean_unit(om.group("de")) if om else ""
            de_key, de_name, _ = match_unit(de_raw)
            para_key, para_name, campus = match_unit(para_raw)
            port["rows"].append({
                "tipo": "redistribuicao" if tipo == "redistribuicao" else "transferencia",
                "ano": port["ano"], "data": data,
                "portaria": f"{port['sigla']} {port['numero']}".strip(),
                "ementa": ementa, "url": port["url"], "fonte": port["fonte"],
                "emprego": num, "classe": classe, "letra": letra, "grau": grau, "qtd": 1,
                "unidade": para_raw, "unidadeKey": para_key, "campus": campus,
                "de": de_raw, "para": para_raw, "deKey": de_key, "paraKey": para_key,
            })
        elif tipo == "destinacao":
            # PROCONTES: o emprego não muda de unidade, muda de destinatário
            em = EMP_NUM.search(chunk)
            num = em.group(1) if em else ""
            cls_txt = chunk[em.end():em.end() + 70] if em else ""
            cm = re.match(r"\s*,?\s*([^,.;]{0,50})", cls_txt) if cls_txt else None
            classe, letra, grau = parse_classe(cm.group(1) if cm else "")
            um = re.search(
                r"(?i)(?:redistribu[íi]d[oa]|distribu[íi]d[oa])\s+(?:junto\s+)?(?:aos?|às?|à|ao|nos?|na|no)\s+"
                r"(?P<unit>.+?)(?:\s+pela\s+Portaria|\s*,\s*|\s*\.|$)", chunk,
            )
            unit_raw = clean_unit(um.group("unit")) if um else ""
            key, uname, campus = match_unit(unit_raw)
            alvo = re.search(r"(?i)(?:Docente responsável|Central Multiusuário)\s*(?:pela|:)?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^.]{2,80})", chunk)
            port["rows"].append({
                "tipo": "destinacao", "ano": port["ano"], "data": data,
                "portaria": f"{port['sigla']} {port['numero']}".strip(),
                "ementa": ementa, "url": port["url"], "fonte": port["fonte"],
                "emprego": num, "classe": classe, "letra": letra, "grau": grau, "qtd": 0,
                "unidade": unit_raw, "unidadeKey": key, "campus": campus,
                "de": "", "para": unit_raw, "deKey": None, "paraKey": key,
                "destinatario": re.sub(r"\s+", " ", alvo.group(1)).strip() if alvo else "",
            })
        if port["rows"]:
            portarias.append(port)

    return portarias, notes


# ------------------------------------------------------------- livro-razão

def classe_key(classe: str) -> str:
    c = (classe or "").lower()
    if c.startswith("b"):
        return "bas"
    if c.startswith("t"):
        return "tec"
    if c.startswith("s"):
        return "sup"
    return "out"


def build_ledger(rows, years):
    dist = [r for r in rows if r["tipo"] == "distribuicao"]
    mov = [r for r in rows if r["tipo"] in ("redistribuicao", "transferencia")]

    # classe de cada emprego numerado (as redistribuições a informam)
    classe_por_emprego = {
        r["emprego"]: classe_key(r["classe"]) for r in mov if r.get("emprego") and r.get("classe")
    }

    stock = defaultdict(lambda: defaultdict(int))
    negative, orphan, sem_classe = [], 0, 0
    total_dist = 0
    por_ano = defaultdict(lambda: {"distribuicao": 0, "redistribuicao": 0})

    def apply(row):
        nonlocal total_dist, orphan, sem_classe
        if row["tipo"] == "distribuicao":
            if not row.get("paraKey"):
                return
            stock[row["paraKey"]][classe_key(row["classe"])] += row["qtd"]
            total_dist += row["qtd"]
            por_ano[row["ano"]]["distribuicao"] += row["qtd"]
            return
        ck = classe_key(row["classe"])
        if ck == "out" and row.get("emprego"):
            ck = classe_por_emprego.get(row["emprego"], "out")
        if ck == "out":
            sem_classe += 1
            return
        if not row.get("deKey") or not row.get("paraKey"):
            orphan += 1
            return
        stock[row["deKey"]][ck] -= 1
        if stock[row["deKey"]][ck] < 0:
            negative.append(f"{row['data']} {row['portaria']} {row['emprego']} ({row['de']})")
        stock[row["paraKey"]][ck] += 1
        por_ano[row["ano"]]["redistribuicao"] += 1

    eventos = [(r.get("data") or "", 0 if r["tipo"] == "distribuicao" else 1,
                r.get("portaria") or "", r) for r in dist + mov]
    eventos.sort(key=lambda e: e[:3])

    series, idx = {}, 0
    for y in sorted(years):
        limite = f"{y:04d}-12-31"
        while idx < len(eventos) and eventos[idx][0] <= limite:
            apply(eventos[idx][3])
            idx += 1
        series[str(y)] = {k: sum(v.values()) for k, v in stock.items()}
    # eventos sem data (raros) entram até o último ano
    while idx < len(eventos):
        apply(eventos[idx][3])
        idx += 1
    if years:
        series[str(max(years))] = {k: sum(v.values()) for k, v in stock.items()}

    units = []
    for key, classes in stock.items():
        units.append({
            "key": key,
            "total": sum(classes.values()),
            "classes": {k: classes.get(k, 0) for k in ("bas", "tec", "sup", "out")},
        })
    units.sort(key=lambda u: -u["total"])

    return {
        "distribuidoTotal": total_dist,
        "estoqueTotal": sum(u["total"] for u in units),
        "unidades": len(units),
        "movimentos": len(mov),
        "series": {str(y): series.get(str(y), {}) for y in years},
        "porAno": {str(y): dict(v) for y, v in sorted(por_ano.items())},
        "unidadesDetalhe": units,
        "negativos": negative[:40],
        "negativosTotal": len(negative),
        "movimentosSemOrigem": orphan,
        "movimentosSemClasse": sem_classe,
    }


def measure_coverage(ledger):
    path = os.path.join(ROOT, "docs", "data", "tecnicos.json")
    if not os.path.exists(path):
        return {"erro": "docs/data/tecnicos.json ausente"}
    tec = json.load(open(path, encoding="utf-8"))
    year = str(max(int(y) for y in tec.get("years", ["2025"])))
    by_key = {u["key"]: u for u in ledger["unidadesDetalhe"]}
    linhas, sem_doe, fora = [], [], []
    soma_ledger = soma_efetivo = 0
    for unit in tec.get("units", []):
        sigla = unit["sigla"]
        serie = (tec.get("data", {}).get(sigla) or {}).get(year) or {}
        efetivo = sum(v for k, v in serie.items() if k in ("bas", "tec", "sup", "out"))
        got = by_key.get(sigla, {}).get("total", 0)
        if efetivo:
            soma_efetivo += efetivo
        soma_ledger += got
        linha = {
            "sigla": sigla, "nome": unit.get("name") or unit.get("sigla"),
            "campus": unit.get("campus"), "efetivo": efetivo, "empregos": got,
            "cobertura": round(got / efetivo * 100, 1) if efetivo else None,
        }
        linhas.append(linha)
        if got and not efetivo:
            fora.append(sigla)
        if efetivo and not got:
            sem_doe.append(sigla)
    linhas.sort(key=lambda l: -l["empregos"])
    return {
        "anoEfetivo": int(year),
        "fonte": tec.get("source"),
        "efetivoTotal": soma_efetivo,
        "empregosTotal": soma_ledger,
        "coberturaPct": round(soma_ledger / soma_efetivo * 100, 1) if soma_efetivo else None,
        "unidadesComEfetivoSemEmprego": sem_doe,
        "unidadesComEmpregoSemEfetivo": fora,
        "porUnidade": linhas,
    }


# -------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", nargs="+", type=int, default=list(range(2009, 2027)))
    ap.add_argument("--jobs", type=int, default=4, help="páginas em paralelo")
    ap.add_argument("--limit", type=int, default=0, help="máximo de páginas (0 = todas)")
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--offline", action="store_true", help="usa apenas o cache")
    ap.add_argument("--refresh", action="store_true", help="ignora o cache")
    ap.add_argument("--leginf", action="store_true", help="inclui o índice anual da Normas USP")
    ap.add_argument("--leginf-only", action="store_true", help="só a fonte Normas USP")
    args = ap.parse_args()

    os.makedirs(DOE, exist_ok=True)
    all_rows, portarias, pages, notes = [], [], [], []
    total_entries = total_with_link = 0

    for year in args.years:
        entries = []
        if not args.leginf_only:
            try:
                entries = collect(year)
            except Exception as exc:  # noqa: BLE001
                print(f"{year}: ERRO ao ler a página do DRH: {exc}")
        if args.leginf or args.leginf_only:
            try:
                got = collect_leginf(year)
                print(f"{year}: Normas USP -> {len(got)} portarias com 'emprego'")
                entries.extend(got)
            except Exception as exc:  # noqa: BLE001
                print(f"{year}: ERRO no índice da Normas USP: {exc}")
        if not entries:
            continue
        groups = group_pages(entries)
        with_link = sum(1 for e in entries if e.get("url"))
        total_entries += len(entries)
        total_with_link += with_link
        kinds = Counter(g["kind"] for g in groups.values())
        print(f"{year}: {len(entries)} entradas | {with_link} com link | "
              f"{len(groups)} páginas únicas {dict(kinds)}")
        if args.list_only:
            for g in list(groups.values())[:3]:
                print(f"   {g['kind']} {g['urls'][0][:110]}")
            continue

        todo = list(groups.values())
        if args.limit:
            todo = todo[: args.limit]

        results = []
        lock = threading.Lock()
        done = [0]

        def work(group):
            text, err = load_page(group, args.refresh, args.offline)
            with lock:
                done[0] += 1
                status = "ok " if not err else "ERRO"
                title = (group["titles"][0] if group["titles"] else "")[:60]
                print(f"  [{done[0]}/{len(todo)}] {status} {year} {group['kind']:3} {title}")
            return group, text, err

        if args.jobs > 1:
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
                results = list(pool.map(work, todo))
        else:
            results = [work(g) for g in todo]

        for group, text, err in results:
            page = {
                "ano": year, "kind": group["kind"], "url": group["urls"][0],
                "ok": not err, "erro": err, "chars": len(text),
                "portarias": 0, "linhas": 0,
            }
            if err:
                pages.append(page)
                notes.append(f"{year} {group['urls'][0][:100]}: {err}")
                continue
            got, page_notes = parse_page(text, {
                "year": year, "url": group["urls"][0], "kind": group["kind"],
                "date": group["entries"][0].get("date", "") if group["entries"] else "",
            })
            page["portarias"] = len(got)
            page["linhas"] = sum(len(p["rows"]) for p in got)
            pages.append(page)
            portarias.extend(got)
            for p in got:
                all_rows.extend(p["rows"])
            notes.extend(page_notes)

    if args.list_only:
        print(f"\ntotal: {total_entries} entradas | {total_with_link} com link")
        return

    # dedupe de portarias e linhas (retificações republicam a mesma portaria)
    seen_port, uniq_port = set(), []
    for p in portarias:
        key = (p["sigla"], p["numero"], p["data"])
        if key in seen_port:
            continue
        seen_port.add(key)
        uniq_port.append(p)

    seen_row, rows = set(), []
    for r in all_rows:
        key = (
            r["tipo"], r["data"], r["portaria"], r["emprego"], r["classe"],
            r["letra"], r["grau"], r["qtd"], r["paraKey"] or r["unidade"],
            r["deKey"] or r["de"],
        )
        if key in seen_row:
            continue
        seen_row.add(key)
        rows.append(r)

    rows.sort(key=lambda r: (r["data"] or "", r["portaria"]))
    ledger = build_ledger(rows, args.years)
    coverage = measure_coverage(ledger)

    sem_unidade = [r for r in rows if not r.get("paraKey") and r["tipo"] == "distribuicao"]
    top_sem = Counter(r["unidade"] for r in sem_unidade).most_common(15)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "years": args.years,
        "entries": total_entries,
        "entriesWithLink": total_with_link,
        "pages": len(pages),
        "pagesOk": sum(1 for p in pages if p["ok"]),
        "portarias": len(uniq_port),
        "rows": len(rows),
        "distribuicoes": sum(1 for r in rows if r["tipo"] == "distribuicao"),
        "redistribuicoes": sum(1 for r in rows if r["tipo"] != "distribuicao"),
        "empregosDistintos": len({r["emprego"] for r in rows if r["emprego"]}),
        "rowsSemUnidade": len(sem_unidade),
        "topUnidadesNaoCasadas": [{"unidade": u, "linhas": n} for u, n in top_sem],
        "diagnostico": notes[:400],
        "linhas": rows,
    }
    with open(os.path.join(DOE, "rows.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(DOE, "pages.json"), "w", encoding="utf-8") as fh:
        json.dump({"pages": pages}, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(DOE, "portarias.json"), "w", encoding="utf-8") as fh:
        json.dump({"portarias": uniq_port}, fh, ensure_ascii=False, indent=1)
    led = {
        "generatedAt": payload["generatedAt"],
        "years": args.years,
        "rows": len(rows),
        **ledger,
        "cobertura": coverage,
    }
    with open(os.path.join(DOE, "ledger.json"), "w", encoding="utf-8") as fh:
        json.dump(led, fh, ensure_ascii=False, indent=1)

    print()
    print(f"páginas: {payload['pagesOk']}/{len(pages)} ok")
    print(f"portarias: {len(uniq_port)} | linhas: {len(rows)} "
          f"(distribuições {payload['distribuicoes']}, redistribuições {payload['redistribuicoes']})")
    print(f"empregos distintos: {payload['empregosDistintos']}")
    print(f"estoque montado: {ledger['estoqueTotal']} empregos em {ledger['unidades']} unidades")
    if sem_unidade:
        print(f"linhas sem unidade casada: {len(sem_unidade)} — top: {top_sem[:5]}")
    if ledger["negativosTotal"]:
        print(f"avisos de estoque negativo: {ledger['negativosTotal']}")
    if coverage.get("coberturaPct"):
        print(f"cobertura vs efetivo {coverage['anoEfetivo']}: "
              f"{coverage['empregosTotal']}/{coverage['efetivoTotal']} = {coverage['coberturaPct']}%")
    print("gravado em", DOE)


if __name__ == "__main__":
    main()
