# Painel OpR — DER-PR

Painel de acompanhamento da Ação 8398 (manutenção rodoviária estadual) para o
Departamento de Estradas de Rodagem do Paraná (DER-PR), desenvolvido no âmbito
do piloto Orçamento para Resultados do Instituto Publix. Cruza execução
financeira dos contratos DOPSR1 com a condição observada da malha (SAM, IRI,
FWD) por Superintendência Regional, para apoiar leitura técnica e priorização.

---

## Arquivo principal

**`dashboard/painel_der.html` é o arquivo-fonte, leve, e é o único que se
edita.** Todo o CSS e todo o JavaScript continuam embutidos diretamente no
HTML, mas os dados (`window.STANDALONE_DATA`) **não** — ficam `null` no
arquivo-fonte, e são carregados via `fetch()` em runtime a partir de
`data/der_precomputed.json`, `dashboard/data/benchmark_nacional.json` e
`dashboard/data/rodovias_pr_condicao.geojson` (ver `loadJsonData()` no próprio HTML).
Por causa disso, **abrir `dashboard/painel_der.html` com duplo clique
(`file://`) não funciona** — o navegador bloqueia `fetch` de arquivo local
por segurança, e o painel mostra uma mensagem de erro explicando como servir
a pasta localmente (ex.: `python -m http.server`).

Para abrir sem servidor (duplo clique), gere a cópia autossuficiente:

```bash
python scripts/build_standalone.py
```

Isso lê os 3 JSONs de dados e gera **`dashboard/painel_der_standalone.html`**
— uma cópia com tudo embutido inline (igual ao comportamento antigo),
**gerada, não versionada** (está no `.gitignore`) e **nunca editada
diretamente**: qualquer mudança de HTML/CSS/JS vai sempre em
`painel_der.html`; rode o script de novo para regenerar a cópia.

---

## Abas do painel

O painel tem 5 abas, nesta ordem:

1. **Diagnóstico da Malha** (`tab-malha-diagnostico`) — fotografia técnica da
   condição da malha avaliada (SAM 2025; IRI/FWD 2021–2022), antes de
   qualquer leitura financeira ou cruzamento interpretativo. Inclui mapa
   exploratório por Superintendência Regional.
2. **Pressão e Execução** (`tab-pressao-execucao`) — dividida em dois blocos:
   pressão operacional (SPC e perfil de conservação por
   regional) e execução financeira observada (contratos DOPSR1: empenhado,
   liquidado, distribuição por tipo de contrato).
3. **Leitura Integrada** (`tab-leitura-regional`) — combina condição da
   malha e execução financeira por regional, com síntese executiva e
   achados analíticos consolidados.
4. **Sinais para Investigação** (`tab-sinais`) — cruza condição da malha,
   pressão operacional e execução financeira para levantar perguntas
   orientadoras de investigação técnica (custo relativo por regional,
   quadrantes, benchmark interno). Os cruzamentos não produzem conclusões
   automáticas sobre adequação de investimento.
5. **Contexto Externo — CNT** (`tab-benchmark`) — situa o Paraná no ranking
   nacional da Pesquisa CNT de Rodovias e conecta esse posicionamento aos
   achados internos por Superintendência Regional.

---

## Como os dados chegam no painel

```
data/*.xlsx  →  pipeline/assemble_der.py  →  data/der_precomputed.json
                                                      ↓
                                    fetch() em runtime (loadJsonData())
                                                      ↓
                         dashboard/painel_der.html (aberto via servidor local)
                                                      ↓ (opcional, sob demanda)
                          scripts/build_standalone.py → painel_der_standalone.html
```

`pipeline/assemble_der.py` lê três planilhas de `data/`:

| Arquivo | O que fornece |
|---|---|
| `data/Contratos DOPSR1 por Regional.xlsx` | Fonte canônica de dados financeiros por SR (liquidado, empenhado, nº de contratos, contratos emergenciais, tipos de contrato), por SR + Ano (2024 e 2025) |
| `data/Condição da malha.xlsx` | Extensão (km) e percentual por categoria de condição da malha, por SR + Ano (abas "Malha (km)" e "Malha (%)") |
| `data/IRI_e_FWD.xlsx` | Percentuais de condição estrutural (IRI e FWD) por SR |

O script grava o resultado em `data/der_precomputed.json`, **mesclando**
com o que já existe no arquivo — ele preserva as seções `kpis`,
`subprogramas`, `municipios` e `liquidado_por_municipio`, que este script
não sabe gerar, e substitui apenas a seção `regionais`. Também grava uma
cópia de depuração em `data/der_malha_financeiro.json`, que não é lida pelo
painel.

**Não há mais passo manual de embutir JSON.** `dashboard/painel_der.html`
carrega `data/der_precomputed.json` (e os outros dois JSONs) via `fetch()`
assim que a página abre — atualizar os dados é só rodar o pipeline e dar
refresh no navegador (servido localmente). O bloco `window.STANDALONE_DATA`
existe no HTML apenas como `null`; ele só é preenchido de verdade na cópia
gerada por `scripts/build_standalone.py` (ver seção anterior), que substitui
o antigo `scripts/deprecated/build_standalone_html.ps1` — esse sobrescrevia
`dashboard/painel_der.html` in-place por padrão, o que hoje destruiria a
versão leve; foi descontinuado por isso e não deve ser executado. Há também
`scripts/deprecated/build_standalone.py`, descontinuado desde 2026-07-17 por
um motivo anterior e não relacionado (lia arquivos de uma arquitetura
multi-arquivo que não existe mais). Os dois só existem em `deprecated/` como
histórico — o script ativo é `scripts/build_standalone.py`, na raiz de
`scripts/`.

---

## Estrutura de pastas

```
Painel - DER/
├── README.md                    # este arquivo
├── AUDITORIA_MIGRACAO.md        # histórico da migração de fonte financeira (8398 → Contratos DOPSR1)
├── requirements.txt             # dependência Python (openpyxl)
├── serve.py                     # servidor HTTP local — necessário para abrir dashboard/painel_der.html (fetch não funciona via file://)
├── dashboard/
│   ├── painel_der.html          # ARQUIVO-FONTE — edite este; dados via fetch, precisa de servidor local
│   ├── painel_der_standalone.html  # GERADO por scripts/build_standalone.py — não editar, não versionado (.gitignore)
│   ├── assets/                  # 3 imagens de logo (logo OpR.jpeg, logo der.png, logo governo do paraná.png) — embutidas como data-URI no HTML
│   ├── data/                    # benchmark_nacional.json, rodovias_pr_condicao.geojson — fetch em runtime; embutidos só na cópia standalone
│   ├── src/                     # malha-analytics.js, painel-app.js — fonte do JS embutido no HTML (mantida em paralelo; ver nota abaixo)
│   └── vendor/                  # Chart.js, Leaflet — fonte histórica; já totalmente embutidos no HTML, sem carregamento ativo por caminho
├── pipeline/
│   └── assemble_der.py          # gera/atualiza data/der_precomputed.json a partir das planilhas
├── data/                        # planilhas-fonte e JSONs pré-computados (ver seção acima)
└── scripts/
    ├── build_standalone.py      # ATIVO — gera dashboard/painel_der_standalone.html a partir do template leve
    ├── deprecated/
    │   ├── build_standalone.py        # descontinuado 2026-07-17 — ver nota no próprio arquivo
    │   └── build_standalone_html.ps1  # descontinuado 2026-07-22 — sobrescrevia painel_der.html in-place; ver nota no próprio arquivo
    └── ...                           # demais scripts auxiliares de extração,
                                       # teste e verificação visual
```

**Nota sobre `dashboard/src/`:** esses dois arquivos (`malha-analytics.js`,
`painel-app.js`) eram a fonte que o `build_standalone_html.ps1` (agora
descontinuado) embutia no HTML a cada build. Hoje o JS é editado direto
dentro de `dashboard/painel_der.html`; `dashboard/src/*.js` **não é mais
atualizado automaticamente** e pode estar desatualizado em relação ao JS
embutido no HTML — não sincronizar às cegas.

---

## Limitações metodológicas conhecidas

Reproduzidas das notas metodológicas já presentes no próprio painel:

- **Comparação entre regionais é relativa, não absoluta.** As linhas de
  corte usadas nos gráficos são as medianas das próprias 5
  Superintendências Regionais — não são padrões técnicos externos.
- **Nenhuma análise do painel estabelece causalidade** entre investimento
  (liquidado) e condição da malha. Os cruzamentos medem associação
  observada no mesmo período e devem orientar perguntas de investigação
  técnica, não produzir conclusões automáticas sobre adequação de gasto.
- **A condição da malha está disponível em dois cortes pontuais — 2024 e
  2025 — não em série histórica contínua.** A variação entre os dois anos
  não deve ser lida como tendência de melhoria ou piora; reflete apenas a
  diferença observada entre esses dois retratos.
- **O Sinalizador de Pressão de Conservação (SPC)** é calculado sobre o
  recorte selecionado, sem calibração preditiva formal. Ele não mede efeito
  do gasto nem antecipa resultado futuro; serve como sinalizador relativo de
  atenção entre as cinco SRs.
- **IRI e FWD** usam levantamento de 2021–2022 (SGP), mantido como
  referência estrutural complementar porque mede dimensões que o SAM não
  captura — mas não deve ser confundido com dado do ano corrente.
- **O benchmark nacional (CNT) não estabelece relação causal** entre a
  Ação 8398 e a variação da malha nacional. A malha administrada pelo
  DER-PR é uma fração do universo avaliado pela Pesquisa CNT, e a série
  interna tratada cobre apenas 2024–2025 — não é possível isolar a
  contribuição específica do Paraná na variação nacional.

---

## Como atualizar os dados

1. **Substitua a planilha correspondente em `data/`**, mantendo o nome de
   arquivo exato e o layout de colunas/abas que o pipeline espera:
   - `data/Contratos DOPSR1 por Regional.xlsx` (aba "Empenho por contrato")
   - `data/Condição da malha.xlsx` (abas "Malha (km)" e "Malha (%)")
   - `data/IRI_e_FWD.xlsx` (abas "IRI" e "FWD")
2. **Rode o pipeline** na raiz do projeto:
   ```bash
   python pipeline/assemble_der.py
   ```
   Isso atualiza `data/der_precomputed.json` (mesclando com as seções
   pré-existentes que o script não gera) e grava a cópia de depuração
   `data/der_malha_financeiro.json`.
3. **Não há mais passo manual de cópia.** Rode `python serve.py` na raiz do
   projeto — ele confirma que `data/der_precomputed.json` existe (roda o
   pipeline sozinho se não existir) e abre
   `http://localhost:8080/dashboard/painel_der.html` no navegador. O HTML
   busca o JSON atualizado via `fetch()` a cada carregamento — só dar
   refresh já mostra os dados novos.
4. **Confira que as 5 abas carregam sem erro no console** e que os
   gráficos/tabelas aparecem preenchidos. Se for distribuir uma cópia que
   funcione sem servidor (duplo clique), rode
   `python scripts/build_standalone.py` depois de validar e teste
   `dashboard/painel_der_standalone.html` também.

---

## Dependências

**Python** (apenas para rodar o pipeline):

```
openpyxl>=3.1
```

**JavaScript:** nenhuma dependência externa — Chart.js, Leaflet e
chartjs-plugin-datalabels estão embutidos em `dashboard/painel_der.html`.
