# Auditoria de Migração — 8398_e_8399 → Contratos DOPSR1

> Gerado em: 2026-06-18  
> Status: **aguardando decisões de conteúdo antes de prosseguir**

---

## 1. Onde aparece a referência ao arquivo 8398_e_8399

| Arquivo | Linha(s) | O que faz |
|---|---|---|
| `pipeline/assemble_der.py` | 28, 83–129 | Seção 1: lê a aba `8398_tratada`; computa KPIs globais, subprogramas e liquidado por município |
| `data/der_precomputed.json` | saída do pipeline | Campos `kpis.*`, `subprogramas.*`, `liquidado_por_municipio` são todos derivados desta seção |
| `data/Base territorial.xlsx` | coluna 8 da aba `base_territorial_municipios` | Campo `liquidado_8398_R$` pré-computado nessa planilha — provavelmente derivado da mesma base; é lido independentemente pelo pipeline na Seção 6 |

**O restante do pipeline NÃO usa `8398_e_8399`:** a Seção 2 já lê `Contratos DOPSR1 por Regional.xlsx` (linha 142 do script), a Seção 3 lê `Condição da malha 2025.xlsx`, e as Seções 4–6 leem outros arquivos.

---

## 2. Gráficos, tabelas e KPIs alimentados por 8398_e_8399 hoje

### 2a. O que VEM da Seção 1 (8398_e_8399) e aparece no painel

#### Aba 1 — Síntese Executiva
| Elemento | Campo JSON | Pode migrar para Contratos? |
|---|---|---|
| `kpi-sint-total` — "Total Liquidado Ação 8398" | `kpis.liquidado_total` (R$ 2,65 bi) | ❌ Contratos = R$ 869,5 mi (escopo diferente) |
| `kpi-sint-semrastr` — "% Sem Rastreabilidade" | `kpis.sem_rastreabilidade_pct` | ❌ Requer coluna Subprograma_Piloto com "NÃO CLASSIFICADO" |
| `kpi-sint-rast-reg` — "Rastreável por Regional %" | `sum(regionais.liquidado) / kpis.liquidado_total` | ❌ Denominador vem de 8398; numerador vem de Contratos |
| `argblock1` — bloco narrativo completo | Usa `kpis.*`, `semMunVal`, `semMunPct` | ❌ Toda a narrativa de rastreabilidade depende dos campos acima |

#### Aba 2 — Execução Orçamentária
| Elemento | Campo JSON | Pode migrar para Contratos? |
|---|---|---|
| `kpi-total` — "Total Liquidado" | `kpis.liquidado_total` | ❌ Valores incompatíveis |
| `kpi-taxa` — "Taxa de Execução" | `kpis.taxa_execucao_pct` = Liquidado/Orçamento_Atualizado | ❌ Contratos **não tem coluna de Orçamento/Dotação** |
| `kpi-class` — "Classificado por Subprograma %" | `kpis.classificado_subprograma_pct` | ❌ Requer Subprograma_Piloto + NÃO CLASSIFICADO |
| `kpi-semrastr` + `kpi-semrastr-sub` | `kpis.sem_rastreabilidade_pct` | ❌ Mesmo acima |
| `chartRastreabilidade` — funil de cascata | `classificadoPct`, `rastrPct`, `munIdentPct` | ❌ Todos os três dependem de 8398 |
| `chartSub` — gráfico de barras por subprograma | `subprogramas.*` (liquidado, empenhado, taxa_exec) | ⚠️ Parcial (ver Seção 3 abaixo) |
| `tbodySub` — tabela por subprograma | `subprogramas.*` | ⚠️ Parcial (ver Seção 3 abaixo) |
| `nota-metodologica` | Texto que cita `classificado_pct`, `semRastrAbs`, R$ sem rastreabilidade | ❌ |

#### Aba 3 — Malha e Retorno (seção Eficiência)
| Elemento | Campo JSON | Pode migrar para Contratos? |
|---|---|---|
| `argblock1` (Resposta ao Piloto) | Usa `kpis.liquidado_total`, `sem_rastreabilidade_pct`, `semMunVal` | ❌ |
| `argblock-paradoxo` | Cita `k.sem_rastreabilidade_pct`, `semMunPct`, `semMunVal` | ❌ |
| Mapa de municípios (cor/tamanho) | `municipios[].liquidado_8398`, `liquidado_por_hab` | ⚠️ Vem de `Base territorial.xlsx` col 8 — depende de saber se essa coluna foi derivada de 8398 ou se tem fonte própria |

---

### 2b. O que JÁ VEM de Contratos DOPSR1 (Seção 2 do pipeline — não muda)

Estes elementos **não dependem de 8398_e_8399** e continuam funcionando após a remoção:

- `regionais[sr].liquidado / empenhado / n_contratos / emergencial / tipos_contrato`
- `kpi-cont-total`, `kpi-cont-emp`, `kpi-cont-liq`, `kpi-cont-exec`
- `chartContSR`, `chartContTipo`, `tbodyContratos`
- `tbodyReg` — tabela de eficiência por regional
- `scatter` — criticidade × gasto/km
- `chartROIKm`, `chartROICusto`, `chartCustoKm`
- `hl-grid` — highlight cards

---

## 3. Mapeamento Tipo Contrato → Subprograma Piloto

| Tipo Contrato (Contratos DOPSR1) | Subprograma Piloto (8398_tratada) | Status |
|---|---|---|
| PROCONSERVA | PROCONSERVA | ✅ Correspondência direta |
| COP | COP | ✅ Correspondência direta |
| INTEGRA | INTEGRA | ✅ Correspondência direta |
| CREMEP | — | ❓ **Sem correspondência — decisão necessária** |
| EMERGENCIAL | — | ❓ **Sem correspondência — decisão necessária** |

**Categorias que existem em 8398_tratada mas NÃO existem em Contratos DOPSR1:**
- `NÃO CLASSIFICADO` (representa 56,1% do liquidado de R$ 2,65 bi — a maior fatia)
- `FAIXA` (R$ 78,6 mi)
- `OAEs/PONTES` (R$ 21,7 mi)
- `PRORESTAURA` (R$ 991 mil)

---

## 4. Divergência de valor total entre as duas bases

| Base | Liquidado Total | Escopo |
|---|---|---|
| `8398_e_8399.xlsm` (aba 8398_tratada) | **R$ 2,65 bilhões** | Toda a Ação 8398 (orçamento público completo) |
| `Contratos DOPSR1 por Regional.xlsx` | **R$ 869,5 milhões** | Apenas contratos DOPSR1 (~33% do total da ação) |

Diferença: ~R$ 1,78 bilhão sem correspondência nos Contratos.

Os ~67% restantes na base 8398 incluem gastos classificados como "NÃO CLASSIFICADO" no Subprograma_Piloto (R$ 1,49 bi sozinhos) mais FAIXA, OAEs/PONTES e PRORESTAURA — categorias que simplesmente não existem como contratos DOPSR1.

---

## 5. Status do pipeline (assemble_der.py)

**O script já lê Contratos DOPSR1 por Regional.xlsx** (linha 142, Seção 2). Não há nada a atualizar nesse ponto — a leitura está completa e segue o padrão `read_only=True, data_only=True`.

O único ponto de mudança seria **remover a Seção 1** (linhas 82–129 + a variável `F_ORCAMENTO` na linha 28), mas isso eliminaria todos os campos marcados com ❌ na tabela acima.

---

## 6. Resumo executivo — três blocos

### (a) O que PODE ser migrado com sucesso
- Dados financeiros por SR: `liquidado`, `empenhado`, `n_contratos`, `emergencial` — **já estão sendo lidos de Contratos** (Seção 2 do pipeline)
- Gráficos de contratos (chartContSR, chartContTipo, tbodyContratos) — **já usam Contratos**
- Tabela de eficiência por regional — **já usa Contratos**
- Scatter criticidade × gasto — **já usa Contratos**
- KPIs de ROI (chartROIKm, chartROICusto, chartCustoKm) — **já usam Contratos** (via malha_km)

### (b) O que ficaria SEM FONTE DE DADOS após remoção de 8398_e_8399
| Elemento do painel | Motivo |
|---|---|
| `kpi-total` e `kpi-sint-total` (Total Liquidado R$ 2,65 bi) | Contratos cobre apenas ~33% do total da ação |
| `kpi-taxa` (Taxa de Execução %) | Contratos não tem coluna de Orçamento/Dotação |
| `kpi-class` / `kpi-semrastr` / `kpi-sint-semrastr` | Requerem taxonomia Subprograma_Piloto com NÃO CLASSIFICADO |
| `chartRastreabilidade` (funil de cascata) | Usa classificadoPct, rastrPct e munIdentPct, todos dependentes de 8398 |
| `chartSub` e `tbodySub` (gráfico + tabela por subprograma) | Subprograma_Piloto não existe em Contratos; Orçamento também ausente |
| `nota-metodologica` | Texto cita % classificado e R$ sem rastreabilidade |
| `argblock1` e `argblock-paradoxo` (narrativa do piloto) | Toda a seção usa KPIs de rastreabilidade de 8398 |
| Mapa de municípios (liquidado por município) | Sem coluna de Município em Contratos |
| `kpi-sint-rast-reg` ("Rastreável por Regional %") | Denominador é o total de 8398 |

### (c) Divergência de valor total
A base de Contratos DOPSR1 tem liquidado total de **~R$ 869,5 mi**, contra **R$ 2,65 bi** na base 8398. Substituir a fonte sem aviso mudaria silenciosamente todos os KPIs de headline por um fator de ~3×. **Nenhum valor foi alterado no painel aguardando confirmação.**

---

## 7. Decisões pendentes (para você responder)

**Questão A — CREMEP e EMERGENCIAL:**  
CREMEP e EMERGENCIAL aparecem em Contratos DOPSR1 mas não têm correspondência na taxonomia atual de Subprograma Piloto. Como você quer tratá-los se e quando o `chartSub`/`tbodySub` for alimentado por Contratos?

Opções possíveis (não limitadas a estas):
1. Criar categorias novas: CREMEP como categoria própria; EMERGENCIAL como categoria própria (mantém visibilidade do dado de emergenciais da SR Noroeste)
2. Agrupar CREMEP e EMERGENCIAL em "OUTROS / CORRETIVO"
3. Mostrar EMERGENCIAL como categoria própria e CREMEP dentro de PROCONSERVA (se fizer sentido técnico)
4. Deixar os dois fora do `chartSub` e mantê-los visíveis apenas na tabela de contratos e no `hl-grid`

**Questão B — O que fazer com os elementos sem fonte:**  
Para os 9 elementos listados em (b) que ficam sem fonte após a remoção de 8398_e_8399, você quer:
1. Remover esses elementos do painel completamente
2. Manter os elementos mas exibir um aviso "dado não disponível nesta versão"
3. Manter 8398_e_8399 apenas para alimentar esses elementos específicos (pipeline com duas fontes, como está hoje)
4. Substituir os KPIs globais pelos equivalentes de Contratos (R$ 869,5 mi em vez de R$ 2,65 bi) — **isso mudaria o escopo declarado do painel**

**Questão C — Base territorial:**  
A coluna `liquidado_8398_R$` em `Base territorial.xlsx` (que alimenta o mapa de municípios) — essa coluna foi derivada da base 8398 externamente à você, ou tem fonte própria? Se for derivada de 8398, o mapa de municípios também ficará sem dado após a remoção.
