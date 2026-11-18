#!/usr/bin/env python3
"""
Léxico de unidades da USP usado para casar a prosa do D.O.E. com as siglas do
Anuário Estatístico (docs/data/tecnicos.json).

O D.O.E. escreve o nome por extenso; o Anuário usa siglas curtas. Cada unidade
tem um nome canônico (o mais frequente no D.O.E.), a sigla do Anuário e uma lista
de alias aceitos. O casamento é feito por contenção do nome normalizado dentro do
trecho extraído, preferindo o alias mais longo — isso resolve pares como
"Faculdade de Medicina" x "Faculdade de Medicina de Ribeirão Preto".
"""

from __future__ import annotations

import re
import unicodedata

# key = sigla do Anuário (docs/data/tecnicos.json)
UNITS = [
    ("ABCD", "Agência de Bibliotecas e Coleções Digitais", "São Paulo", ["Agência de Bibliotecas e Coleções Digitais", "Agência de Bibl Colec Digitais"]),
    ("AGUIA", "Agência USP de Gestão da Informação Acadêmica", "Órgãos centrais (RUSP)", ["Agência USP de Gestão da Informação Acadêmica", "AGUIA"]),
    ("CDCC", "Centro de Divulgação Científica e Cultural", "São Carlos", ["Centro de Divulgação Científica e Cultural"]),
    ("CEBIMar", "Centro de Biologia Marinha", "São Paulo", ["Centro de Biologia Marinha"]),
    ("CENA", "Centro de Energia Nuclear na Agricultura", "Piracicaba", ["Centro de Energia Nuclear na Agricultura"]),
    ("CEPEUSP", "Centro de Práticas Esportivas", "São Paulo", ["Centro de Práticas Esportivas"]),
    ("EACH", "Escola de Artes, Ciências e Humanidades", "São Paulo", ["Escola de Artes, Ciências e Humanidades"]),
    ("ECA", "Escola de Comunicações e Artes", "São Paulo", ["Escola de Comunicações e Artes"]),
    ("EDUSP", "Editora da Universidade de São Paulo", "São Paulo", ["Editora da Universidade de São Paulo", "Editora da USP", "Editora da Usp"]),
    ("EE", "Escola de Enfermagem", "São Paulo", ["Escola de Enfermagem"]),
    ("EEFE", "Escola de Educação Física e Esporte", "São Paulo", ["Escola de Educação Física e Esporte"]),
    ("EEFERP", "Escola de Educação Física e Esporte de Ribeirão Preto", "Ribeirão Preto", ["Escola de Educação Física e Esporte de Ribeirão Preto"]),
    ("EEL", "Escola de Engenharia de Lorena", "Lorena", ["Escola de Engenharia de Lorena"]),
    ("EERP", "Escola de Enfermagem de Ribeirão Preto", "Ribeirão Preto", ["Escola de Enfermagem de Ribeirão Preto"]),
    ("EESC", "Escola de Engenharia de São Carlos", "São Carlos", ["Escola de Engenharia de São Carlos"]),
    ("EP", "Escola Politécnica", "São Paulo", ["Escola Politécnica", "Escola de Politécnica"]),
    ("ESALQ", "Escola Superior de Agricultura Luiz de Queiroz", "Piracicaba", ["Escola Superior de Agricultura Luiz de Queiroz", "Escola Superior de Agricultura “Luiz de Queiroz”", "Escola Superior de Agricultura \"Luiz de Queiroz\""]),
    ("FAU", "Faculdade de Arquitetura e Urbanismo", "São Paulo", ["Faculdade de Arquitetura e Urbanismo"]),
    ("FCF", "Faculdade de Ciências Farmacêuticas", "São Paulo", ["Faculdade de Ciências Farmacêuticas"]),
    ("FCFRP", "Faculdade de Ciências Farmacêuticas de Ribeirão Preto", "Ribeirão Preto", ["Faculdade de Ciências Farmacêuticas de Ribeirão Preto"]),
    ("FD", "Faculdade de Direito", "São Paulo", ["Faculdade de Direito"]),
    ("FDRP", "Faculdade de Direito de Ribeirão Preto", "Ribeirão Preto", ["Faculdade de Direito de Ribeirão Preto"]),
    ("FE", "Faculdade de Educação", "São Paulo", ["Faculdade de Educação"]),
    ("FEA", "Faculdade de Economia, Administração, Contabilidade e Atuária", "São Paulo", ["Faculdade de Economia, Administração, Contabilidade e Atuária", "Faculdade de Economia, Administração e Contabilidade", "Faculdade de Economia e Administração"]),
    ("FEARP", "Faculdade de Economia, Administração e Contabilidade de Ribeirão Preto", "Ribeirão Preto", ["Faculdade de Economia, Administração e Contabilidade de Ribeirão Preto"]),
    ("FFCLRP", "Faculdade de Filosofia, Ciências e Letras de Ribeirão Preto", "Ribeirão Preto", ["Faculdade de Filosofia, Ciências e Letras de Ribeirão Preto"]),
    ("FFLCH", "Faculdade de Filosofia, Letras e Ciências Humanas", "São Paulo", ["Faculdade de Filosofia, Letras e Ciências Humanas"]),
    ("FM", "Faculdade de Medicina", "São Paulo", ["Faculdade de Medicina"]),
    ("FMBRU", "Faculdade de Medicina de Bauru", "Bauru", ["Faculdade de Medicina de Bauru"]),
    ("FMRP", "Faculdade de Medicina de Ribeirão Preto", "Ribeirão Preto", ["Faculdade de Medicina de Ribeirão Preto"]),
    ("FMVZ", "Faculdade de Medicina Veterinária e Zootecnia", "São Paulo", ["Faculdade de Medicina Veterinária e Zootecnia"]),
    ("FO", "Faculdade de Odontologia", "São Paulo", ["Faculdade de Odontologia"]),
    ("FOB", "Faculdade de Odontologia de Bauru", "Bauru", ["Faculdade de Odontologia de Bauru"]),
    ("FORP", "Faculdade de Odontologia de Ribeirão Preto", "Ribeirão Preto", ["Faculdade de Odontologia de Ribeirão Preto"]),
    ("FSP", "Faculdade de Saúde Pública", "São Paulo", ["Faculdade de Saúde Pública"]),
    ("FZEA", "Faculdade de Zootecnia e Engenharia de Alimentos", "Pirassununga", ["Faculdade de Zootecnia e Engenharia de Alimentos"]),
    ("HRAC", "Hospital de Reabilitação de Anomalias Craniofaciais", "Bauru", ["Hospital de Reabilitação de Anomalias Craniofaciais", "Hospital de Pesquisa e Reabilitação de Lesões Lábio-Palatais"]),
    ("HU", "Hospital Universitário", "São Paulo", ["Hospital Universitário"]),
    ("IAG", "Instituto de Astronomia, Geofísica e Ciências Atmosféricas", "São Paulo", ["Instituto de Astronomia, Geofísica e Ciências Atmosféricas"]),
    ("IAU", "Instituto de Arquitetura e Urbanismo", "São Carlos", ["Instituto de Arquitetura e Urbanismo"]),
    ("IB", "Instituto de Biociências", "São Paulo", ["Instituto de Biociências"]),
    ("ICB", "Instituto de Ciências Biomédicas", "São Paulo", ["Instituto de Ciências Biomédicas"]),
    ("ICMC", "Instituto de Ciências Matemáticas e de Computação", "São Carlos", ["Instituto de Ciências Matemáticas e de Computação", "Instituto de Ciências Matemáticas de São Carlos"]),
    ("IEA", "Instituto de Estudos Avançados", "São Paulo", ["Instituto de Estudos Avançados"]),
    ("IEB", "Instituto de Estudos Brasileiros", "São Paulo", ["Instituto de Estudos Brasileiros"]),
    ("IEE", "Instituto de Energia e Ambiente", "São Paulo", ["Instituto de Energia e Ambiente", "Instituto de Eletrotécnica e Energia"]),
    ("IF", "Instituto de Física", "São Paulo", ["Instituto de Física"]),
    ("IFSC", "Instituto de Física de São Carlos", "São Carlos", ["Instituto de Física de São Carlos"]),
    ("IGc", "Instituto de Geociências", "São Paulo", ["Instituto de Geociências"]),
    ("IME", "Instituto de Matemática e Estatística", "São Paulo", ["Instituto de Matemática e Estatística"]),
    ("IMT", "Instituto de Medicina Tropical", "São Paulo", ["Instituto de Medicina Tropical"]),
    ("IO", "Instituto Oceanográfico", "São Paulo", ["Instituto Oceanográfico"]),
    ("IP", "Instituto de Psicologia", "São Paulo", ["Instituto de Psicologia"]),
    ("IQ", "Instituto de Química", "São Paulo", ["Instituto de Química"]),
    ("IQSC", "Instituto de Química de São Carlos", "São Carlos", ["Instituto de Química de São Carlos"]),
    ("IRI", "Instituto de Relações Internacionais", "São Paulo", ["Instituto de Relações Internacionais"]),
    ("MAC", "Museu de Arte Contemporânea", "São Paulo", ["Museu de Arte Contemporânea"]),
    ("MAE", "Museu de Arqueologia e Etnologia", "São Paulo", ["Museu de Arqueologia e Etnologia"]),
    ("MP", "Museu Paulista", "São Paulo", ["Museu Paulista"]),
    ("MZ", "Museu de Zoologia", "São Paulo", ["Museu de Zoologia"]),
    ("PUSP-B", "Prefeitura do Campus de Bauru", "Bauru", ["Prefeitura do Campus de Bauru"]),
    ("PUSP-C", "Prefeitura do Campus da Capital", "Órgãos centrais (RUSP)", ["Prefeitura do Campus da Capital"]),
    ("PUSP-CB", "Prefeitura do Campus Capital - Butantã", "São Paulo", ["Prefeitura do Campus Capital - Butantã", "Prefeitura do Campus Capital-Butantã"]),
    ("PUSP-CL", "Prefeitura do Campus Capital - Leste", "São Paulo", ["Prefeitura do Campus Capital - Leste", "Prefeitura do Campus Capital-Leste"]),
    ("PUSP-FC", "Prefeitura do Campus Fernando Costa", "Pirassununga", ["Prefeitura do Campus Fernando Costa", "Prefeitura do Campus “Fernando Costa”"]),
    ("PUSP-L", "Prefeitura do Campus de Lorena", "Lorena", ["Prefeitura do Campus de Lorena"]),
    ("PUSP-LQ", "Prefeitura do Campus Luiz de Queiroz", "Piracicaba", ["Prefeitura do Campus Luiz de Queiroz", "Prefeitura do Campus “Luiz de Queiroz”"]),
    ("PUSP-QSD", "Prefeitura do Campus Quadrilátero Saúde/Direito", "São Paulo", ["Prefeitura do Campus Quadrilátero Saúde/Direito", "Prefeitura do Campus do Quadrilátero Saúde/Direito"]),
    ("PUSP-RP", "Prefeitura do Campus de Ribeirão Preto", "Ribeirão Preto", ["Prefeitura do Campus de Ribeirão Preto"]),
    ("PUSP-SC", "Prefeitura do Campus de São Carlos", "São Carlos", ["Prefeitura do Campus de São Carlos"]),
    ("RUSP", "Reitoria da Universidade de São Paulo", "Órgãos centrais (RUSP)", [
        "Reitoria da Universidade de São Paulo", "Reitoria",
        # órgãos da administração central (o Anuário agrega tudo em RUSP)
        "Pró-Reitoria de Inclusão e Pertencimento",
        "Pró-Reitoria de Pesquisa e Inovação",
        "Pró-Reitoria de Graduação",
        "Pró-Reitoria de Pós-Graduação",
        "Pró-Reitoria de Cultura e Extensão Universitária",
        "Coordenadoria de Administração Geral/Departamento de Administração",
        "Coordenadoria de Administração Geral/Departamento de Recursos Humanos",
        "Coordenadoria de Administração Geral/Escola USP de Gestão",
        "Coordenadoria de Administração Geral",
        "Banco de Reservas de Vagas",
        "Gabinete do Reitor",
        "Secretaria Geral",
        "Superintendência Jurídica",
        "Agência USP de Cooperação Acadêmica Nacional e Internacional",
    ]),
    ("SAS", "Superintendência de Assistência Social", "São Paulo", ["Superintendência de Assistência Social", "Coordenadoria de Assistência Social"]),
    ("SCS", "Superintendência de Comunicação Social", "São Paulo", ["Superintendência de Comunicação Social", "Coordenadoria de Comunicação Social"]),
    ("SEF", "Superintendência do Espaço Físico", "São Paulo", ["Superintendência do Espaço Físico", "Coordenadoria do Espaço Físico"]),
    ("SIBI", "Sistema Integrado de Bibliotecas", "Órgãos centrais (RUSP)", ["Sistema Integrado de Bibliotecas"]),
    ("STI", "Superintendência de Tecnologia da Informação", "São Paulo", ["Superintendência de Tecnologia da Informação", "Centro de Computação Eletrônica"]),
    ("SVOC", "Serviço de Verificação de Óbitos da Capital", "São Paulo", ["Serviço de Verificação de Óbitos da Capital"]),
    ("SVOI", "Serviço de Verificação de Óbitos do Interior", "Não identificado", ["Serviço de Verificação de Óbitos do Interior"]),
]


def norm(text: str) -> str:
    """Minúsculas, sem acento, sem pontuação de aspas/travessões, espaços simples."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"[“”\"'’‘`]", "", text)
    text = re.sub(r"[–—]", "-", text)
    text = re.sub(r"[^a-z0-9/.,\- ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip(" .,-")


_INDEX = []
for key, name, campus, aliases in UNITS:
    for alias in [name] + list(aliases):
        _INDEX.append((norm(alias), key, name, campus))
    _INDEX.append((norm(key), key, name, campus))
_INDEX.sort(key=lambda item: len(item[0]), reverse=True)


_STOP = {
    "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na",
    "nos", "nas", "para", "junto", "universidade", "sao", "paulo", "usp",
}


def match_unit(text: str):
    """Devolve (key, nome canônico, campus) ou (None, texto, None).

    Prefere o alias mais longo contido no trecho. O casamento é aceito quando o
    que sobra do trecho são apenas artigos/preposições (ex.: "junto à X") ou
    quando o alias cobre ao menos 55% do trecho.
    """
    if not text:
        return None, "", None
    span = norm(text)
    hay = " " + span + " "
    best = None
    for alias, key, name, campus in _INDEX:
        if len(alias) < 6:
            continue
        if re.search(r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])", hay):
            if best is None or len(alias) > len(best[0]):
                best = (alias, key, name, campus)
    if not best:
        return None, "", None
    alias, key, name, campus = best
    leftover = [t for t in span.replace(alias, " ").split() if t not in _STOP]
    if not leftover or len(alias) / max(len(span), 1) >= 0.55:
        return key, name, campus
    return None, "", None
