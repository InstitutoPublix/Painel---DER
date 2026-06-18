# Migração Concluída — Remoção de 8398_e_8399.xlsm

> Concluído em: 2026-06-18  
> Status: **migração aplicada e arquivo-fonte removido**

---

## (a) O que foi migrado com sucesso

Todos os dados financeiros por SR agora vêm exclusivamente de
**`Contratos DOPSR1 por Regional.xlsx`** (FONTE CANÔNICA):

| Dado | Campo JSON | Fonte anterior |
|---|---|---|
| Liquidado por SR | `regionais[sr].liquidado` | 8398_e_8399 (via coluna Região) |
| Empenhado por SR | `regionais[sr].empenhado` | 8398_e_8399 |
| Nº de contratos | `regionais[sr].n_contratos` | 8398_e_8399 |
| Contratos emergenciais | `regionais[sr].emergencial` | 8398_e_8399 |
| Tipos de contrato (PROCONSERVA, COP, CREMEP…) | `regionais[sr].tipos_contrato` | 8398_e_8399 |

Continuam inalterados (nunca usaram 8398):

- Extensão e composição da malha (km) → `Condição da malha 2025.xlsx`
- Percentuais IRI e FWD por SR → `IRI_e_FWD.xlsx`
- Tabela de contratos `tblContratos` → `dados_extras.json` (contratos_dopsr1)

---

## (b) Elementos removidos do painel

Estes elementos dependiam de campos disponíveis somente na base 8398 e não
têm equivalente em Contratos DOPSR1. Foram removidos do HTML e do JS:

| Elemento removido | Motivo |
|---|---|
| `kpi-total` — "Total Liquidado Ação 8398" | R$ 2,65 bi ≠ escopo de Contratos (~R$ 869 mi) |
| `kpi-taxa` — "Taxa de Execução %" | Contratos não tem coluna de Orçamento/Dotação |
| `kpi-class` — "Classificado por Subprograma %" | Requer taxonomia Subprograma_Piloto com NÃO CLASSIFICADO |
| `kpi-semrastr` / `kpi-semrastr-sub` | Dependem do mesmo campo acima |
| `kpi-sint-total` — Liquidado total no card de síntese | Idem acima |
| `kpi-sint-semrastr` — % sem rastreabilidade | Idem acima |
| `kpi-sint-rast-reg` — "Rastreável por Regional %" | Denominador era o total de 8398 |
| `chartRastreabilidade` — funil de cascata | Usa classificadoPct, rastrPct, munIdentPct |
| `chartSub` + `tbodySub` — gráfico e tabela por subprograma | Subprograma_Piloto não existe em Contratos |
| `nota-metodologica` (Aba 2) | Texto citava % classificado e R$ sem rastreabilidade |
| `argblock1` — "Resposta à Pergunta Central do Piloto" | Narrativa usava kpis.* e semMunVal da base 8398 |
| `argblock-paradoxo` — bloco narrativo TCE-PR/política pública | Idem |
| Mapa de municípios (Leaflet) | liquidado_por_hab derivado de 8398; sem equivalente em Contratos |
| `cnt-nonnull` / `cnt-total-mun` / `nota-cobertura` | Contagens do mapa de municípios |

---

## (c) Divergência de valor total — nota para auditores

| Base | Liquidado Total | Escopo |
|---|---|---|
| `8398_e_8399.xlsm` (removida) | **R$ 2,65 bilhões** | Toda a Ação 8398 do orçamento público |
| `Contratos DOPSR1 por Regional.xlsx` | **~R$ 869 milhões** | Contratos DOPSR1 (~33% da Ação 8398) |

**Por que a diferença?**  
A base 8398 abrangia toda a Ação Orçamentária 8398 — incluindo categorias sem
correspondência contratual DOPSR1: `NÃO CLASSIFICADO` (R$ 1,49 bi sozinhos),
`FAIXA`, `OAEs/PONTES` e `PRORESTAURA`. Além disso, ~67% das linhas da base
8398 tinham `Município = "9999999"` e `Região = "4100"`, indicando ausência de
regionalização real — o campo "Região" nunca foi preenchido com a SR executora.

**O painel agora declara explicitamente** que avalia a eficiência alocativa
dos **Contratos DOPSR1 por SR** — um subconjunto auditável e regionalizado —
em vez de pretender cobrir a totalidade da Ação 8398.
