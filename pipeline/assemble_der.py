"""
pipeline/assemble_der.py
Gera data/der_precomputed.json a partir das planilhas em data/.

Todas as leituras usam openpyxl read_only=True, data_only=True.

Divisão de papéis das fontes:
  • Contratos DOPSR1 por Regional.xlsx  → FONTE CANÔNICA de qualquer dado
    financeiro por SR (liquidado, empenhado, n_contratos, emergenciais),
    com granularidade por SR + Ano (2024 e 2025).
    O campo "Região" na base 8398_e_8399 nunca teve regionalização real
    (~67% das linhas têm Município="9999999" e Região="4100"), por isso
    aquele arquivo foi removido do pipeline.
  • Condição da malha.xlsx              → extensão (km) e % por categoria de
    condição, por SR + Ano (abas "Malha (km)" e "Malha (%)", 5 categorias:
    Péssimo/Ruim/Regular/Boa/Ótima). A coluna "Valor Liquidado (R$)" dessa
    base é ignorada — liquidado vem sempre de Contratos DOPSR1 por Regional.xlsx.
    As abas "km" e "%" trazem a mesma condição agregada em 3 categorias
    (Ruim+Péssima / Regular / Boa+Ótima) — lidas à parte e guardadas em
    "malha_agregada_por_ano", sem sobrescrever "malha_por_ano" (5 categorias).
  • Dados Estatisticos por Área de Gestão (fator tráfego).xlsx →
    TMDA (Tráfego Médio Diário Anual) por SR, aba "Dados Gerais Resumo
    PorSR". Só há granularidade por SR (sem série por ano, sem lote/área) —
    gera o campo "tmda_por_sr" no JSON raiz. As abas "Dados Gerais Resumo
    Por Área" (por lote, cruzada com PIB per capita/IDHM/IPDM) não são
    lidas por este script — fora de escopo por ora.
"""

import io
import json
import os
import sys
from datetime import datetime
from collections import defaultdict

import openpyxl

# Garante UTF-8 no terminal Windows
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# -------------------------------------------------------
# CAMINHOS
# -------------------------------------------------------
BASE = os.path.join(os.path.dirname(__file__), "..", "data")

F_CONTRATOS   = os.path.join(BASE, "Contratos DOPSR1 por Regional.xlsx")
F_MALHA       = os.path.join(BASE, "Condição da malha.xlsx")
F_TRAFEGO     = os.path.join(BASE, "Dados Estatisticos por Área de Gestão (fator tráfego).xlsx")
F_PRECOMPUTED = os.path.join(BASE, "der_precomputed.json")
F_OUTPUT      = F_PRECOMPUTED
F_DEBUG_DUMP  = os.path.join(BASE, "der_malha_financeiro.json")
# NOTA: este script MESCLA seu resultado (financeiro + malha_por_ano por SR)
# dentro do "regionais" de data/der_precomputed.json já existente, preservando
# "kpis"/"subprogramas"/"municipios"/"liquidado_por_municipio" — seções que
# este script não sabe gerar (não foram recriadas desde a "troca de base de
# dados"; ver aviso no console se o arquivo de entrada não existir).
# Também grava uma cópia de depuração, só com o que este script gera, em
# der_malha_financeiro.json — não é mais lida pelo painel.

# -------------------------------------------------------
# NORMALIZAÇÕES
# -------------------------------------------------------

def norm_sr(raw: str) -> str:
    """Converte variações do nome de SR para o formato canônico 'SR Xxxx'."""
    if raw is None:
        return ""
    s = str(raw).strip().upper()
    mapping = {
        "SR LESTE":          "SR Leste",
        "LESTE":             "SR Leste",
        "SR CAMPOS GERAIS":  "SR Campos Gerais",
        "CAMPOS GERAIS":     "SR Campos Gerais",
        "CAMPOS GERAIS/NORTE": "SR Campos Gerais",
        "CAMPOS GERAIS SUL": "SR Campos Gerais",
        "SR NORTE":          "SR Norte",
        "NORTE":             "SR Norte",
        "SR NOROESTE":       "SR Noroeste",
        "NOROESTE":          "SR Noroeste",
        "SR OESTE":          "SR Oeste",
        "OESTE":             "SR Oeste",
        "OESTE/SUDOESTE":    "SR Oeste",
        "SR SUDOESTE":       "SR Oeste",
    }
    return mapping.get(s, raw.strip())


def safe_float(v, default=0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def safe_int(v, default=0) -> int:
    try:
        return int(float(v)) if v is not None else default
    except (TypeError, ValueError):
        return default


# -------------------------------------------------------
# SEÇÃO 1 — CONTRATOS POR REGIONAL (fonte canônica de dados financeiros por SR)
# -------------------------------------------------------
print("▶ Seção 1: Contratos por regional…")

wb_con = openpyxl.load_workbook(F_CONTRATOS, read_only=True, data_only=True)
ws_con = wb_con["Empenho por contrato"]

rows_con = list(ws_con.iter_rows(values_only=True))
# Colunas: 0=Ano, 1=SR, 2=TIPO CONTRATO, 3=Contrato, 4=Empenhado, 5=Liquidado(R$), 6=Pago
data_con = [r for r in rows_con[1:] if r[3] is not None and str(r[3]).startswith("CO")]

def _novo_acc():
    return {
        "liquidado": 0.0, "empenhado": 0.0, "pago": 0.0,
        "n_contratos": 0, "emergencial": 0, "tipos": set()
    }

reg_acc     = defaultdict(_novo_acc)   # chave: sr            (agregado, todos os anos)
reg_ano_acc = defaultdict(_novo_acc)   # chave: (sr, ano)
contratos_por_ano = defaultdict(list)  # chave: ano

for r in data_con:
    ano  = safe_int(r[0])
    sr   = norm_sr(r[1])
    tipo = str(r[2]).strip().upper() if r[2] else ""
    for acc in (reg_acc[sr], reg_ano_acc[(sr, ano)]):
        acc["liquidado"]   += safe_float(r[5])
        acc["empenhado"]   += safe_float(r[4])
        acc["pago"]        += safe_float(r[6])
        acc["n_contratos"] += 1
        acc["tipos"].add(tipo)
        if "EMERGENCIAL" in tipo:
            acc["emergencial"] += 1
    contratos_por_ano[str(ano)].append({
        "ano": str(ano),
        "contrato": str(r[3]).strip(),
        "empenhado": round(safe_float(r[4]), 2),
        "liquidado": round(safe_float(r[5]), 2),
        "pago": round(safe_float(r[6]), 2),
        "sr": sr,
        "tipo": tipo,
        "fonte": "Contratos DOPSR1 por Regional.xlsx",
    })

wb_con.close()

for sr, v in sorted(reg_acc.items()):
    print(f"   {sr}: liq={v['liquidado']:,.0f} n={v['n_contratos']} emg={v['emergencial']}")

for (sr, ano), v in sorted(reg_ano_acc.items()):
    print(f"   {sr} / {ano}: liq={v['liquidado']:,.0f} n={v['n_contratos']}")

# -------------------------------------------------------
# SEÇÃO 2 — CONDIÇÃO DA MALHA (por SR + Ano)
# -------------------------------------------------------
print("▶ Seção 2: Condição da malha…")

wb_mal = openpyxl.load_workbook(F_MALHA, read_only=True, data_only=True)

# Categorias de condição, na ordem em que aparecem nas abas "Malha (km)"/"Malha (%)"
CATEGORIAS_MALHA = ["Péssimo", "Ruim", "Regular", "Boa", "Ótima"]


def parse_malha_sheet(ws, label):
    """
    Lê uma aba de malha (colunas ANO, SR, Péssimo, Ruim, Regular, Boa, Ótima, ...).
    Retorna dict {(ano, sr): {categoria: valor}}.
    Se encontrar mais de uma linha para o mesmo (ano, sr), emite warning e
    mantém apenas a primeira ocorrência (não soma silenciosamente).
    Colunas extras (ex.: "Valor Liquidado (R$)") são ignoradas.
    """
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    col_idx = {str(h).strip(): i for i, h in enumerate(header) if h is not None}

    faltando = [c for c in CATEGORIAS_MALHA if c not in col_idx]
    if faltando:
        raise ValueError(f"Aba '{label}': colunas ausentes {faltando} (cabeçalho: {header})")

    resultado = {}
    for r in rows[1:]:
        if r[0] is None or r[1] is None:
            continue
        ano = safe_int(r[0])
        sr  = norm_sr(r[1])
        key = (ano, sr)

        if key in resultado:
            print(f"   ⚠️  AVISO: linha duplicada ANO+SR na aba '{label}': "
                  f"{ano} / {sr} — mantendo a primeira ocorrência, NÃO somando")
            continue

        resultado[key] = {cat: safe_float(r[col_idx[cat]]) for cat in CATEGORIAS_MALHA}

    return resultado


malha_km_raw = parse_malha_sheet(wb_mal["Malha (km)"], "Malha (km)")
malha_pct_raw = parse_malha_sheet(wb_mal["Malha (%)"], "Malha (%)")

print(f"   Malha (km): {len(malha_km_raw)} registros lidos (esperado: 5 SRs × 2 anos = 10)")
print(f"   Malha (%):  {len(malha_pct_raw)} registros lidos (esperado: 5 SRs × 2 anos = 10)")

# Abas "km"/"%" — mesma condição, já agregada em 3 categorias
# (Ruim + Péssima / Regular / Boa + Ótima), por SR + Ano.
CATEGORIAS_MALHA_AGREGADA = ["Ruim + Péssima", "Regular", "Boa + Ótima"]


def parse_malha_agregada_sheet(ws, label):
    """
    Lê uma aba de malha agregada (colunas ANO, SR, Ruim + Péssima, Regular,
    Boa + Ótima). Mesma normalização de parse_malha_sheet: SR em caixa alta
    via norm_sr(), linha duplicada ANO+SR gera warning e mantém a primeira
    ocorrência (não soma). Retorna dict {(ano, sr): {categoria: valor}}.
    """
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    col_idx = {str(h).strip(): i for i, h in enumerate(header) if h is not None}

    faltando = [c for c in CATEGORIAS_MALHA_AGREGADA if c not in col_idx]
    if faltando:
        raise ValueError(f"Aba '{label}': colunas ausentes {faltando} (cabeçalho: {header})")

    resultado = {}
    for r in rows[1:]:
        if r[0] is None or r[1] is None:
            continue
        ano = safe_int(r[0])
        sr  = norm_sr(r[1])
        key = (ano, sr)

        if key in resultado:
            print(f"   ⚠️  AVISO: linha duplicada ANO+SR na aba '{label}': "
                  f"{ano} / {sr} — mantendo a primeira ocorrência, NÃO somando")
            continue

        resultado[key] = {cat: safe_float(r[col_idx[cat]]) for cat in CATEGORIAS_MALHA_AGREGADA}

    return resultado


malha_agregada_km_raw = parse_malha_agregada_sheet(wb_mal["km"], "km")
malha_agregada_pct_raw = parse_malha_agregada_sheet(wb_mal["%"], "%")
wb_mal.close()

print(f"   km: {len(malha_agregada_km_raw)} registros lidos (esperado: 5 SRs × 2 anos = 10)")
print(f"   %:  {len(malha_agregada_pct_raw)} registros lidos (esperado: 5 SRs × 2 anos = 10)")

# Estrutura final por SR: malha_agregada_data[sr][ano] = {"km": {...}, "pct": {...}}
malha_agregada_data = defaultdict(dict)

todas_chaves_agregada = sorted(set(malha_agregada_km_raw.keys()) | set(malha_agregada_pct_raw.keys()))
for (ano, sr) in todas_chaves_agregada:
    km_cat  = malha_agregada_km_raw.get((ano, sr), {})
    pct_cat = malha_agregada_pct_raw.get((ano, sr), {})
    malha_agregada_data[sr][ano] = {
        "km": {
            "ruim_pessimo": km_cat.get("Ruim + Péssima", 0.0),
            "regular":      km_cat.get("Regular", 0.0),
            "bom_muito_bom": km_cat.get("Boa + Ótima", 0.0),
        },
        "pct": {
            "ruim_pessimo": pct_cat.get("Ruim + Péssima", 0.0),
            "regular":      pct_cat.get("Regular", 0.0),
            "bom_muito_bom": pct_cat.get("Boa + Ótima", 0.0),
        },
    }

malha_agregada_data = dict(malha_agregada_data)

# Estrutura final por SR: malha_data[sr]["por_ano"][ano] = {"km": {...}, "pct": {...}}
malha_data = defaultdict(lambda: {"por_ano": {}})

todas_chaves_malha = sorted(set(malha_km_raw.keys()) | set(malha_pct_raw.keys()))
for (ano, sr) in todas_chaves_malha:
    km_cat  = malha_km_raw.get((ano, sr), {})
    pct_cat = malha_pct_raw.get((ano, sr), {})

    km_total = sum(km_cat.values())
    km_ruim_pessimo = km_cat.get("Péssimo", 0.0) + km_cat.get("Ruim", 0.0)
    km_bom_muito_bom = km_cat.get("Boa", 0.0) + km_cat.get("Ótima", 0.0)

    # pct_* vêm já calculados na aba "Malha (%)" como fração 0–1 — não recalculados aqui.
    pct_ruim_pessimo  = pct_cat.get("Péssimo", 0.0) + pct_cat.get("Ruim", 0.0)
    pct_regular       = pct_cat.get("Regular", 0.0)
    pct_bom_muito_bom = pct_cat.get("Boa", 0.0) + pct_cat.get("Ótima", 0.0)

    malha_data[sr]["por_ano"][ano] = {
        "km": {
            "pessimo":    km_cat.get("Péssimo", 0.0),
            "ruim":       km_cat.get("Ruim", 0.0),
            "regular":    km_cat.get("Regular", 0.0),
            "boa":        km_cat.get("Boa", 0.0),
            "otima":      km_cat.get("Ótima", 0.0),
            "total":      round(km_total, 2),
            "ruim_pessimo":   round(km_ruim_pessimo, 2),
            "bom_muito_bom":  round(km_bom_muito_bom, 2),
        },
        "pct": {
            "pessimo": pct_cat.get("Péssimo", 0.0),
            "ruim":    pct_cat.get("Ruim", 0.0),
            "regular": pct_cat.get("Regular", 0.0),
            "boa":     pct_cat.get("Boa", 0.0),
            "otima":   pct_cat.get("Ótima", 0.0),
            "ruim_pessimo":  round(pct_ruim_pessimo, 6),
            "bom_muito_bom": round(pct_bom_muito_bom, 6),
        },
    }

malha_data = dict(malha_data)

for sr in sorted(malha_data):
    for ano in sorted(malha_data[sr]["por_ano"]):
        d = malha_data[sr]["por_ano"][ano]
        print(f"   {sr} / {ano}: km_total={d['km']['total']:.0f} "
              f"pct_bom_muito_bom={d['pct']['bom_muito_bom']*100:.1f}%")

# -------------------------------------------------------
# SEÇÃO 3 — TMDA / FATOR DE TRÁFEGO (por SR, sem série por ano)
# -------------------------------------------------------
print("▶ Seção 3: TMDA (fator de tráfego) por SR…")

wb_traf = openpyxl.load_workbook(F_TRAFEGO, read_only=True, data_only=True)
ws_traf = wb_traf["Dados Gerais Resumo PorSR"]

# Colunas: 0=SR (nº 1-5), 1=Sup. Regional (nome curto, ex. "Leste"),
# 2=Áreas, 3=Ext. (km), 4=Fator de Tráfego / Média TMDA.
# Linhas de título/cabeçalho/total são descartadas filtrando por SR numérico
# (coluna 0 é int só nas 5 linhas de dado; título e total têm None/str ali).
rows_traf = list(ws_traf.iter_rows(values_only=True))
data_traf = [r for r in rows_traf if isinstance(r[0], (int, float)) and r[1] is not None and r[4] is not None]

tmda_por_sr = {}
for r in data_traf:
    sr = norm_sr(r[1])
    tmda_por_sr[sr] = safe_int(r[4])

wb_traf.close()

print(f"   TMDA: {len(tmda_por_sr)} SRs lidas (esperado: 5)")
for sr, v in sorted(tmda_por_sr.items()):
    print(f"   {sr}: TMDA médio = {v} veíc/dia")

# -------------------------------------------------------
# MONTAGEM DO JSON FINAL
# -------------------------------------------------------
print("▶ Montando JSON final…")

todas_srs = sorted(set(
    list(reg_acc.keys()) +
    list(malha_data.keys())
))

# Ano mais recente disponível na base de malha — usado para preencher os
# campos "achatados" (km_*, pct_*, liquidado_por_km) mantidos por
# compatibilidade com KPIs que ainda não são sensíveis a ano.
todos_anos_malha = sorted({ano for sr in malha_data for ano in malha_data[sr]["por_ano"]})
ano_referencia = todos_anos_malha[-1] if todos_anos_malha else None

regionais_json = {}
for sr in todas_srs:
    con = reg_acc.get(sr, {})
    mal = malha_data.get(sr, {"por_ano": {}})

    malha_por_ano_json = {}
    for ano, d in sorted(mal["por_ano"].items()):
        fin_ano = reg_ano_acc.get((sr, ano), {})
        km = d["km"]
        pct = d["pct"]
        malha_por_ano_json[str(ano)] = {
            "km": {
                "pessimo": km["pessimo"], "ruim": km["ruim"], "regular": km["regular"],
                "boa": km["boa"], "otima": km["otima"],
                "total": km["total"],
                "ruim_pessimo": km["ruim_pessimo"], "bom_muito_bom": km["bom_muito_bom"],
            },
            "pct": {
                "pessimo": pct["pessimo"], "ruim": pct["ruim"], "regular": pct["regular"],
                "boa": pct["boa"], "otima": pct["otima"],
                "ruim_pessimo": pct["ruim_pessimo"], "bom_muito_bom": pct["bom_muito_bom"],
            },
            # Liquidado do mesmo ano — fonte: Contratos DOPSR1 por Regional.xlsx
            # (nunca da coluna "Valor Liquidado (R$)" da base de malha)
            "liquidado": round(fin_ano.get("liquidado", 0.0), 2),
            "empenhado": round(fin_ano.get("empenhado", 0.0), 2),
            "pago": round(fin_ano.get("pago", 0.0), 2),
            "n_contratos": fin_ano.get("n_contratos", 0),
            "emergencial": fin_ano.get("emergencial", 0),
            "tipos_contrato": sorted(fin_ano.get("tipos", set())),
            "liquidado_por_km": round(fin_ano.get("liquidado", 0.0) / km["total"], 2) if km["total"] > 0 else 0,
            "financial": {
                "year": str(ano),
                "source": "Contratos DOPSR1 por Regional.xlsx",
                "empenhado": round(fin_ano.get("empenhado", 0.0), 2),
                "liquidado": round(fin_ano.get("liquidado", 0.0), 2),
                "pago": round(fin_ano.get("pago", 0.0), 2),
            },
            "contracts": {
                "year": str(ano),
                "source": "Contratos DOPSR1 por Regional.xlsx",
                "n_contratos": fin_ano.get("n_contratos", 0),
                "tipos_contrato": sorted(fin_ano.get("tipos", set())),
            },
            "emergencyContracts": {
                "year": str(ano),
                "source": "Contratos DOPSR1 por Regional.xlsx",
                "n_contratos": fin_ano.get("emergencial", 0),
            },
            "metadata": {
                "condition_year": str(ano),
                "financial_year": str(ano),
                "contracts_year": str(ano),
                "condition_source": "Condição da malha.xlsx",
                "financial_source": "Contratos DOPSR1 por Regional.xlsx",
                "compatible": bool(fin_ano),
            },
        }

    mal_ref = mal["por_ano"].get(ano_referencia, {})
    km_ref  = mal_ref.get("km", {})
    pct_ref = mal_ref.get("pct", {})
    fin_ref = reg_ano_acc.get((sr, ano_referencia), {})

    # Malha agregada em 3 categorias (abas "km"/"%") — série própria por ano,
    # não sobrescreve malha_por_ano (5 categorias, abas "Malha (km)"/"Malha (%)").
    malha_agregada_por_ano_json = {
        str(ano): dados
        for ano, dados in sorted(malha_agregada_data.get(sr, {}).items())
    }

    regionais_json[sr] = {
        # Dados financeiros agregados (fonte: Contratos DOPSR1 por Regional.xlsx, todos os anos)
        "liquidado":   round(con.get("liquidado", 0.0), 2),
        "empenhado":   round(con.get("empenhado", 0.0), 2),
        "n_contratos": con.get("n_contratos", 0),
        "emergencial": con.get("emergencial", 0),
        "tipos_contrato": sorted(con.get("tipos", set())),

        # Dados de malha (km/%) do ano de referência mais recente — mantidos
        # "achatados" por compatibilidade. Fonte: Condição da malha.xlsx.
        # Para série completa por ano, ver "malha_por_ano" abaixo.
        "ano_referencia_malha": ano_referencia,
        "km_ruim":      km_ref.get("ruim", 0),
        "km_pessimo":   km_ref.get("pessimo", 0),
        "km_regular":   km_ref.get("regular", 0),
        "km_boa":       km_ref.get("boa", 0),
        "km_muito_boa": km_ref.get("otima", 0),
        "km_total":     km_ref.get("total", 0),
        "pct_ruim_pessimo":  round(pct_ref.get("ruim_pessimo", 0) * 100, 2),
        "pct_regular":       round(pct_ref.get("regular", 0) * 100, 2),
        "pct_bom_muito_bom": round(pct_ref.get("bom_muito_bom", 0) * 100, 2),
        "liquidado_por_km":  round(fin_ref.get("liquidado", 0.0) / km_ref["total"], 2) if km_ref.get("total", 0) > 0 else 0,

        # Série completa de malha por ano — {"2024": {...}, "2025": {...}}
        "malha_por_ano": malha_por_ano_json,

        # Mesma série, condição agregada em 3 categorias (Ruim+Péssima/Regular/
        # Boa+Ótima) — fonte: abas "km"/"%" de Condição da malha.xlsx.
        "malha_agregada_por_ano": malha_agregada_por_ano_json,
    }

# Cópia de depuração — só com o que este script gera (não lida pelo painel).
debug_dump = {
    "generated": datetime.now().isoformat(timespec="seconds"),
    "regionais": regionais_json,
}
with open(F_DEBUG_DUMP, "w", encoding="utf-8") as f:
    json.dump(debug_dump, f, ensure_ascii=False, indent=2)

# ── Mescla em data/der_precomputed.json, preservando kpis/subprogramas/ ──
# ── municipios/liquidado_por_municipio, que este script não gera. ──────
if os.path.exists(F_PRECOMPUTED):
    with open(F_PRECOMPUTED, encoding="utf-8") as f:
        precomputed = json.load(f)
else:
    print(f"⚠️  AVISO: {F_PRECOMPUTED} não existe — criando do zero. "
          f"Seções kpis/subprogramas/municipios/liquidado_por_municipio "
          f"ficarão ausentes (este script não sabe gerá-las).")
    precomputed = {}

secoes_preexistentes = {k: v for k, v in precomputed.items()
                         if k not in ("generated", "regionais")}
faltando = [k for k in ("kpis", "subprogramas", "municipios", "liquidado_por_municipio")
            if k not in secoes_preexistentes]
if faltando:
    print(f"⚠️  AVISO: seções ausentes em {F_PRECOMPUTED}, não recriadas por este script: {faltando}")

precomputed_regionais = precomputed.get("regionais", {})
for sr, novo in regionais_json.items():
    # Substitui por completo a entrada da SR (ela já inclui todos os campos:
    # financeiro, malha por ano) — não faz merge campo a campo.
    precomputed_regionais[sr] = novo

output = {
    "generated": datetime.now().isoformat(timespec="seconds"),
    **secoes_preexistentes,
    "regionais": precomputed_regionais,
    "contratos_dopsr1_por_ano": {
        ano: contratos
        for ano, contratos in sorted(contratos_por_ano.items())
    },
    # Sempre regerado por este script (não preservado de secoes_preexistentes),
    # mesmo padrão de "regionais": substitui por completo a cada execução.
    "tmda_por_sr": tmda_por_sr,
}

with open(F_PRECOMPUTED, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

liq_total = sum(v["liquidado"] for v in regionais_json.values())

print()
print("=" * 55)
print(f"✅ JSON consolidado gerado: {F_PRECOMPUTED}")
print(f"   Seções preservadas: {sorted(secoes_preexistentes.keys())}")
print(f"   Liquidado total (Contratos DOPSR1): R$ {liq_total:>14,.0f}")
print(f"   Regionais atualizadas: {len(regionais_json)}")
print(f"   Cópia de depuração: {F_DEBUG_DUMP}")
print("=" * 55)
