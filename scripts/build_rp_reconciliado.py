"""
Converte data/Painel_DER_Empenho + RP.xlsx (abas Detalhe 2024, Detalhe 2025,
Resumo por Regional) em dashboard/data/rp_reconciliado.json.

A planilha ja e um reconciliado (nao dado bruto): cruza exercicio corrente
(Empenhos 2024 CGM.xlsx / Anexo_1_ContratosDOPSR1 por Regional editavel.xlsx)
com o total incluindo RP (Pagamentos com RPs 2024-2025.xlsx), por contrato.
Este script so extrai as abas ja calculadas e serializa em JSON, sem refazer
nenhum calculo de reconciliacao.

Uso: python scripts/build_rp_reconciliado.py
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = ROOT / "data" / "Painel_DER_Empenho + RP.xlsx"
OUT_PATH = ROOT / "dashboard" / "data" / "rp_reconciliado.json"

STATUS_MAP = {
    "Casado": "casado",
    "Só na planilha c/ RP": "so_rp",
    "Só na base (sem RP)": "so_base",
}


def to_float(v):
    return float(v) if v is not None else None


def read_detalhe(ws, ano):
    rows = []
    for row in ws.iter_rows(min_row=5, values_only=True):
        contrato, sr, tipo, exec_corr, total_rp, rp, pct, status_txt, obs = row
        if contrato is None or sr is None:
            # linhas de subtotal ("TOTAL - CONTRATOS CASADOS...") não têm SR
            continue
        status = STATUS_MAP.get(status_txt)
        if status is None:
            raise ValueError(f"Status inesperado em {ano}: {status_txt!r} (contrato {contrato})")
        rows.append({
            "contrato": contrato,
            "sr": sr,
            "tipo": tipo,
            "ano": ano,
            "exercicio_corrente": to_float(exec_corr),
            "total_com_rp": to_float(total_rp),
            "rp": to_float(rp),
            "status": status,
            "pct": (rp / total_rp) if (status == "casado" and total_rp) else None,
            "observacao": obs,
        })
    return rows


def read_resumo_regional(ws):
    out = []
    for row in ws.iter_rows(min_row=5, values_only=True):
        if row[0] is None:
            continue
        sr, ec24, tot24, rp24, pct24, ec25, tot25, rp25, pct25 = row
        out.append({
            "sr": sr,
            "2024": {"exercicio_corrente": to_float(ec24), "total_com_rp": to_float(tot24), "rp": to_float(rp24)},
            "2025": {"exercicio_corrente": to_float(ec25), "total_com_rp": to_float(tot25), "rp": to_float(rp25)},
        })
    return out


def main():
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)

    contratos = read_detalhe(wb["Detalhe 2024"], 2024) + read_detalhe(wb["Detalhe 2025"], 2025)
    regionais = read_resumo_regional(wb["Resumo por Regional"])

    n_casado = sum(1 for c in contratos if c["status"] == "casado")
    n_divergente = len(contratos) - n_casado

    out = {
        "_meta": {
            "descricao": "Composicao do liquidado total em exercicio corrente vs. RP/exercicio anterior, por contrato, regional (SR) e ano.",
            "gerado_em": datetime.now(timezone.utc).isoformat(),
            "gerado_por": "scripts/build_rp_reconciliado.py",
            "fonte_planilha": str(XLSX_PATH.relative_to(ROOT)).replace("\\", "/"),
            "fontes_originais": {
                "exercicio_corrente_2024": "Empenhos 2024 CGM.xlsx",
                "exercicio_corrente_2025": "Anexo_1_ContratosDOPSR1 por Regional editável.xlsx",
                "total_com_rp": "Pagamentos com RPs 2024-2025.xlsx (DER)",
            },
            "metodologia": (
                "RP e uma proxy calculada por diferenca: rp = total_com_rp - exercicio_corrente, "
                "apenas para contratos presentes nas duas bases (status='casado'). Nao ha, na fonte "
                "disponivel, uma classificacao direta de cada pagamento em RP vs. exercicio corrente - "
                "o valor e inferido pelo gap entre as duas planilhas."
            ),
            "avisos": [
                "rp e pct sao null para contratos com status != 'casado' - o valor de RP desses contratos "
                "nao pode ser calculado (falta um dos dois lados da reconciliacao) e NAO deve ser somado "
                "em nenhum agregado de %RP.",
                "status='so_rp': contrato so aparece na planilha com RP (Pagamentos com RPs 2024-2025.xlsx) - "
                "nao consta na base de exercicio corrente. Pode ser 100% RP ou um contrato ausente da base "
                "de exercicio corrente por outro motivo (encerramento, reclassificacao). Confirmar com o DER.",
                "status='so_base': contrato so aparece na base de exercicio corrente - nao consta na "
                "planilha com RP. Confirmar com o DER se e omissao da planilha ou se o contrato "
                "genuinamente nao tem RP.",
                "Contratos com status != 'casado' sao divergencias a validar com o DER, nao dado definitivo - "
                "devem ficar de fora de qualquer %RP agregado, mas aparecer listados para transparencia.",
            ],
            "contagem": {
                "total_linhas": len(contratos),
                "casado": n_casado,
                "divergente": n_divergente,
            },
        },
        "contratos": contratos,
        "regionais": regionais,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"OK: {len(contratos)} linhas de contrato ({n_casado} casado, {n_divergente} divergente)")
    print(f"Escrito em {OUT_PATH}")


if __name__ == "__main__":
    main()
