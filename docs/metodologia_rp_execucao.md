# RP / Exercício Anterior na aba Pressão e Execução

Este documento descreve a integração dos dados de RP (Restos a Pagar) ao painel, sua metodologia, avisos de qualidade de dado e as decisões de implementação que não são óbvias a partir do código. Complementa `metodologia_metricas_der.md`.

## Fonte e metodologia

Dados em `dashboard/data/rp_reconciliado.json`, por contrato × regional (SR) × ano, com os campos `exercicio_corrente`, `rp`, `total_com_rp`, `status`, `pct`. Gerado por `scripts/build_rp_reconciliado.py` a partir de três planilhas:

- `exercicio_corrente`: Empenhos 2024 CGM.xlsx (2024) / Anexo_1_ContratosDOPSR1 por Regional.xlsx (2025).
- `total_com_rp`: Pagamentos com RPs 2024-2025.xlsx (DER).
- `rp` é uma **proxy calculada por diferença**: `rp = total_com_rp - exercicio_corrente`, só para contratos presentes nas duas bases. Não há, na fonte disponível, uma classificação direta de cada pagamento em RP vs. exercício corrente — o valor é inferido pelo gap entre as duas planilhas.

`status` classifica cada linha, como veio da planilha (antes do painel processar):

- `casado`: contrato presente nas duas bases — único status com `rp`/`pct` calculável na fonte.
- `so_base`: só na base de exercício corrente — RP desconhecido, não confirmado como zero. Fica de fora do painel como está — ver "Contratos `so_base`" abaixo.
- `so_rp`: só na planilha com RP, sem linha correspondente em `contratos_dopsr1_por_ano`. O painel **insere** esses contratos em `contratosPorAno` como linhas sintéticas — ver "Contratos `so_rp`" abaixo. Depois dessa inserção, `statusRp === 'casado'` no painel não é mais sinônimo de "`status === 'casado'` na planilha".

**Regra de agregação**: `rp` e `pct` são `null` na planilha para status != `casado`. No painel, depois da inserção dos `so_rp` (que passam a ter `statusRp: 'casado'`), a regra de agregação vira simplesmente "soma só `statusRp === 'casado'`" — cobre tanto os `casado` originais quanto os `so_rp` inseridos, e exclui só os `so_base` (RP genuinamente desconhecido).

**Regra de composição**: `total_com_rp` é sempre o valor maior. RP é liquidação adicional (restos a pagar de exercícios anteriores, liquidados no ano corrente), nunca uma realocação de parte do que já existia. Em todo o painel, RP é **somado por cima** do exercício corrente — nunca subtraído dele para "caber" no total antigo.

## Onde aparece no painel

Tudo dentro da aba "Pressão e Execução" (`painel_der.html`), reagindo ao seletor global de ano `#filtroAnoMalha` / `appState.selectedFinancialYear` — nenhum elemento abaixo cria seletor de ano próprio.

| Elemento | Função/id | Nota |
|---|---|---|
| Join dos dados | `attachRpAContratos()`, index `rpIndex` por `contrato+sr+ano` | Só atribui campos novos aos objetos de `contratosPorAno`; nunca sobrescreve `c.liquidado`. |
| KPI "Total Liquidado" | `#kpi-cont-liq` / `#kpi-cont-liq-rp` | Mostra `totalLiqBase + totalRp`; sub-linha com RP absoluto e %. |
| KPI "Taxa de Execução" | `#kpi-cont-exec` | Usa `totalLiqBase` (sem RP) / Empenhado — ver "Taxa de Execução" abaixo. |
| Gráfico por SR | `chartContSR`, `renderExecChartAno()` / `renderExecChartCompare()` | Liquidado dividido em Exercício Corrente (`#2E75B6`) + RP (`#e87ba4`), empilhados. |
| Toggle "Ano selecionado / Comparar 2024×2025" | `#execModeToggle`, estado `execChartMode` | Escopado ao card do gráfico; no modo comparar, Empenhado/Pago somem e as barras usam `stack: ano`. |
| Tabela de contratos | `renderTblContratos()`, colunas `RP (R$)` / `% RP` | Ordenáveis; `rpStatusFlag()` marca linhas `so_base` (só) com `⚠` + title (sem popup). |
| Ranking de concentração | `renderRpRanking()`, canvas `chartRpRanking` | Top N por `%RP` (`statusRp === 'casado'`), toggle Top 10/Ver todos (`rpRankingMode`), filtros locais de SR/busca espelhando `#filtroContratoRegiao`/`#filtroContratoBusca`. Contratos `so_rp` (100% RP) aparecem no topo. |
| Tabela por regional | `renderRpPorRegional()`, `#tblRpPorRegional` | Uma linha por SR × ano (sempre os dois anos), reaproveita `filtrarContratosPorCriterios`. |

Não há mais seção de divergências no painel — ver "Contratos `so_rp`" e "Contratos `so_base`" abaixo.

## Contratos `so_rp`: inseridos como linhas sintéticas

O DER já conhece o motivo de cada contrato `so_rp` aparecer só na planilha de RP (reclassificação, encerramento, contrato antigo fora da base corrente) — a seção de confirmação de divergências que existia foi removida (decisão de produto, não um bug). Em vez de ficarem de fora dos agregados, `attachRpAContratos()` insere cada contrato `status === 'so_rp'` diretamente em `contratosPorAno[ano]` como uma linha normal:

```text
empenhado: 0, liquidado: 0, pago: 0
rp = totalComRp = total_com_rp da planilha (não há exercício corrente a subtrair)
statusRp: 'casado', pctRp: 1.0
```

A partir daí não são mais um caso especial: aparecem na tabela de contratos (Empenhado/Liquidado zerados, RP = valor cheio, sem `⚠`), entram nos KPIs e no gráfico por SR (contribuem 0 a Empenhado/Liquidado e o valor cheio a RP) e aparecem no topo do ranking de concentração (100% RP). Nenhum renderer tem tratamento particular para eles — se precisasse, seria sinal de que a inserção não ficou no formato certo.

Efeito na Taxa de Execução (`pctExec`): como Empenhado e Liquidado são ambos 0, esses contratos não alteram nem o numerador nem o denominador — SRs sem contratos `so_rp` não mudam, e SRs com eles continuam com a Taxa de Execução calculada só sobre os contratos que já tinham Empenhado/Liquidado reais.

## Contratos `so_base`: sem mudança

Continuam exatamente como antes: já contam normalmente no Liquidado/Empenhado (estão na base de exercício corrente), mas o RP é desconhecido e fica de fora de todo `%RP` agregado (KPIs, gráfico, ranking, tabela por regional). `rpStatusFlag()` continua marcando essas linhas com `⚠` na tabela de contratos.

## Regra central: soma, nunca subtração

Em todo cálculo que compõe Liquidado com RP, o exercício corrente permanece o valor original da base (`liquidado`/`totalLiqBase`), e RP é somado por cima:

```text
correnteBySR = liqBySR          // original, sem subtração
totalComRp   = correnteBySR + rpBySR   // sempre >= correnteBySR
```

Se o total empilhado (Corrente + RP) bater igual ao que o painel mostrava antes de o RP existir, é sinal de que RP está sendo subtraído em vez de somado — regressão a evitar.

## Taxa de Execução não inclui RP no numerador

`pctExec` (`#kpi-cont-exec`) usa **`totalLiqBase`**, não `totalLiq` (que inclui RP). RP é liquidação de empenho de **anos anteriores**, sem contrapartida no Empenhado do ano selecionado (`totalEmp`) — somar RP ao numerador sem ajustar o denominador infla artificialmente a taxa e pode mascarar o alerta de `pctExec < 70%` em casos de borda (chegou a ~9% de inflação em SR Leste/2024). O card "Total Liquidado" continua mostrando `totalLiq` (Corrente + RP); só a Taxa de Execução usa a base sem RP, com tooltip explicando a diferença.

## Paleta: desvio deliberado do protótipo

O protótipo de referência usava azul `#2a78d6` / laranja `#eb6834`. O painel real usa `#2E75B6` (azul já usado em `TIPO_COLORS.PROCONSERVA`) e `#e87ba4` (magenta) para RP — o laranja do protótipo batia ΔE 14,5 contra o vermelho já usado em `EMERGENCIAL` (`#C00000`), abaixo do piso de contraste (15). A rampa do ranking de concentração (`rpRankRamp`, `RP_RANK_RAMP_LIGHT`/`RP_RANK_RAMP_DARK`) e a mini-barra de composição (`splitBarHtml`) seguem o mesmo magenta, mantendo uma única linguagem de cor para RP em toda a aba.

## Notas operacionais (sessões futuras)

- Servir `painel_der.html` a partir da raiz do repo, não de `dashboard/` — os fetches de dados são root-relative.
- Ao encerrar servidores de teste, matar pelo PID específico do processo iniciado na sessão — nunca `taskkill /IM python.exe /T` ou equivalente amplo.
