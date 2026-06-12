"""
pipeline/assemble_der.py
Gera data/der_precomputed.json a partir das planilhas em data/.

Todas as leituras usam openpyxl read_only=True, data_only=True.
Nenhum valor é hardcoded — apenas o fallback de FWD é mantido como
constante pois o dado vem do SGP/DER e não há arquivo separado.
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

F_ORCAMENTO   = os.path.join(BASE, "8398_e_8399.xlsm")
F_CONTRATOS   = os.path.join(BASE, "Contratos DOPSR1 por Regional.xlsx")
F_MALHA       = os.path.join(BASE, "Condição da malha 2025.xlsx")
F_IRI_FWD     = os.path.join(BASE, "IRI_e_FWD.xlsx")
F_MAPA        = os.path.join(BASE, "DER- Mapa municípios.xlsx")
F_TERRITORIAL = os.path.join(BASE, "Base territorial.xlsx")
F_OUTPUT      = os.path.join(BASE, "der_precomputed.json")

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
# SEÇÃO 1 — EXECUÇÃO FINANCEIRA (8398_tratada)
# -------------------------------------------------------
print("▶ Seção 1: Execução financeira…")

wb_orc = openpyxl.load_workbook(F_ORCAMENTO, read_only=True, data_only=True, keep_vba=True)
ws_trat = wb_orc["8398_tratada"]

rows_trat = list(ws_trat.iter_rows(values_only=True))
data_rows = [r for r in rows_trat[1:] if r[0] is not None]

# Colunas da aba 8398_tratada (0-based):
# 0=Ano, 1=Ação, 5=Meta_Física, 8=Município,
# 10=Orçamento_Atualizado, 12=Empenhado, 13=Liquidado, 14=Pago,
# 19=Subprograma_Piloto

kpis_liq  = 0.0
kpis_orc  = 0.0
kpis_emp  = 0.0
kpis_pago = 0.0

# Agregação por subprograma
sub_acc = defaultdict(lambda: {"liquidado": 0.0, "empenhado": 0.0, "orcamento": 0.0})
# Agregação por município (col 8)
mun_liq = defaultdict(float)

for r in data_rows:
    liq  = safe_float(r[13])
    orc  = safe_float(r[10])
    emp  = safe_float(r[12])
    pago = safe_float(r[14])
    sub  = str(r[19]).strip() if r[19] is not None else "NÃO CLASSIFICADO"
    mun  = str(r[8]).strip()  if r[8]  is not None else "INDEFINIDO"

    kpis_liq  += liq
    kpis_orc  += orc
    kpis_emp  += emp
    kpis_pago += pago

    sub_acc[sub]["liquidado"]  += liq
    sub_acc[sub]["empenhado"]  += emp
    sub_acc[sub]["orcamento"]  += orc

    mun_liq[mun] += liq

sem_rastr_pct = 0.0
if kpis_liq > 0 and "NÃO CLASSIFICADO" in sub_acc:
    sem_rastr_pct = sub_acc["NÃO CLASSIFICADO"]["liquidado"] / kpis_liq * 100

taxa_exec = (kpis_liq / kpis_orc * 100) if kpis_orc > 0 else 0.0

wb_orc.close()

print(f"   Liquidado total:   R$ {kpis_liq:,.0f}")
print(f"   Orçamento total:   R$ {kpis_orc:,.0f}")
print(f"   Taxa execução:     {taxa_exec:.1f}%")
print(f"   Sem rastreab.:     {sem_rastr_pct:.1f}%")
print(f"   Subprogramas:      {list(sub_acc.keys())}")

# -------------------------------------------------------
# SEÇÃO 2 — CONTRATOS POR REGIONAL
# -------------------------------------------------------
print("▶ Seção 2: Contratos por regional…")

wb_con = openpyxl.load_workbook(F_CONTRATOS, read_only=True, data_only=True)
ws_con = wb_con["Empenho por contrato"]

rows_con = list(ws_con.iter_rows(values_only=True))
data_con = [r for r in rows_con[1:] if r[0] is not None and str(r[0]).startswith("CO")]

# Colunas: 0=Contrato, 1=Empenhado, 2=Liquidado(R$), 3=Pago, 4=SR, 5=TIPO CONTRATO
reg_acc = defaultdict(lambda: {
    "liquidado": 0.0, "empenhado": 0.0, "pago": 0.0,
    "n_contratos": 0, "emergencial": 0, "tipos": set()
})

for r in data_con:
    sr   = norm_sr(r[4])
    tipo = str(r[5]).strip().upper() if r[5] else ""
    reg_acc[sr]["liquidado"]  += safe_float(r[2])
    reg_acc[sr]["empenhado"]  += safe_float(r[1])
    reg_acc[sr]["pago"]       += safe_float(r[3])
    reg_acc[sr]["n_contratos"] += 1
    reg_acc[sr]["tipos"].add(tipo)
    if "EMERGENCIAL" in tipo:
        reg_acc[sr]["emergencial"] += 1

wb_con.close()

for sr, v in sorted(reg_acc.items()):
    print(f"   {sr}: liq={v['liquidado']:,.0f} n={v['n_contratos']} emg={v['emergencial']}")

# -------------------------------------------------------
# SEÇÃO 3 — CONDIÇÃO DA MALHA
# -------------------------------------------------------
print("▶ Seção 3: Condição da malha…")

wb_mal = openpyxl.load_workbook(F_MALHA, read_only=True, data_only=True)
ws_mal = wb_mal["Malha (km)"]

rows_mal = list(ws_mal.iter_rows(values_only=True))
# Linha 0 = cabeçalho; dados de 1 em diante
# Colunas: 0=SR, 1=Ruim, 2=Péssimo, 3=Regular, 4=Boa, 5=Muito Boa, 6=Liquidado
malha_data = {}

for r in rows_mal[1:]:
    if r[0] is None:
        continue
    sr      = norm_sr(r[0])
    ruim    = safe_float(r[1])
    pessimo = safe_float(r[2])
    regular = safe_float(r[3])
    boa     = safe_float(r[4])
    muito_boa = safe_float(r[5])
    liq_sr  = safe_float(r[6])

    km_total = ruim + pessimo + regular + boa + muito_boa
    malha_data[sr] = {
        "km_ruim":      ruim,
        "km_pessimo":   pessimo,
        "km_regular":   regular,
        "km_boa":       boa,
        "km_muito_boa": muito_boa,
        "km_total":     round(km_total, 2),
        "pct_ruim_pessimo":  round((ruim + pessimo) / km_total * 100, 2) if km_total > 0 else 0,
        "pct_regular":       round(regular / km_total * 100, 2) if km_total > 0 else 0,
        "pct_bom_muito_bom": round((boa + muito_boa) / km_total * 100, 2) if km_total > 0 else 0,
        "liquidado_malha":   round(liq_sr, 2),
        "liquidado_por_km":  round(liq_sr / km_total, 2) if km_total > 0 else 0,
    }

wb_mal.close()

for sr, v in sorted(malha_data.items()):
    print(f"   {sr}: km_total={v['km_total']:.0f} pct_crit={v['pct_ruim_pessimo']:.1f}% lkm={v['liquidado_por_km']:,.0f}")

# -------------------------------------------------------
# SEÇÃO 4 — IRI e FWD
# -------------------------------------------------------
print("▶ Seção 4: IRI e FWD…")

wb_iri = openpyxl.load_workbook(F_IRI_FWD, read_only=True, data_only=True)

def parse_iri_fwd_sheet(ws):
    """
    Layout da aba:
      Linha 0: título
      Linha 1: cabeçalho — col0='Condição', cols 1-5 = nomes dos SRs
      Linhas 2-6: Ruim, Péssimo, Regular, Bom, Muito Bom (valores % por SR)
    Retorna dict: { sr_name: {ruim, pessimo, regular, bom, muito_bom} }
    """
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 7:
        return {}

    # Linha 1 = cabeçalhos das SRs
    header = rows[1]
    srs = [norm_sr(header[i]) for i in range(1, 6) if header[i] is not None]

    categorias = ["ruim", "pessimo", "regular", "bom", "muito_bom"]
    result = {sr: {} for sr in srs}

    for i, cat in enumerate(categorias):
        row = rows[2 + i]
        for j, sr in enumerate(srs):
            result[sr][cat] = round(safe_float(row[j + 1]), 2)

    return result


iri_data = parse_iri_fwd_sheet(wb_iri["IRI"])
fwd_data = parse_iri_fwd_sheet(wb_iri["FWD"])
wb_iri.close()

for sr in sorted(iri_data):
    d = iri_data[sr]
    pct_crit = d["ruim"] + d["pessimo"]
    print(f"   IRI {sr}: crítico={pct_crit:.1f}%")

# -------------------------------------------------------
# SEÇÃO 5 — MUNICÍPIOS (Mapa)
# -------------------------------------------------------
print("▶ Seção 5: Municípios do piloto…")

wb_map = openpyxl.load_workbook(F_MAPA, read_only=True, data_only=True)
ws_map = wb_map["Base mapa"]

rows_map = list(ws_map.iter_rows(values_only=True))
# Colunas: 0=Município, 2=Código IBGE, 3=IDH, 4=Relevância logística,
#          5=Categoria, 6=Latitude, 7=Longitude, 9=Regional DER, 10=Prioridade
mapa_data = []
mapa_by_code = {}  # código IBGE -> dict do município

for r in rows_map[1:]:
    if r[0] is None:
        continue
    codigo = safe_int(r[2])
    mun = {
        "nome":       str(r[0]).strip(),
        "codigo_ibge": codigo,
        "idh":        round(safe_float(r[3]), 3),
        "logistica":  str(r[4]).strip() if r[4] else "",
        "categoria":  str(r[5]).strip() if r[5] else "",
        "lat":        safe_float(r[6]),
        "lng":        safe_float(r[7]),
        "sr":         norm_sr(r[9]),
        "prioridade": str(r[10]).strip() if r[10] else "",
        # campos a enriquecer com base territorial
        "populacao":     0,
        "pib_per_capita": 0.0,
        "liquidado_8398": 0.0,
        "liquidado_por_hab": 0.0,
    }
    mapa_data.append(mun)
    if codigo:
        mapa_by_code[codigo] = mun

wb_map.close()
print(f"   Municípios lidos: {len(mapa_data)}")

# -------------------------------------------------------
# SEÇÃO 6 — BASE TERRITORIAL
# -------------------------------------------------------
print("▶ Seção 6: Base territorial…")

wb_ter = openpyxl.load_workbook(F_TERRITORIAL, read_only=True, data_only=True)
ws_ter = wb_ter["base_territorial_municipios"]

rows_ter = list(ws_ter.iter_rows(values_only=True))
# Colunas: 0=municipio_codigo, 1=municipio_nome, 8=liquidado_8398_R$,
#          10=populacao_2022, 13=idhm_2010, 14=pib_per_capita_2023_R$

for r in rows_ter[1:]:
    if r[0] is None:
        continue
    codigo = safe_int(r[0])
    mun = mapa_by_code.get(codigo)
    if mun is None:
        continue

    pop     = safe_int(r[10])
    liq8398 = safe_float(r[8])
    pib     = safe_float(r[14])

    mun["populacao"]      = pop
    mun["pib_per_capita"] = round(pib, 2)
    mun["liquidado_8398"] = round(liq8398, 2)
    mun["liquidado_por_hab"] = round(liq8398 / pop, 2) if pop > 0 else 0.0

wb_ter.close()

enriquecidos = sum(1 for m in mapa_data if m["populacao"] > 0)
print(f"   Municípios enriquecidos com base territorial: {enriquecidos}/{len(mapa_data)}")

# -------------------------------------------------------
# MONTAGEM DO JSON FINAL
# -------------------------------------------------------
print("▶ Montando JSON final…")

# Regionais: combinar dados de contratos, malha, IRI e FWD
todas_srs = sorted(set(
    list(reg_acc.keys()) +
    list(malha_data.keys()) +
    list(iri_data.keys())
))

regionais_json = {}
for sr in todas_srs:
    con = reg_acc.get(sr, {})
    mal = malha_data.get(sr, {})
    iri = iri_data.get(sr, {})
    fwd = fwd_data.get(sr, {})

    regionais_json[sr] = {
        # Dados financeiros (do arquivo de contratos)
        "liquidado":   round(con.get("liquidado", 0.0), 2),
        "empenhado":   round(con.get("empenhado", 0.0), 2),
        "n_contratos": con.get("n_contratos", 0),
        "emergencial": con.get("emergencial", 0),
        "tipos_contrato": sorted(con.get("tipos", set())),

        # Dados de malha (km)
        "km_ruim":      mal.get("km_ruim", 0),
        "km_pessimo":   mal.get("km_pessimo", 0),
        "km_regular":   mal.get("km_regular", 0),
        "km_boa":       mal.get("km_boa", 0),
        "km_muito_boa": mal.get("km_muito_boa", 0),
        "km_total":     mal.get("km_total", 0),
        "pct_ruim_pessimo":  mal.get("pct_ruim_pessimo", 0),
        "pct_regular":       mal.get("pct_regular", 0),
        "pct_bom_muito_bom": mal.get("pct_bom_muito_bom", 0),
        "liquidado_por_km":  mal.get("liquidado_por_km", 0),

        # IRI — % do total inspecionado
        "iri": iri if iri else {},

        # FWD — % do total inspecionado
        "fwd": fwd if fwd else {},
    }

# Subprogramas: converter defaultdict em dict normal, ordenando por liquidado
subprogramas_json = {}
for sub, vals in sorted(sub_acc.items(), key=lambda x: -x[1]["liquidado"]):
    subprogramas_json[sub] = {
        "liquidado":  round(vals["liquidado"], 2),
        "empenhado":  round(vals["empenhado"], 2),
        "orcamento":  round(vals["orcamento"], 2),
    }

output = {
    "generated": datetime.now().isoformat(timespec="seconds"),
    "kpis": {
        "liquidado_total":           round(kpis_liq, 0),
        "empenhado_total":           round(kpis_emp, 0),
        "orcamento_total":           round(kpis_orc, 0),
        "pago_total":                round(kpis_pago, 0),
        "taxa_execucao_pct":         round(taxa_exec, 1),
        "sem_rastreabilidade_pct":   round(sem_rastr_pct, 1),
        "classificado_subprograma_pct": round(100 - sem_rastr_pct, 1),
    },
    "subprogramas": subprogramas_json,
    "regionais":    regionais_json,
    "municipios":   mapa_data,
    "liquidado_por_municipio": {k: round(v, 2) for k, v in mun_liq.items()},
}

with open(F_OUTPUT, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print()
print("=" * 55)
print(f"✅ JSON gerado: {F_OUTPUT}")
print(f"   Liquidado total:  R$ {kpis_liq:>14,.0f}")
print(f"   Orçamento total:  R$ {kpis_orc:>14,.0f}")
print(f"   Taxa de execução: {taxa_exec:>10.1f}%")
print(f"   Sem rastreab.:    {sem_rastr_pct:>10.1f}%")
print(f"   Subprogramas:     {len(subprogramas_json)}")
print(f"   Regionais:        {len(regionais_json)}")
print(f"   Municípios:       {len(mapa_data)}")
print("=" * 55)
