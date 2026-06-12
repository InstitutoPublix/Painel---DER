# Painel---DER
# Painel---DER
=======
# Guia Completo do Projeto — Painel DER-PR

**Painel de Eficiência Orçamentária da Manutenção Rodoviária**
Orçamento para Resultados · DER-PR — Departamento de Estradas de Rodagem do Paraná

---

## Visão Geral

O projeto entrega um painel web interativo para análise da eficiência orçamentária da Ação 8398 (manutenção rodoviária estadual), cobrindo 5 Superintendências Regionais (SRs) e 21 municípios do piloto. Os dados são extraídos de bases XLSX oficiais por um pipeline Python e servidos via servidor HTTP local.

```
Bases XLSX (data/)  →  pipeline/assemble_der.py  →  data/der_precomputed.json
                                                             ↓
                                             serve.py  →  dashboard/ (browser)
```

---

## Estrutura de Pastas

```
Painel - DER/
├── serve.py                              # Servidor HTTP + auto-geração do JSON
├── requirements.txt                      # Dependências Python (openpyxl, pandas)
├── data/                                 # Bases XLSX e JSON pré-processado
│   ├── der_precomputed.json              # Indicadores prontos para o dashboard
│   ├── 8398_e_8399.xlsx                  # Extração orçamentária bruta — Ação 8398/8399
│   ├── Contratos_OPR_VF.xlsx             # Base de contratos da OPR (R$ 9,97 bi em carteira)
│   ├── Contratos_por_Regional_tratado.xlsx   # Contratos DOPSR1 por SR — tratado
│   ├── Condição_da_Malha_tratado.xlsx        # Condição da malha por SR (km e %) — tratado
│   ├── IRI_e_FWD_tratado.xlsx               # Indicadores técnicos IRI e FWD por SR — tratado
│   ├── Base_territorial.xlsx             # Perfil socioeconômico dos 21 municípios do piloto
│   └── DER_Mapa_municípios.xlsx          # Classificação analítica dos municípios (IDH × logística)
├── pipeline/
│   └── assemble_der.py                   # Extração e pré-processamento dos indicadores
├── dashboard/
│   ├── painel_der.html                   # Shell HTML
│   └── assets/
│       ├── painel.css                    # Estilos
│       ├── data-hub.js                   # Camada de dados: loaders, DATA, DERDataHub
│       └── painel.js                     # UI: cache, populate, bind, render
├── docs/                                 # Documentação do projeto
└── exploratory/                          # Análises exploratórias e notebooks
```

---

## Como Executar

```bash
# Instalar dependências Python (apenas uma vez)
pip install openpyxl pandas

# Iniciar painel
python serve.py

# Porta customizada
python serve.py 9000
```

O `serve.py` verifica se `data/der_precomputed.json` existe. Se não existir, executa o pipeline automaticamente antes de abrir o browser.

---

## Arquivo: `serve.py`

Ponto de entrada do projeto. Responsabilidades:

1. **Auto-geração do JSON** — se `data/der_precomputed.json` não existir, executa `pipeline/assemble_der.py` via `subprocess.run()` antes de servir.
2. **Exibe metadados** — se o JSON já existir, imprime a data de geração no terminal.
3. **Servidor HTTP multi-thread** — classe `ThreadedServer` (herda `ThreadingMixIn + TCPServer`) com `allow_reuse_address = True` e `daemon_threads = True`.
4. **Abre o browser** — via `threading.Thread` com delay de 0,8s para dar tempo ao servidor subir.
5. **Handler silencioso** — `QuietHandler` suprime logs HTTP do terminal.

**Endereços padrão:**
- Servidor: `http://localhost:8080`
- Painel: `http://localhost:8080/dashboard/painel_der.html`

---

## Arquivo: `pipeline/assemble_der.py`

Pipeline de extração de dados. Lê os XLSX via `openpyxl` (modo `read_only=True, data_only=True`) e grava `data/der_precomputed.json`.

### Escopo do Piloto

```python
REGIONAIS = ["SR Leste", "SR Campos Gerais", "SR Norte", "SR Noroeste", "SR Oeste"]

MUNICIPIOS_PILOTO = [
    "Agudos do Sul", "Alvorada do Sul", "Cerro Azul", "Curiúva",
    "Francisco Alves", "Paranavaí", "Piên", "Pinhão", "Reserva",
    "Rolândia", "Santo Antônio da Platina", "Três Barras do Paraná",
    "União da Vitória", "Ventania",
    # + demais municípios neutros do piloto
]

SUBPROGRAMAS = [
    "PROCONSERVA", "COP", "CREMEP", "FAIXA", "INTEGRA",
    "PROMAC", "PRORESTAURA", "NÃO PAVIMENTADAS", "RECOMPOSIÇÃO", "EMERGENCIAL"
]
```

### Seções do Pipeline

| Seção | Base Fonte | Indicadores Gerados | Escopo |
|-------|-----------|---------------------|--------|
| **1. Execução Financeira** | `8398_e_8399.xlsx` / `Planilha1` | `orcamento`, `empenhado`, `liquidado`, `pago`, `taxa_execucao` | Ação 8398 agregada |
| **2. Execução por Subprograma** | `8398_e_8399.xlsx` / `8398_tratada` | `liquidado_subprograma`, `taxa_execucao_subprograma`, `custo_km` | 10 subprogramas |
| **3. Contratos por Regional** | `Contratos_por_Regional_tratado.xlsx` | `liquidado_sr`, `n_contratos`, `contratos_emergencial` | 5 SRs |
| **4. Condição da Malha** | `Condição_da_Malha_tratado.xlsx` | `km_ruim_pessimo`, `km_regular`, `km_bom_muito_bom`, `pct_critico`, `liquidado_por_km` | 5 SRs |
| **5. IRI por SR** | `IRI_e_FWD_tratado.xlsx` / `IRI` | `iri_ruim`, `iri_pessimo`, `iri_regular`, `iri_bom`, `iri_muito_bom` | 5 SRs |
| **6. FWD por SR** | `IRI_e_FWD_tratado.xlsx` / `FWD` | `fwd_ruim`, `fwd_pessimo`, `fwd_regular`, `fwd_bom`, `fwd_muito_bom` | 5 SRs |
| **7. Passivos** | `Contratos_OPR_VF.xlsx` / `contratos_tratada` | `passivo_icms`, `passivo_insumos`, `passivo_indenizacoes`, `passivo_total` | Por subprograma |
| **8. Municípios** | `DER_Mapa_municípios.xlsx` / `Base mapa` | `idh`, `relevancia_logistica`, `categoria`, `latitude`, `longitude`, `prioridade` | 21 municípios |
| **9. Base Territorial** | `Base_territorial.xlsx` / `base_territorial_municipios` | `populacao`, `area_km2`, `pib_per_capita`, `liquidado_por_hab`, `ontl_categoria` | 21 municípios |

### Lógica de cada Seção

**Seção 1 — Execução Financeira (8398):**
- Filtra coluna `Ação` pelos códigos `8398` e `8399`
- Agrega `Orçamento Atualizado`, `Despesas Empenhadas`, `Despesas Liquidadas`, `Despesas Pagas`
- `taxa_execucao = Despesas Liquidadas / Orçamento Atualizado × 100`
- Atenção: a Ação 8399 foi descontinuada em 2026 e migrada para a 8398; séries históricas devem consolidar as duas

**Seção 2 — Subprogramas:**
- Usa aba `8398_tratada` que já traz a coluna `subprograma`
- Linhas sem subprograma identificado (`NÃO DEFINIDO`) são mantidas no agregado geral mas excluídas da análise por subprograma
- `custo_km` disponível apenas para subprogramas com produção física registrada (COP, FAIXA, INTEGRA, PROCONSERVA)
- PROMAC e PRORESTAURA têm execução muito baixa por razões distintas: PROMAC = contratos grandes com OS pendente; PRORESTAURA = licitações travadas no TCE

**Seção 3 — Contratos por Regional:**
- Contratos classificados como `EMERGENCIAL` são sinalizados separadamente como indicador de pressão corretiva
- Subtotais e linhas em branco já foram removidos na etapa de tratamento

**Seção 4 — Condição da Malha:**
- Fonte: SAM (Sistema de Administração da Manutenção) do DER, referência 2025
- `pct_critico = (km_ruim + km_pessimo) / km_total × 100`
- `liquidado_por_km` = valor liquidado / extensão total da SR (R$/km) — indicador de intensidade do gasto

**Seções 5 e 6 — IRI e FWD:**
- Fonte: SGP (Sistema de Gerência de Pavimentos), levantamentos a cada 2 anos
- IRI mede irregularidade longitudinal (conforto do usuário); FWD mede capacidade estrutural
- Valores em `%` do total inspecionado por SR
- Duas células com fórmula quebrada no original foram corrigidas na etapa de tratamento: IRI Ruim SR Leste (4,86%) e FWD Ruim SR Campos Gerais (15,98%)

**Seção 8 — Municípios:**
- 4 categorias analíticas: `Paradoxo territorial` (IDH baixo + relevância logística alta), `Só logístico`, `Só vulnerável`, `Neutro`
- Municípios do Paradoxo Territorial com R$ 0 identificado na base: Agudos do Sul e Reserva — investigar trechos concessionados ou obras de outras ações

### Saída: `data/der_precomputed.json`

```json
{
  "generated": "2026-06-12T10:00:00",
  "regionais": {
    "SR Norte": {
      "liquidado": 219184299.66,
      "liquidado_por_km": 86930.64,
      "pct_critico_iri": 37.44,
      "pct_critico_fwd": 30.38,
      "n_contratos": 8,
      "contratos_emergencial": 0
    }
  },
  "subprogramas": {
    "PROCONSERVA": {
      "liquidado": 0,
      "taxa_execucao": 79.9,
      "custo_km": 121263.0
    }
  },
  "municipios": {
    "Agudos do Sul": {
      "idh": 0.66,
      "categoria": "Paradoxo territorial",
      "latitude": -25.9899,
      "longitude": -49.3343,
      "liquidado_por_hab": 0
    }
  },
  "agregado_8398": {
    "orcamento": 0,
    "liquidado": 0,
    "taxa_execucao": 0,
    "sem_rastreabilidade_pct": 56.1
  }
}
```

**Indicadores disponíveis por regional:** `liquidado`, `empenhado`, `liquidado_por_km`, `pct_critico_iri`, `pct_critico_fwd`, `iri_ruim`, `iri_pessimo`, `iri_regular`, `iri_bom`, `iri_muito_bom`, `fwd_ruim`, `fwd_pessimo`, `fwd_regular`, `fwd_bom`, `fwd_muito_bom`, `n_contratos`, `contratos_emergencial`

**Indicadores disponíveis por subprograma:** `liquidado`, `taxa_execucao`, `custo_km`, `passivo_total`, `passivo_icms`, `passivo_insumos`

**Indicadores disponíveis por município:** `idh`, `relevancia_logistica`, `categoria`, `prioridade`, `latitude`, `longitude`, `populacao`, `pib_per_capita`, `liquidado_por_hab`, `ontl_categoria`

---

## Arquivo: `dashboard/painel_der.html`

Shell HTML. Define a estrutura visual estática e a ordem de carregamento:

```html
<link rel="stylesheet" href="assets/painel.css" />
<script src="assets/data-hub.js"></script>   <!-- dados, no <head> -->
...HTML do painel...
<script src="assets/painel.js"></script>     <!-- UI, no final do <body> -->
```

**Ordem importa:** `data-hub.js` carrega antes do DOM; `painel.js` carrega depois e aguarda `DOMContentLoaded`.

Elementos estáticos presentes:
- `#dataStatusChip` — chip de status de carregamento
- `.tab-button[data-tab]` — 4 botões de aba (execucao / regional / malha / territorial)
- `#kpiGrid` — grid de KPI cards no topo (preenchido por JS)
- `#srFilter` — seletor de Superintendência Regional
- `#subprogramaFilter` — seletor de subprograma
- `#tabContent` — área principal de conteúdo (preenchida por JS)

---

## Arquivo: `dashboard/assets/data-hub.js`

Camada de dados do painel. Carregado no `<head>`.

### Estrutura Global

```javascript
const DATA = {};           // { entidade: { indicadores } }
const DATA_STATUS = {
  loadedBases: [],
  failedBases: [],
  lastUpdated: null,
};
```

### Funções Principais

| Função | Descrição |
|--------|-----------|
| `loadPrecomputedJson()` | Faz `fetch("../data/der_precomputed.json")` e popula `DATA` |
| `loadAllData()` | Executa carregamento e chama `refreshPanelFromData()` no `finally` |
| `formatBRL(value)` | Formata número como moeda brasileira (`Intl.NumberFormat("pt-BR")`) |
| `formatPct(value)` | Formata percentual com 1 casa decimal |
| `safeDivide(n, d)` | Divisão segura com fallback `null` se denominador = 0 |

---

## Arquivo: `dashboard/assets/painel.js`

UI principal. Todas as funções de renderização, filtros e visualizações.

### Abas do Painel

| Aba | Pergunta central | Visualizações |
|-----|-----------------|---------------|
| **Execução Financeira** | O dinheiro foi executado? | KPI cards (orçamento / liquidado / taxa de execução); barras empilhadas por subprograma; tabela de execução com sinalização |
| **Eficiência por Regional** | O gasto foi para onde a necessidade era maior? | Tabela-painel SR × indicadores; gráfico de dispersão % malha crítica × liquidado/km; destaque contratos emergenciais |
| **Condição da Malha** | O gasto está preservando a qualidade? | Barras empilhadas IRI e FWD por SR; cards de alerta por regional; sinalização de pressão estrutural |
| **Paradoxo Territorial** | O investimento chega onde a população mais precisa? | Mapa com 21 municípios coloridos por categoria; tabela IDH × relevância × liquidado; destaque municípios críticos |

### Ciclo de Renderização

```
render()
  → filters()              // lê selects de SR e subprograma
  → applyFilters(f)        // filtra o conjunto de dados
  → renderTab(tabId)       // renderiza aba ativa
  → updateHeader()         // atualiza KPIs no topo
```

### Categorias do Paradoxo Territorial

| Categoria | Critério | Municípios |
|-----------|----------|------------|
| Paradoxo territorial | IDH baixo + relevância logística Alta | Agudos do Sul, Reserva |
| Só logístico | IDH razoável + relevância logística Alta | Piên, Rolândia, Santo Antônio da Platina, União da Vitória |
| Só vulnerável | IDH baixo + relevância logística Média ou baixa | Cerro Azul, Curiúva, Francisco Alves, Pinhão, Três Barras, Ventania |
| Neutro | Sem combinação crítica | Demais municípios |

---

## Arquivo: `dashboard/assets/painel.css`

Estilos do painel. Principais classes:

| Classe | Elemento |
|--------|---------|
| `.dashboard-body` | `<body>` — fundo e tipografia base |
| `.institutional-header` | Cabeçalho com logotipo DER e status |
| `.tabs` / `.tab-button` | Barra de navegação por abas |
| `.filter-bar` | Barra de filtros (SR, subprograma) |
| `.kpi-grid` | Grid de cards KPI no topo |
| `.tab-content` | Área principal renderizada por JS |
| `.alert-card` | Cards de alerta para SRs críticas |
| `.chart-block` | Container de cada gráfico/tabela |
| `.paradoxo-badge` | Badge colorido por categoria territorial |

---

## Fluxo Completo de Execução

```
1. Usuário executa: python serve.py
   └── JSON existe? Não → executa pipeline/assemble_der.py
                    Sim → exibe data de geração no terminal

2. serve.py abre http://localhost:8080/dashboard/painel_der.html

3. Browser carrega:
   ├── assets/painel.css
   ├── assets/data-hub.js  (executa imediatamente no <head>)
   └── assets/painel.js    (executa após DOMContentLoaded)

4. DOMContentLoaded:
   ├── cache()    — mapeia IDs DOM → variáveis
   ├── populate() — preenche selects de SR e subprograma
   ├── bind()     — registra event listeners
   └── render()   — primeira renderização com dados stub

5. Paralelo (async):
   └── loadAllData()
       ├── loadPrecomputedJson() → fetch data/der_precomputed.json
       └── (finally) refreshPanelFromData() → re-renderiza com dados reais

6. Usuário interage:
   ├── Clica aba → state.activeTab muda → render()
   ├── Muda filtro de SR → applyFilters() recalcula → render()
   └── Muda filtro de subprograma → render()
```

---

## Regenerar o JSON Manualmente

```bash
python pipeline/assemble_der.py
```

O JSON é gravado em `data/der_precomputed.json`.

---

## Dependências

**Python:**
```
openpyxl>=3.1    # Leitura de .xlsx
pandas>=2.0      # Manipulação de dados tabulares
```

**JavaScript (sem dependências externas):**
- Gráficos renderizados em SVG nativo via JS
- Google Fonts `Inter` (requer internet; graceful degradation sem)

---

## Bases de Dados — Origem e Responsável

| Base | Origem | Responsável no DER | Periodicidade |
|------|--------|--------------------|---------------|
| `8398_e_8399.xlsx` | SEFA / sistema orçamentário | DAF — Diretoria Administrativo-Financeira | Anual |
| `Contratos_OPR_VF.xlsx` | Questionário OPR | Diretoria de Operação | Por ciclo de análise |
| `Contratos_por_Regional_tratado.xlsx` | DOPSR1 | Diretoria de Operação | Por ciclo de análise |
| `Condição_da_Malha_tratado.xlsx` | SAM | Diretoria de Operação | Anual |
| `IRI_e_FWD_tratado.xlsx` | SGP | Diretoria Técnica | A cada 2 anos |
| `Base_territorial.xlsx` | IBGE + proxy ONTL | Consultoria (piloto) | Por ciclo de análise |
| `DER_Mapa_municípios.xlsx` | Construção analítica do piloto | Consultoria (piloto) | Por ciclo de análise |

---

## Notas de Manutenção

- **Atualizar dados anuais:** substitua os XLSX em `data/` e apague `der_precomputed.json`; na próxima execução do `serve.py` o pipeline regenera automaticamente.
- **Transição 8398/8399:** a Ação 8399 foi descontinuada em 2026 e migrada para a 8398. Ao consolidar séries históricas, sempre somar as duas ações para evitar aparência de queda de desempenho.
- **56,1% sem rastreabilidade:** despesas sem meta física vinculada no PPA são mantidas no agregado geral da ação mas excluídas das análises por subprograma. Esse percentual deve ser monitorado e informado explicitamente no painel como limitação metodológica.
- **Paradoxo Territorial — R$ 0 identificado:** Agudos do Sul e Reserva não têm base liquidada identificada na Ação 8398 por município. Hipóteses: trechos concessionados, obras de outras ações, ou ausência de vinculação territorial na base do DER. Verificar via SIDER (sistema de execução de contratos do DER) antes de concluir ausência de investimento.
- **Contratos emergenciais:** qualquer novo contrato classificado como `EMERGENCIAL` deve ser sinalizado como alerta no painel — indica pressão corretiva não planejada.
- **IRI e FWD:** levantamento realizado a cada 2 anos. Na ausência de dado novo, manter o ano de referência explícito no painel para não induzir leitura de dado desatualizado como atual.
- **PROCONSERVA → PROMAX:** o PROCONSERVA foi substituído pelo PROMAX. Ao incorporar dados de 2026 em diante, mapear a correspondência no pipeline para manter continuidade da série histórica.
- **Adicionar novo município ao piloto:** incluir entrada em `DER_Mapa_municípios.xlsx` com todos os campos obrigatórios (código IBGE, IDH, relevância logística, categoria, coordenadas) e regenerar o JSON.
- **Adicionar novo subprograma:** declarar em `SUBPROGRAMAS` no pipeline, garantir que a aba `8398_tratada` já traga a classificação e regenerar.
>>>>>>> c6ff83c (Primeiro commit)
