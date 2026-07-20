# Painel OpR — DER-PR

Painel de acompanhamento da Ação 8398 (manutenção rodoviária estadual) para o
Departamento de Estradas de Rodagem do Paraná (DER-PR), desenvolvido no âmbito
do piloto Orçamento para Resultados do Instituto Publix. Cruza execução
financeira dos contratos DOPSR1 com a condição observada da malha (SAM, IRI,
FWD) por Superintendência Regional, para apoiar leitura técnica e priorização.

---

## Arquivo principal

**`dashboard/painel_der.html` é o único arquivo do painel.** Ele é
standalone: todo o CSS, todo o JavaScript e todos os dados (bloco
`window.STANDALONE_DATA`) estão embutidos diretamente no HTML. Basta abrir o
arquivo com duplo clique ou `file:///.../dashboard/painel_der.html` no
navegador — não precisa de servidor, internet ou nenhum outro arquivo do
repositório para funcionar.

Não existem mais variantes deste arquivo. Não há uma versão "standalone"
separada nem uma versão "alinhada ao relatório" — ambas foram removidas por
serem, respectivamente, uma duplicata exata e uma cópia divergente e
desatualizada. `dashboard/painel_der.html` é o arquivo a editar, testar e
entregar.

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
                          (colagem manual, hoje assistida por Claude Code)
                                                      ↓
                    window.STANDALONE_DATA em dashboard/painel_der.html
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

**O passo de embutir o JSON dentro de `dashboard/painel_der.html` é manual
hoje**, não automatizado por um script de build. Isso é proposital:
`scripts/deprecated/build_standalone.py` fazia essa automação antes, mas foi
descontinuado — ele lia `dashboard/painel_der.html` esperando encontrar
`<link>`/`<script>` externos para substituir por conteúdo embutido, e
sobrescrevia o próprio arquivo com o resultado. Depois de rodar uma vez, a
fonte "shell" (com as tags externas) deixou de existir — rodar o script de
novo hoje não dá erro, mas duplica CSS/JS/dados que já estão embutidos,
corrompendo o arquivo. O fluxo atual edita `dashboard/painel_der.html`
diretamente.

---

## Estrutura de pastas

```
Painel - DER/
├── README.md                    # este arquivo
├── AUDITORIA_MIGRACAO.md        # histórico da migração de fonte financeira (8398 → Contratos DOPSR1)
├── requirements.txt             # dependência Python (openpyxl)
├── serve.py                     # servidor HTTP local opcional — o painel abre direto via file://, sem precisar dele
├── dashboard/
│   ├── painel_der.html          # ARQUIVO CANÔNICO — abrir este
│   ├── assets/                  # 3 imagens de logo (logo OpR.jpeg, logo der.png, logo governo do paraná.png) — confirmado embutidas como data-URI no HTML
│   ├── data/                    # benchmark_nacional.json, rodovias_pr.geojson — usados como fallback de fetch se a chave faltar em STANDALONE_DATA
│   └── vendor/                  # Chart.js, Leaflet — fonte histórica; já totalmente embutidos no HTML, sem carregamento ativo por caminho
├── pipeline/
│   └── assemble_der.py          # gera/atualiza data/der_precomputed.json a partir das planilhas
├── data/                        # planilhas-fonte e JSONs pré-computados (ver seção acima)
└── scripts/
    ├── deprecated/
    │   └── build_standalone.py       # descontinuado — ver nota no próprio arquivo
    ├── build_standalone_html.ps1     # rotina alternativa de empacotamento, nunca
    │                                 # executada (escreveria dashboard/painel_der_
    │                                 # autossuficiente.html, que não existe no
    │                                 # repositório) — não usar sem auditar antes
    └── ...                           # demais scripts auxiliares de extração,
                                       # teste e verificação visual
```

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
3. **Copie o conteúdo atualizado de `data/der_precomputed.json`**
   para dentro do bloco `window.STANDALONE_DATA = {...}` em
   `dashboard/painel_der.html`. Esse passo é manual/assistido — não há
   script de build ativo para automatizá-lo (ver seção acima).
4. **Teste abrindo `dashboard/painel_der.html` diretamente no navegador**
   via `file://` — não precisa de `serve.py`. Confira que as 5 abas
   carregam sem erro no console e que os gráficos/tabelas aparecem
   preenchidos.

---

## Dependências

**Python** (apenas para rodar o pipeline):

```
openpyxl>=3.1
```

**JavaScript:** nenhuma dependência externa — Chart.js, Leaflet e
chartjs-plugin-datalabels estão embutidos em `dashboard/painel_der.html`.
