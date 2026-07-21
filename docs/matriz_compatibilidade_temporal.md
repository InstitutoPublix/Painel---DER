# Matriz de compatibilidade temporal do Painel DER-PR

Regra geral: nenhum componente pode combinar condição SAM, financeiro ou contratos de anos diferentes sem declarar a incompatibilidade e marcar a métrica como não comparável. Quando houver dados no mesmo ano, a troca do seletor SAM atualiza condição, financeiro, contratos e emergenciais de forma conjunta.

| Componente | Fonte utilizada | Competência da condição | Competência financeira | Competência dos contratos | Atualiza pelo seletor SAM? | Regra |
|---|---|---:|---:|---:|---|---|
| KPIs de diagnóstico da malha | `data/der_precomputed.json` (`regionais[*].malha_por_ano`) | Ano SAM selecionado | Não usa | Não usa | Sim | Usa apenas condição e km do ano selecionado. |
| Gráficos de malha em km e percentual | `Condição da malha.xlsx` via `malha_por_ano` | Ano SAM selecionado | Não usa | Não usa | Sim | Não mistura dado financeiro. |
| Evolução da malha | `malha_por_ano` | Dois anos mais recentes disponíveis | Não usa | Não usa | Não depende do seletor | Se houver menos de dois anos, exibe estado informativo. |
| Mapa de rodovias por SR | `dashboard/data/rodovias_pr.geojson` + `malha_por_ano` | Ano SAM selecionado | Não usa | Não usa | Sim | Geometria fixa; cor/tooltip usam condição SAM selecionada. |
| TMDA x condição | `tmda_por_sr` + `malha_por_ano` | Ano SAM selecionado | Não usa | Não usa | Parcial | TMDA não tem série anual; é exibido como referência fixa. |
| Contratos DOPSR1 | `Contratos DOPSR1 por Regional.xlsx` via `contratos_dopsr1_por_ano` | Não usa | Ano financeiro selecionado | Ano financeiro selecionado | Sim, se existir o mesmo ano | Tabela, KPIs e gráficos mostram o ano dos contratos. |
| Leitura integrada por regional | `malha_por_ano` + financeiro por SR/ano | Ano SAM selecionado | Mesmo ano, quando disponível | Mesmo ano, quando disponível | Sim | Se os anos divergirem, campos combinados viram “não comparável”. |
| Relação observada entre condição favorável e liquidado | `malha_por_ano.financial` | Ano SAM selecionado | Mesmo ano | Não usa diretamente | Sim | Relação descritiva bloqueada se condição e financeiro não forem compatíveis. Não mede desempenho, produtividade ou efeito do gasto. |
| Benchmark interno de custo/km | `malha_por_ano.financial` | Ano SAM selecionado | Mesmo ano | Não usa diretamente | Sim | Usa apenas liquidado/km do mesmo ano da malha. |
| Participação gasto x criticidade | `malha_por_ano.financial` | Ano SAM selecionado | Mesmo ano | Não usa diretamente | Sim | Índice desativado em caso de divergência temporal. |
| Quadrantes necessidade x investimento | `malha_por_ano.financial` | Ano SAM selecionado | Mesmo ano | Não usa diretamente | Sim | Métrica marcada como não comparável se os anos divergirem. |
| Sinalizador de Pressão de Conservação (SPC) | `malha_por_ano` + contratos/emergenciais por ano | Ano SAM selecionado | Referência do mesmo ano | Mesmo ano | Sim | Não combina emergenciais de 2025 com SAM 2024. |
| Benchmark nacional CNT | `dashboard/data/benchmark_nacional.json` | Série CNT própria | Não usa | Não usa | Não | Mantém controle anual próprio da CNT; não representa SAM/contratos DER. |

Estrutura central adotada no front-end:

```js
appState.datasets.regionalByYear[sr][year] = {
  condition: {},
  km: {},
  financial: {},
  contracts: {},
  emergencyContracts: {},
  metadata: {}
};
```

Função de guarda: `verificarCompatibilidadeTemporal(...)`. Métricas combinadas devem chamá-la antes de calcular ou renderizar resultados.
