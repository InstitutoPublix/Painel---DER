# Plano de Implementação - Painel DER-PR

Gerado em: 2026-07-20
Escopo desta etapa: inspeção inicial, sem alteração do painel.

## 1. Situação do Git

O `git status` foi executado primeiro no diretório aberto (`C:\Users\luiza\Downloads\Painel - DER`) e retornou que ali não havia repositório Git. O repositório real está em `C:\Users\luiza\Downloads\Painel - DER\Painel - DER`; nele o status inicial já estava sujo antes desta análise.

Arquivos versionados modificados antes desta etapa:

- `.chrome-cdp-line/component_crx_cache/metadata.json`
- `dashboard/data/rodovias_pr.geojson`
- `dashboard/painel_der.html`
- `data/Contratos DOPSR1 por Regional.xlsx`
- `data/dados_extras.json`
- `data/der_precomputed.json`
- `pipeline/assemble_der.py`
- `scripts/build_standalone_html.ps1`
- `scripts/fetch_rodovias_pr.py`

Há muitos arquivos não rastreados sob `.chrome-cdp-*`, além de `dashboard/assets/brasao parana.svg`, planilhas novas, `data/der_malha_financeiro.json` e `shot_map.png`. Esses artefatos parecem vir de execuções de browser/Playwright/CDP e deveriam ser avaliados para `.gitignore` antes de qualquer commit.

## 2. Arquitetura Atual

O painel é um HTML standalone único:

- Arquivo-fonte/canônico do painel: `dashboard/painel_der.html`.
- HTML standalone: o mesmo `dashboard/painel_der.html`.
- CSS próprio: embutido no próprio HTML, antes dos scripts vendor.
- JavaScript próprio: embutido no próprio HTML a partir da linha aproximada 1960, marcado como `painel.js` embutido.
- Vendor local: `dashboard/vendor/chart.umd.min.js`, `dashboard/vendor/chartjs-plugin-datalabels.min.js`, `dashboard/vendor/leaflet.js`, `dashboard/vendor/leaflet.css`.
- Vendor efetivamente carregado no standalone: Chart.js, datalabels e Leaflet estão embutidos no HTML.
- Dados embutidos: `window.STANDALONE_DATA` no próprio HTML, contendo `der_precomputed`, `dados_extras`, `benchmark_nacional` e `rodovias_pr`.
- Fallback não-standalone: se `window.STANDALONE_DATA` não existir, o JS tenta `fetch('../data/der_precomputed.json')`, `fetch('../data/dados_extras.json)`, `fetch('data/benchmark_nacional.json')` e `fetch('data/rodovias_pr.geojson')`.
- Mapa: Leaflet usa GeoJSON embutido/fallback e tiles externos OpenStreetMap.

Pipeline de dados documentado e confirmado:

```text
data/*.xlsx -> pipeline/assemble_der.py -> data/der_precomputed.json
                                      -> data/der_malha_financeiro.json (debug)

scripts/extract_benchmark_nacional.py -> dashboard/data/benchmark_nacional.json
scripts/fetch_rodovias_pr.py          -> dashboard/data/rodovias_pr.geojson

Atualização do window.STANDALONE_DATA em dashboard/painel_der.html: manual hoje.
```

## 3. Inventário de Arquivos

Arquivos principais:

- `dashboard/painel_der.html`: HTML final, CSS, JS, vendor embutido e dados embutidos.
- `pipeline/assemble_der.py`: transforma planilhas de contratos, condição da malha e tráfego em `der_precomputed.json`.
- `serve.py`: servidor HTTP opcional; também tenta gerar `der_precomputed.json` se ausente.

Scripts Python de extração/transformação:

- `pipeline/assemble_der.py`
- `scripts/extract_benchmark_nacional.py`
- `scripts/fetch_rodovias_pr.py`
- `scripts/_patch_dados_extras.py`

Scripts de teste/verificação:

- `scripts/_verify_browser.py`
- `scripts/_verify_benchmark.py`
- `scripts/_audit_status_filter.py`
- `scripts/_screenshot.py`
- `scripts/_screenshot_bench.py`
- `scripts/_test_aderencia.py`
- `scripts/_test_filter_position.py`
- `scripts/_test_legend_filter.py`
- `scripts/_test_malha_legend.py`
- `scripts/_test_malha_order.py`
- `scripts/_test_participacao.py`
- `scripts/_test_quadrantes.py`
- `scripts/_test_waffle.py`
- `scripts/_test_waffle2.py`

Arquivos JSON utilizados:

- `data/der_precomputed.json`: base consolidada principal.
- `data/dados_extras.json`: contratos detalhados e cópias legadas de malha.
- `data/der_malha_financeiro.json`: dump de depuração, não lido pelo painel segundo README.
- `data/raw_extracted.json`: extração bruta/legada.
- `dashboard/data/benchmark_nacional.json`: série CNT/SEFA.
- `dashboard/data/rodovias_pr.geojson`: geometria de rodovias PR.

Dados-fonte em planilhas/documentos:

- `data/Contratos DOPSR1 por Regional.xlsx`
- `data/Condição da malha.xlsx`
- `data/IRI_e_FWD.xlsx`
- `data/Dados Estatisticos por Área de Gestão (fator tráfego).xlsx`
- `data/INDICADORES SEFA_GERAL.xlsx`
- `data/Base territorial.xlsx`
- `data/Contratos OPR -VF.xlsx`
- `data/DER- Mapa municípios.xlsx`
- `data/DER- Base de dados explicada.docx`
- `data/Empenhos 2024 - CGM.xlsx`
- `data/Perfil territorial dos municípios.kmz`

Documentação existente:

- `README.md`
- `AUDITORIA_MIGRACAO.md`
- `data/MIGRACAO_CONCLUIDA.md`

## 4. HTML Standalone: Gerado ou Manual?

O standalone é mantido manualmente hoje.

Evidências:

- O README afirma que `dashboard/painel_der.html` é o único arquivo canônico e que o passo de embutir JSON em `window.STANDALONE_DATA` é manual/assistido.
- `scripts/deprecated/build_standalone.py` está marcado como descontinuado; ele esperava uma fonte com `dashboard/css/painel.css` e `dashboard/js/painel.js`, que não existe mais.
- `scripts/build_standalone_html.ps1` está marcado como quebrado/obsoleto e referencia `dashboard\css\painel.css` e `dashboard\js\painel.js`, inexistentes.
- Não há `package.json`, bundler ou script de build JS/CSS ativo.

Conclusão: `dashboard/painel_der.html` é simultaneamente fonte e artefato final, o que aumenta risco de regressão e torna diffs grandes/ruidosos.

## 5. Funções e Áreas Localizadas

Condição da malha:

- Pipeline: `parse_malha_sheet`, `parse_malha_agregada_sheet`, montagem de `malha_por_ano` e `malha_agregada_por_ano` em `pipeline/assemble_der.py`.
- Front-end: `buildMalhaForAno`, `anosDisponiveisMalha`, `renderMalha`, `renderEvolucaoMalha`, `renderMalhaExecKPIs`, `renderRegionalAlignmentCharts`, `renderTmdaCondicao`.

Troca do ano SAM:

- Estado: `anoSelecionadoMalha`.
- Funções: `setupMalhaPorAno`, `onAnoMalhaChange`, `buildMalhaForAno`, `updateMapaRodoviasAno`, `srPctBomPorAno`.

Liquidado por SR:

- Pipeline: seção Contratos por Regional em `assemble_der.py`, acumuladores `reg_acc` e `reg_ano_acc`.
- Front-end: `regionais`, `renderRelacaoRegional`, `renderScatter`, `renderContratos`, `renderAnalitica`, `renderSinteseExecutiva`.

Contratos e emergenciais:

- Pipeline: leitura de `Contratos DOPSR1 por Regional.xlsx`, contagem `n_contratos`, `emergencial`, `tipos_contrato`.
- Front-end: `contratos`, `SR_DISPLAY`, `TIPO_COLORS`, `contratoStatusText`, `getContratosFiltrados`, `renderContratos`, `renderSRTipoMatrix`, `renderTblContratos`, alerta Noroeste em `renderSinteseExecutiva`.

Percentual Ruim+Péssimo:

- Pipeline: `pct_ruim_pessimo` em `malha_por_ano` e campos achatados.
- Front-end: `buildMalhaForAno`, `renderFig6`, `renderScatter`, `renderParticipacaoCriticidade`, `calcularQuadrantesNecessidadeInvestimento`, `calcularSinalizadorPressaoConservacaoPainel`.

Percentual Bom+Muito Bom:

- Pipeline: `pct_bom_muito_bom` e `km.bom_muito_bom`.
- Front-end: `buildMalhaForAno`, `renderMalha`, `renderEvolucaoMalha`, `renderMalhaExecKPIs`, `renderSinteseExecutiva`, `srPctBomPorAno`, `updateMapaRodoviasAno`, `renderTmdaCondicao`.

Sinalizador de Pressão de Conservação:

- `calcularSinalizadorPressaoConservacao` em `dashboard/src/malha-analytics.js`
- `calcularSinalizadorPressaoConservacaoPainel`
- `renderSinalizadorPressaoConservacao`
- `renderMatrizRecomendacao` usa SPC, quadrantes e benchmark interno para gerar rótulos descritivos.

Relação condição/liquidado:

- `renderAnalitica` calcula `kmFavoravelPorMilhaoLiquidado` e `liquidadoPorKmFavoravel` como relações descritivas.
- `renderRegionalAlignmentCharts` renderiza liquidado por km.
- `renderRelacaoRegional` preenche tabela por SR.
- `renderScatter` cruza `% Ruim+Péssimo` com liquidado/km.
- `calcularBenchmarkInterno` e `renderBenchmarkInterno` classificam custo relativo.
- `calcularParticipacaoGastoVsCriticidade` e `renderParticipacaoCriticidade` medem participação do gasto versus criticidade.
- `calcularQuadrantesNecessidadeInvestimento` e `renderQuadrantesNecessidade` montam matriz de investigação.

Mapa Leaflet:

- `_loadLeaflet`
- `_initLeafletMap`
- `renderMapaRodovias`
- `_mapaRodColor`
- `srPctBomPorAno`
- `_mapaRodLegendHtml`
- `updateMapaRodoviasAno`
- Script gerador: `scripts/fetch_rodovias_pr.py`.

Geração do standalone:

- Obsoleto/quebrado: `scripts/build_standalone_html.ps1`.
- Descontinuado: `scripts/deprecated/build_standalone.py`.
- Fluxo atual: manual, editando `window.STANDALONE_DATA` dentro de `dashboard/painel_der.html`.

## 6. Comandos Atuais de Build e Testes

Dependências Python:

```bash
pip install -r requirements.txt
```

Pipeline principal:

```bash
python pipeline/assemble_der.py
```

Extrair benchmark nacional:

```bash
python scripts/extract_benchmark_nacional.py
```

Gerar GeoJSON de rodovias via Overpass:

```bash
python scripts/fetch_rodovias_pr.py
```

Servidor local opcional:

```bash
python serve.py
python serve.py 9090
```

Verificações Playwright existentes, executadas individualmente:

```bash
python scripts/_verify_browser.py
python scripts/_verify_benchmark.py
python scripts/_test_filter_position.py
python scripts/_test_legend_filter.py
python scripts/_test_malha_legend.py
python scripts/_test_malha_order.py
python scripts/_test_participacao.py
python scripts/_test_quadrantes.py
python scripts/_test_aderencia.py
```

Observação: os testes têm caminhos absolutos antigos (`C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html`), diferentes do workspace atual (`C:\Users\luiza\Downloads\Painel - DER\Painel - DER`). Antes de confiar neles, devem ser parametrizados para usar a raiz do repositório.

## 7. Riscos Encontrados

Riscos de arquitetura e build:

- HTML fonte e artefato final são o mesmo arquivo. Qualquer alteração de CSS/JS/dados vira diff massivo.
- Scripts de standalone existentes estão marcados como obsoletos/quebrados e referenciam arquivos removidos (`dashboard/css/painel.css`, `dashboard/js/painel.js`).
- Não existe comando único confiável para: pipeline -> JSONs -> sincronização do `window.STANDALONE_DATA` -> teste.
- `serve.py` pode regenerar `der_precomputed.json` se ausente, mas não sincroniza o HTML standalone.

Riscos de dados:

- `window.STANDALONE_DATA.der_precomputed` ainda preserva seções antigas `kpis`, `subprogramas`, `municipios`, `liquidado_por_municipio` relacionadas à base 8398, embora a documentação diga que elementos dependentes foram removidos.
- `window.STANDALONE_DATA.dados_extras` ainda inclui `malha_km` e `malha_pct` legados; a lógica atual usa `der_precomputed.regionais[*].malha_por_ano`. Isso cria duas fontes embutidas para conceitos parecidos.
- `dashboard/data/rodovias_pr.geojson` contém `pct_bom_muito_bom` estático por feature, mas o front atual ignora isso e recalcula cor por `regionaisRaw`. Pode confundir manutenção ou auditoria.
- `scripts/fetch_rodovias_pr.py` atribui SR por Voronoi usando sedes regionais; o próprio script marca isso como aproximação e pede validação SIG.
- `scripts/fetch_rodovias_pr.py` depende de rede/Overpass; `scripts/extract_benchmark_nacional.py` depende de planilha grande (`INDICADORES SEFA_GERAL.xlsx`, ~35 MB).

IDs inexistentes / código morto provável:

- `hdr-data-ref` é referenciado no JS, mas não existe no HTML atual.
- `sint-narrativa-ctx` é referenciado no JS, mas não existe no HTML atual.
- `kpi-sint2-sr-pressao` e `kpi-sint2-sr-pressao-sub` são referenciados, mas não existem no HTML atual.
- Há IDs detectados como não usados por `getElementById`; parte vem de Chart.js/vendor e abas acessadas por seletores, então precisa triagem manual antes de remover.

Hardcodes e textos frágeis:

- Ordem das SRs está hardcoded em vários pontos: `SR_ORDER`, `SR_ORDER_UP`, `SR_ORDER_EVOL`, `SR_ORDER_MAP`, arrays em `renderSRTipoMatrix`.
- Limiares de negócio hardcoded no JS: benchmark ±15%, participação 5 p.p., aderência 0.8/1.2, SPC 0.33/0.67, cores de mapa 30/50%.
- Textos de UI ainda fixam `Dados 2025`, `SAM 2025` ou contratos emergenciais 2025 em alguns blocos, apesar do seletor anual SAM.
- `renderEvolucaoMalha` compara explicitamente 2024 e 2025, sem generalizar para mais anos.
- Alguns scripts de teste/verificação gravam screenshots em caminhos absolutos antigos.

Dependências externas:

- O HTML standalone ainda usa tiles `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` para mapa-base.
- `_loadLeaflet` tem fallback CDN `https://unpkg.com/leaflet@1.9.4/...` se não estiver em standalone.
- `fetch_rodovias_pr.py` usa `https://overpass-api.de/api/interpreter`.

Qualidade de testes:

- Testes são scripts ad hoc, não há runner padronizado (`pytest`, `npm test`, etc.).
- Alguns testes procuram gráficos legados `chartIRI`/`chartFWD`, que podem não existir mais após remoções documentadas.
- Playwright não consta em `requirements.txt`; só `openpyxl` está declarado.

## 8. Arquivos-Fonte que Devem Ser Modificados em Etapas Futuras

Para uma implementação segura, modificar diretamente apenas:

- `dashboard/painel_der.html`, enquanto não houver separação real de fonte/artefato.
- `pipeline/assemble_der.py`, para mudanças de modelo de dados derivado das planilhas.
- `scripts/fetch_rodovias_pr.py`, se a geração do GeoJSON ou metadados do mapa mudar.
- `scripts/extract_benchmark_nacional.py`, se a extração CNT/SEFA mudar.
- Um novo script recomendado, por exemplo `scripts/sync_standalone_data.py`, para sincronizar `window.STANDALONE_DATA`.
- Testes em `scripts/_*.py`, preferencialmente parametrizando caminhos antes de ampliar cobertura.
- Documentação: `README.md` e este plano em `docs/`.

## 9. Arquivos Gerados que Não Devem Ser Editados Diretamente

- `data/der_precomputed.json`: gerado por `pipeline/assemble_der.py`.
- `data/der_malha_financeiro.json`: gerado por `pipeline/assemble_der.py`, debug.
- `dashboard/data/benchmark_nacional.json`: gerado por `scripts/extract_benchmark_nacional.py`.
- `dashboard/data/rodovias_pr.geojson`: gerado por `scripts/fetch_rodovias_pr.py`.
- Screenshots `verify_*.png`, `shot_map.png` e `scripts/ss_*.png`: artefatos de verificação.
- Diretórios `.chrome-cdp-*`: artefatos de navegador, não devem entrar em commits funcionais.

Caso o projeto evolua para fonte separada, `dashboard/painel_der.html` deveria virar artefato gerado; hoje, porém, ele é a fonte canônica.

## 10. Sequência Recomendada de Implementação

1. Higienizar versionamento e ambiente: revisar `.gitignore` para `.chrome-cdp-*`, screenshots temporários e caches; decidir o que fazer com arquivos não rastreados.
2. Parametrizar scripts de teste Playwright para resolver caminhos a partir da raiz do repositório, não de `C:\Users\Luiza Dias\...`.
3. Criar um script de sincronização standalone (`scripts/sync_standalone_data.py`) que leia `data/der_precomputed.json`, `data/dados_extras.json`, `dashboard/data/benchmark_nacional.json`, `dashboard/data/rodovias_pr.geojson` e substitua apenas o objeto `window.STANDALONE_DATA` no HTML.
4. Validar e reduzir fontes duplicadas no blob standalone: decidir se `dados_extras.malha_km/malha_pct` e seções antigas `kpis/subprogramas/municipios/liquidado_por_municipio` continuam necessárias.
5. Corrigir IDs inexistentes e remover sobras reais com teste visual de todas as abas.
6. Substituir textos hardcoded de ano por `anoSelecionadoMalha` ou metadados de dados quando aplicável.
7. Revisar os hardcodes metodológicos (limiares SPC, mapa, benchmark interno) e movê-los para uma configuração explícita no topo do JS ou no JSON, com nomes auditáveis.
8. Reavaliar o mapa: documentar melhor a atribuição aproximada por Voronoi, ou substituir por fonte SIG oficial se disponível.
9. Rodar pipeline, sync standalone e bateria Playwright; registrar comandos no README.
10. Só então implementar alterações analíticas/visuais no painel com escopo fechado.

## 11. Proposta de Commits Separados

1. `chore: ignore browser artifacts and document repo hygiene`
   - `.gitignore` para `.chrome-cdp-*`, screenshots temporários e caches.
   - Nenhuma mudança funcional no painel.

2. `test: make dashboard verification scripts portable`
   - Remover caminhos absolutos antigos dos scripts Playwright.
   - Adicionar helper comum para resolver `dashboard/painel_der.html` pela raiz do repo.

3. `build: add standalone data sync script`
   - Criar script confiável para atualizar `window.STANDALONE_DATA`.
   - Marcar scripts obsoletos como não executáveis/legados ou remover do fluxo documentado.

4. `data: regenerate precomputed dashboard data`
   - Rodar pipeline e extratores, commitar apenas JSONs gerados necessários.
   - Separado para facilitar auditoria de dados.

5. `fix: remove stale dashboard ids and year hardcodes`
   - Corrigir `getElementById` sem alvo real.
   - Tornar textos sensíveis ao ano SAM selecionado quando necessário.

6. `refactor: centralize dashboard thresholds and SR ordering`
   - Consolidar limiares e ordenação SR em configuração única.
   - Sem alterar regras, apenas tornando-as auditáveis.

7. `test: add smoke coverage for standalone tabs and SAM year switch`
   - Verificar carga offline/file, abas, troca de ano SAM, mapa, contratos e tabelas principais.

## 12. Observação Final

Nenhum arquivo do painel foi modificado nesta etapa. A única alteração realizada foi a criação deste relatório em `docs/plano_implementacao_painel_der.md`, conforme solicitado.
