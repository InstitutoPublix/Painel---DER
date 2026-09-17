/* painel.js - fonte do painel; HTML leve (window.STANDALONE_DATA = null), dados carregados via loadJsonData() em runtime */
// =======================================================
// DADOS — AÇÃO 8398 DER-PR
// =======================================================

const DATA_PATH = Object.freeze({
  ROOT: '../data/',
  DASHBOARD: 'data/'
});

const STANDALONE_DATA = window.STANDALONE_DATA || null;
const STANDALONE_MODE = !!STANDALONE_DATA;

const MalhaAnalyticsApi = window.MalhaAnalytics || {};
const normalizePctFraction = MalhaAnalyticsApi.normalizePctFraction || function(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const fraction = Math.abs(n) > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, fraction));
};
const pctToDisplay = MalhaAnalyticsApi.pctToDisplay || function(value) {
  return normalizePctFraction(value) * 100;
};
const findSrMaiorPctRuimPessimo = MalhaAnalyticsApi.findSrMaiorPctRuimPessimo || function(rows) {
  let winner = null;
  (rows || []).forEach(row => {
    if (!row) return;
    const candidate = Object.assign({}, row, { pct_ruim_pessimo: normalizePctFraction(row.pct_ruim_pessimo) });
    if (!winner || candidate.pct_ruim_pessimo > winner.pct_ruim_pessimo) winner = candidate;
  });
  return winner;
};
const calcularRelacaoCondicaoLiquidado = MalhaAnalyticsApi.calcularRelacaoCondicaoLiquidado || function(rows) {
  return (rows || []).map(row => {
    const kmFavoravel = Number(row?.kmFavoravel ?? row?.kmBom) || 0;
    const liquidado = Number(row?.liquidado) || 0;
    return {
      sr: row?.sr,
      kmFavoravel,
      kmBom: kmFavoravel,
      liquidado,
      kmFavoravelPorMilhaoLiquidado: liquidado > 0 ? kmFavoravel / liquidado * 1e6 : 0,
      kmPorMilhao: liquidado > 0 ? kmFavoravel / liquidado * 1e6 : 0,
      liquidadoPorKmFavoravel: kmFavoravel > 0 ? liquidado / kmFavoravel : null,
      custoPorKmBom: kmFavoravel > 0 ? liquidado / kmFavoravel : null
    };
  });
};
const calcularSinalizadorPressaoConservacao = MalhaAnalyticsApi.calcularSinalizadorPressaoConservacao || function(rows) {
  const max = key => Math.max(...(rows || []).map(r => Number(r?.[key]) || 0), 0.001);
  const maxReg = max('pctRegular'), maxRuim = max('pctRuimPess'), maxEmg = max('pctEmg');
  return (rows || []).map(r => {
    const nReg = (Number(r?.pctRegular) || 0) / maxReg;
    const nRuim = (Number(r?.pctRuimPess) || 0) / maxRuim;
    const nEmg = (Number(r?.pctEmg) || 0) / maxEmg;
    const score = +((nReg + nRuim + nEmg) / 3).toFixed(3);
    const faixa = score >= LIMIAR_PRESSAO_ALTA ? 'sinal alto' : score >= LIMIAR_PRESSAO_MEDIA ? 'sinal intermediario' : 'sinal baixo';
    return { ...r, nReg, nRuim, nEmg, score, spc: score, faixa, missing: [] };
  });
};
const analisarSensibilidadePressao = MalhaAnalyticsApi.analisarSensibilidadePressao || function(rows) {
  const base = calcularSinalizadorPressaoConservacao(rows).sort((a,b) => b.score - a.score);
  return { scenarios: [{ id:'pesos_iguais', label:'Pesos iguais', ranking: base.map(r => r.sr), resultados: base }], rankingMudou: false, mudancas: [] };
};

function loadJsonData(key, url, label){
  if(STANDALONE_DATA && STANDALONE_DATA[key] !== undefined){
    return Promise.resolve(STANDALONE_DATA[key]);
  }
  return fetch(url).then(r => {
    if(!r.ok) throw new Error('HTTP ' + r.status + ' ao carregar ' + label);
    return r.json();
  });
}

// Dados carregados dinamicamente de DATA_PATH.ROOT via initDashboard()
let regionais    = [];

// Dados de DATA_PATH.ROOT
let contratos  = [];
let contratosPorAno = {};
// RP / Exercício Anterior — ver attachRpAContratos() e o _meta de rp_reconciliado.json
let rpReconciliado = { contratos: [], regionais: [], _meta: null };
let rpIndex = new Map();
let rpSemContratoBase = [];
let malhaKm    = [];
let malhaLiqKm = [];

// Condição da malha por SR + Ano e liquidado DOPSR1 do mesmo ano — ambos vêm
// de der_precomputed.regionais[sr].malha_por_ano (um único JSON consolidado;
// gerado por pipeline/assemble_der.py a partir de Condição da malha.xlsx
// cruzada com Contratos DOPSR1 por Regional.xlsx, join por SR + Ano).
let regionaisRaw = {};
let anoSelecionadoMalha = '2025';
const SR_ORDER = ['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];

const appState = {
  selectedSamYear: null,
  selectedFinancialYear: null,
  filters: { sr: '', contratos: { busca: '', regiao: '', tipo: '', status: '' } },
  datasets: {
    availableYears: { sam: [], financial: [], contracts: [], emergencyContracts: [] },
    regionalByYear: {},
  },
  loading: { der_precomputed: 'idle' },
  error: null,
};

// TMDA médio (veíc/dia) por SR — vem de der_precomputed.tmda_por_sr, gerado por
// pipeline/assemble_der.py a partir de "Dados Estatisticos por Área de Gestão
// (fator tráfego).xlsx" (aba "Dados Gerais Resumo PorSR"). Só há granularidade
// por SR (sem série por ano, sem lote/área).
let tmdaPorSr = {};

// Constrói os arrays malhaKm/malhaLiqKm a partir de regionaisRaw[sr].malha_por_ano[ano].
function buildMalhaForAno(anoStr){
  const km = [], pct = [];
  Object.keys(appState.datasets.regionalByYear).forEach(sr => {
    const d = appState.datasets.regionalByYear[sr]?.[anoStr];
    if(!d) return;
    km.push({
      sr,
      ruim_km: d.km.ruim, pessimo_km: d.km.pessimo, regular_km: d.km.regular,
      boa_km: d.km.boa, muito_boa_km: d.km.otima,
      liquidado: d.financial?.liquidado ?? null,
      empenhado: d.financial?.empenhado ?? null,
      pago: d.financial?.pago ?? null,
      conditionYear: d.metadata?.conditionYear || anoStr,
      financialYear: d.financial?.year || null,
      temporalCompatible: !!d.metadata?.compatible
    });
    pct.push({
      sr,
      pct_ruim_pessimo: d.condition.pct.ruim_pessimo, pct_regular: d.condition.pct.regular,
      pct_bom: d.condition.pct.bom_muito_bom,
      // Breakdown individual (5 faixas) — usado pelo gráfico de composição em %;
      // os agregados acima continuam servindo os gráficos existentes (fig6 etc.).
      pct_pessimo: d.condition.pct.pessimo, pct_ruim: d.condition.pct.ruim,
      pct_boa: d.condition.pct.boa, pct_otima: d.condition.pct.otima,
      liq_por_km: d.financial?.liquidado_por_km ?? null,
      conditionYear: d.metadata?.conditionYear || anoStr,
      financialYear: d.financial?.year || null,
      temporalCompatible: !!d.metadata?.compatible
    });
  });
  return { km, pct };
}

// Anos disponíveis na base de malha, ordenados (ex.: ['2024','2025']) — nunca hardcoded.
function anosDisponiveisMalha(){
  return [...appState.datasets.availableYears.sam].sort();
}

function collectYears(regionalByYear, picker){
  const years = new Set();
  Object.values(regionalByYear).forEach(byYear => {
    Object.values(byYear || {}).forEach(entry => {
      const year = picker(entry);
      if(year) years.add(String(year));
    });
  });
  return [...years].sort();
}

function buildRegionalByYear(d){
  const regionalByYear = {};
  Object.keys(d.regionais || {}).forEach(sr => {
    regionalByYear[sr] = {};
    const porAno = d.regionais[sr].malha_por_ano || {};
    Object.keys(porAno).forEach(year => {
      const y = porAno[year] || {};
      const financial = y.financial || {
        year,
        source: 'Contratos DOPSR1 por Regional.xlsx',
        empenhado: y.empenhado ?? null,
        liquidado: y.liquidado ?? null,
        pago: y.pago ?? null,
      };
      const contracts = y.contracts || {
        year,
        source: 'Contratos DOPSR1 por Regional.xlsx',
        n_contratos: y.n_contratos ?? null,
        tipos_contrato: y.tipos_contrato || [],
      };
      const emergencyContracts = y.emergencyContracts || {
        year,
        source: 'Contratos DOPSR1 por Regional.xlsx',
        n_contratos: y.emergencial ?? null,
      };
      const financialYear = financial.year ? String(financial.year) : null;
      const contractsYear = contracts.year ? String(contracts.year) : financialYear;
      regionalByYear[sr][String(year)] = {
        condition: { pct: y.pct || {}, source: 'Condição da malha.xlsx', year: String(year) },
        km: { ...(y.km || {}), source: 'Condição da malha.xlsx', year: String(year) },
        financial: { ...financial, year: financialYear, liquidado_por_km: y.liquidado_por_km ?? null },
        contracts: { ...contracts, year: contractsYear },
        emergencyContracts: { ...emergencyContracts, year: emergencyContracts.year ? String(emergencyContracts.year) : contractsYear },
        metadata: {
          conditionYear: String(year),
          financialYear,
          contractsYear,
          emergencyContractsYear: emergencyContracts.year ? String(emergencyContracts.year) : contractsYear,
          conditionSource: 'Condição da malha.xlsx',
          financialSource: financial.source || 'Contratos DOPSR1 por Regional.xlsx',
          contractsSource: contracts.source || 'Contratos DOPSR1 por Regional.xlsx',
          compatible: financialYear === String(year) && contractsYear === String(year),
        },
      };
    });
  });
  return regionalByYear;
}

function verificarCompatibilidadeTemporal(parts){
  const entries = Object.entries(parts || {}).filter(([, year]) => year != null && year !== '');
  const unique = new Set(entries.map(([, year]) => String(year)));
  return {
    compatible: unique.size <= 1,
    years: Object.fromEntries(entries.map(([key, year]) => [key, String(year)])),
    message: unique.size <= 1 ? '' : 'Não comparável: competências temporais diferentes.',
  };
}

function compatibilidadeAtual(kinds = ['condition','financial']){
  const parts = {};
  if(kinds.includes('condition')) parts.condition = appState.selectedSamYear;
  if(kinds.includes('financial')) parts.financial = appState.selectedFinancialYear;
  if(kinds.includes('contracts')) parts.contracts = appState.selectedFinancialYear;
  if(kinds.includes('emergencyContracts')) parts.emergencyContracts = appState.selectedFinancialYear;
  return verificarCompatibilidadeTemporal(parts);
}

function badgePeriodo(text, opts = {}){
  const cls = opts.mix ? 'periodo-badge mix' : 'periodo-badge';
  const title = opts.title ? ` title="${esc(opts.title)}"` : '';
  return `<span class="${cls}"${title}>${esc(text)}</span>`;
}

function notaNaoComparavelHTML(ctx){
  if(ctx.compatible) return '';
  return `<div class="note warn mt-8" title="${esc(ctx.message)}"><strong>Não comparável:</strong> ` +
    `este cálculo foi desativado porque combina competências diferentes (${esc(JSON.stringify(ctx.years))}).</div>`;
}


// ── Constantes de cor ────────────────────────────────────
const SR_COLORS = {
  'SR Leste':         '#2E75B6',
  'SR Campos Gerais': '#70AD47',
  'SR Norte':         '#C00000',
  'SR Noroeste':      '#E07B00',
  'SR Oeste':         '#1F4E79'
};

const COND_COLORS = {
  pessimo:  '#C00000',
  ruim:     '#E07B00',
  regular:  '#FFC000',
  bom:      '#70AD47',
  muito_bom:'#1A6B3A'
};

// Limiares do benchmark interno de custo por km (parâmetros de regra de negócio — ajuste aqui)
const LIMIAR_BENCHMARK     = 0.15; // ±15% da mediana: >+15% = elevado, <−15% = baixo
const LIMIAR_PARTICIPACAO  = 5;    // p.p.: >+5 = maior participação no gasto relativa à criticidade; <−5 = menor
const LIMIAR_ADERENCIA_LOW  = 0.8; // índice abaixo deste → menor esforço financeiro relativo observado (sinal para investigação)
const LIMIAR_ADERENCIA_HIGH = 1.2; // índice acima deste → acima da participação crítica
const LIMIAR_PRESSAO_ALTA   = 0.67; // SPC >= 0.67: sinal alto.
const LIMIAR_PRESSAO_MEDIA  = 0.33; // SPC >= 0.33: sinal intermediario; abaixo: baixo.

// ── Instâncias de gráficos reutilizáveis ─────────────────
let chScatter        = null;
let chScatterFilter  = '';
let chFig6           = null;
let chQuadrantes     = null;
let chDonutsSR       = {};
let chKmCriticos     = null;

// ── Estado dos pills de filtro por condição (cond-pill) ──
// Série isolada em cada gráfico (dataset.label) ou null = mostrar todas.
// Guardado fora das funções de render porque makeChart() destrói e recria
// o chart a cada chamada (inclusive na troca de #filtroAnoMalha), o que
// apagaria o estado de isolamento se ele vivesse só no chart instance.
let serieIsoladaKmCriticos = null;
let serieIsoladaFig6       = null;

// Aplica o isolamento de série guardado em serieIsolada a um chart: oculta
// todos os datasets exceto o de label === serieIsolada (ou mostra todos se
// serieIsolada for null). Datasets do tipo 'line' (ex.: Investimento/km em
// chartFig6) ficam sempre visíveis, pois não têm pill correspondente.
function reaplicarIsolamento(chart, serieIsolada){
  if(!chart) return;
  chart.data.datasets.forEach((ds, i) => {
    const meta = chart.getDatasetMeta(i);
    meta.hidden = ds.type === 'line' ? false : (serieIsolada ? ds.label !== serieIsolada : false);
  });
  chart.update();
}

// Liga os cond-pill de uma barra de filtro (#filtroKmCriticos ou
// #filtroCondicaoInvest) ao respectivo chart, isolando a série clicada e
// persistindo a escolha em setState (ex: v => serieIsoladaKmCriticos = v).
function wireCondPillBar(barId, getChart, setState){
  const bar = document.getElementById(barId);
  if(!bar) return;
  bar.querySelectorAll('.cond-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const serie = pill.dataset.serie;
      setState(serie);
      bar.querySelectorAll('.cond-pill').forEach(p => p.classList.toggle('active', p === pill));
      reaplicarIsolamento(getChart(), serie);
    });
  });
  const clearBtn = bar.querySelector('.cond-pill-clear');
  if(clearBtn){
    clearBtn.addEventListener('click', () => {
      setState(null);
      bar.querySelectorAll('.cond-pill').forEach(p => p.classList.remove('active'));
      reaplicarIsolamento(getChart(), null);
    });
  }
}

// ── Popover de notas metodológicas ──────────────────────
// Texto completo de ressalvas metodológicas que antes ficavam sempre visíveis
// dentro de .chart-source; agora vivem aqui e só aparecem sob demanda, via
// ícone "ⓘ" (data-nota-id aponta a chave correspondente). Pode conter o mesmo
// markup usado no HTML estático (ex.: spans [data-periodo-malha]) — o popover
// roda updatePeriodoBadges() de novo ao abrir para manter os anos corretos.
const NOTAS_METODOLOGICAS = {
  'tmda-cobertura': 'TMDA médio por SR — planilha "Dados Estatísticos por Área de Gestão" (sem CSV/JSON digitalizado no projeto; valores de referência).',
  'tmda-metodologia': 'TMDA disponível apenas agregado por SR na fonte atual — não permite análise por trecho nem correlação estatística validada. Cruzamento ilustrativo com n=5 observações (uma por SR). O eixo Y (condição SAM) responde ao seletor de ano; o eixo X (TMDA) não tem granularidade por ano na fonte disponível — os mesmos 5 valores de referência por SR são aplicados a 2024 e 2025.',
  'fig6-extensao': 'A quilometragem por SR pode incluir segmentos contados em dobro quando contratos emergenciais cobriram trechos já computados em contratos anteriores encerrados (ressalva técnica do consórcio).',
  'fig6-investimento-km': 'Indicador calculado como valor liquidado em <span data-periodo-malha="{ano}">2025</span> (fluxo anual) dividido pela quilometragem avaliada pelo <span data-periodo-malha="SAM {ano}">SAM 2025</span> — o mesmo denominador (SAM-km) usado pelos demais indicadores de R$/km/ano do painel, portanto consistente com eles, e não um indicador à parte.',
  'quadrantes-linhas-corte': 'Linhas de corte = medianas das 5 SRs, calculadas dinamicamente.',
  'denominador-liquidado-km-fig6': 'Este indicador utiliza como denominador a quilometragem avaliada pelo SAM no ano selecionado (R$/km/ano) — o mesmo denominador usado pelo indicador Investimento/km/ano da Figura 6 (Leitura Regional); ambos são consistentes entre si.',
  'scatter-tendencia': 'Linha de tendência ilustrativa — 5 observações (uma por SR), sem validação estatística de correlação.',
  'evolucao-malha-corte-temporal': 'esta comparação cobre dois retratos pontuais da malha (2024 e 2025), não uma série histórica contínua. A condição observada em cada ano reflete decisões de investimento acumuladas ao longo de anos anteriores, não apenas o exercício corrente — ver ressalva complementar abaixo do gráfico.',
  'mapa-condicao-por-sr': 'As linhas mostram o traçado real das rodovias estaduais do Paraná (fonte: OpenStreetMap). A cor de cada trecho reflete a condição média da Superintendência Regional onde ele está localizado (dados SAM agregados por SR, ano de referência 2025) — não existe, na base disponível, uma nota de condição por trecho individual.',
  'mapa-fonte-osm': 'Dados obtidos via Overpass API. Para regenerar o arquivo de geometria execute: <code>python scripts/fetch_rodovias_pr.py</code>',
  'pressao-isolada': 'Ela não representa, isoladamente, insuficiência ou excesso de investimento.',
  'execucao-financeira-isolada': 'Eles não indicam, isoladamente, necessidade total de investimento, suficiência da alocação ou efeito direto sobre a condição atual da malha.',
  'estoque-fluxo': 'Condição é estoque acumulado da malha; liquidado é fluxo anual. A relação é apenas descritiva, não mede produtividade, efeito do gasto ou qualidade da alocação.',
  'quadrantes-leitura': 'os quadrantes mostram combinações relativas entre condição da malha e liquidado/km no ano selecionado. A posição de uma regional deve ser interpretada como ponto de investigação técnica, não como conclusão sobre suficiência do investimento. A avaliação completa depende de informações complementares sobre tipo de intervenção, passivo acumulado, contratos vigentes, extensão administrada, complexidade das obras e planejamento plurianual.',
  'benchmark-universo-cnt': 'O desempenho estadual neste ranking não pode ser atribuído exclusivamente às ações do DER-PR.',
  'benchmark-fonte-cnt': '<strong>Sem levantamento em 2020 e 2023</strong> — esses anos não constam na série e não foram interpolados.'
};

let notaPopoverEl = null;
let notaPopoverAberto = null; // botão-gatilho atualmente aberto, ou null

function fecharNotaPopover(){
  if(!notaPopoverEl || notaPopoverEl.hidden) return;
  notaPopoverEl.hidden = true;
  if(notaPopoverAberto) notaPopoverAberto.setAttribute('aria-expanded', 'false');
  notaPopoverAberto = null;
}

function abrirNotaPopover(trigger){
  const texto = NOTAS_METODOLOGICAS[trigger.dataset.notaId];
  if(!texto || !notaPopoverEl) return;
  notaPopoverEl.innerHTML = texto;
  notaPopoverEl.hidden = false;
  updatePeriodoBadges(); // reaplica badges [data-periodo-*] dentro do popover, se houver
  const rect = trigger.getBoundingClientRect();
  notaPopoverEl.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  let left = rect.left + window.scrollX;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - notaPopoverEl.offsetWidth - 12;
  if(left > maxLeft) left = Math.max(12, maxLeft);
  notaPopoverEl.style.left = left + 'px';
  trigger.setAttribute('aria-expanded', 'true');
  notaPopoverAberto = trigger;
}

// Escaneia todos os ícones "ⓘ" já presentes no HTML estático e liga cada um
// ao seu texto em NOTAS_METODOLOGICAS — uma função genérica só, nenhuma
// lógica de abrir/fechar duplicada por instância.
function setupNotaPopovers(){
  if(!notaPopoverEl){
    notaPopoverEl = document.createElement('div');
    notaPopoverEl.id = 'notaPopover';
    notaPopoverEl.className = 'nota-popover';
    notaPopoverEl.setAttribute('role', 'dialog');
    notaPopoverEl.setAttribute('aria-label', 'Nota metodológica');
    notaPopoverEl.hidden = true;
    document.body.appendChild(notaPopoverEl);

    document.addEventListener('click', e => {
      if(!notaPopoverAberto) return;
      if(e.target.closest('.nota-info-trigger') || e.target.closest('.nota-popover')) return;
      fecharNotaPopover();
    });
    document.addEventListener('keydown', e => {
      if(e.key === 'Escape' && notaPopoverAberto) fecharNotaPopover();
    });
    window.addEventListener('resize', fecharNotaPopover);
    window.addEventListener('scroll', fecharNotaPopover, true);
  }

  document.querySelectorAll('.nota-info-trigger').forEach(btn => {
    if(btn.dataset.notaWired) return;
    btn.dataset.notaWired = '1';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if(notaPopoverAberto === btn){ fecharNotaPopover(); return; }
      abrirNotaPopover(btn);
    });
  });
}

// =======================================================
// UTILITÁRIOS
// =======================================================

const tt = document.getElementById('tt');

function showTT(e, html){ tt.innerHTML=html; tt.style.display='block'; moveTT(e); }
function moveTT(e){ tt.style.left=(e.clientX+14)+'px'; tt.style.top=(e.clientY-8)+'px'; }
function hideTT(){ tt.style.display='none'; }

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtNum(v, decimais=0){
  if(v==null) return '—';
  return v.toLocaleString('pt-BR', {minimumFractionDigits:decimais, maximumFractionDigits:decimais});
}
function fmtR(v){
  if(v==null) return '—';
  if(v>=1e9) return 'R$&nbsp;'+fmtNum(v/1e9,2)+'&nbsp;bi';
  if(v>=1e6) return 'R$&nbsp;'+fmtNum(v/1e6,1)+'&nbsp;mi';
  return 'R$&nbsp;'+fmtNum(v);
}
// Igual a fmtR, mas com espaço normal (não &nbsp;) — usado em contexto Chart.js
// (tooltip/eixo), onde a string vai direto pro canvas, não pro DOM.
function fmtCur(v){
  if(v==null) return '—';
  if(v>=1e9) return 'R$ '+fmtNum(v/1e9,2)+' bi';
  if(v>=1e6) return 'R$ '+fmtNum(v/1e6,1)+' mi';
  return 'R$ '+fmtNum(v);
}
function fmtRF(v){ return v==null?'—':'R$&nbsp;'+fmtNum(Math.round(v)); }
function fmtP(v){ return v==null?'—':fmtNum(v,1)+' %'; }
function fmtPctCond(v, decimais=0){ return fmtNum(pctToDisplay(v), decimais) + '%'; }

// Percentuais internos de condição da malha usam fração 0-1.
// A conversão para 0-100 ocorre apenas na camada de apresentação.

function showChartRenderError(canvas, err){
  const wrap = canvas && canvas.parentElement;
  if(!wrap || wrap.querySelector('.chart-error-inline')) return;
  const msg = document.createElement('div');
  msg.className = 'chart-error-inline';
  msg.textContent = 'Grafico indisponivel nesta abertura. Os dados do painel continuam carregados.';
  wrap.appendChild(msg);
  console.error('Erro ao renderizar grafico', canvas && canvas.id ? canvas.id : canvas, err);
}

// chartjs-plugin-datalabels é carregado (vendor embutido) mas nunca era registrado — registra
// aqui uma única vez, com display:false por padrão, para não afetar nenhum gráfico existente.
// Gráficos que querem rótulos visíveis (ex.: renderTmdaCondicao) ligam plugins.datalabels.display
// explicitamente na própria config.
if(window.Chart && window.ChartDataLabels && !Chart.registry.plugins.get('datalabels')){
  Chart.register(ChartDataLabels);
  Chart.defaults.set('plugins.datalabels', { display: false });
}

function makeChart(canvas, config){
  const el = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
  if(!el || !window.Chart) return null;
  try{
    const existing = Chart.getChart(el);
    if(existing) existing.destroy();
    return new Chart(el, config);
  }catch(err){
    showChartRenderError(el, err);
    return null;
  }
}

function median(arr){
  const s = [...arr].sort((a,b)=>a-b);
  const mid = Math.floor(s.length/2);
  return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2;
}

function execBadge(t){
  if(t==null) return '<span class="badge b-gray">—</span>';
  if(t>=90) return '<span class="badge b-green">Alta execução</span>';
  if(t>=70) return '<span class="badge b-yellow">Execução moderada</span>';
  return '<span class="badge b-red">Baixa execução</span>';
}

function pb(pct, maxPct=45){
  const c = pct>=25?'#C00000':pct>=15?'#FFC000':'#70AD47';
  const w = fmtNum(Math.min(pct/maxPct*100,100),1);
  return `<div class="pb-wrap"><div class="pb"><div class="pb-fill" style="width:${w}%;background:${c}"></div></div><span>${fmtP(pct)}</span></div>`;
}

// =======================================================
// ESTADO DOS FILTROS
// =======================================================

let srFiltro = '';
// =======================================================
// ABA 1 — SÍNTESE EXECUTIVA
// =======================================================

// =======================================================
// ABA 2 — CONTRATOS DOPSR1
// =======================================================

function renderExecucao(){
  renderContratos();
}

// =======================================================
// ABA 4 — ALINHAMENTO POR REGIONAL
// =======================================================

function renderFig6(){
  if(chFig6 || !malhaLiqKm.length) return;
  const canvas = document.getElementById('chartFig6');
  if(!canvas) return;

  const sorted = [...malhaLiqKm].sort((a,b) => b.pct_bom - a.pct_bom);
  const labels = sorted.map(r => r.sr.replace('SR ', ''));

  chFig6 = makeChart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ruim + Péssimo', data: sorted.map(r => +(r.pct_ruim_pessimo * 100).toFixed(1)), backgroundColor: COND_COLORS.pessimo, stack: 'cond', yAxisID: 'y', order: 1 },
        { label: 'Regular',        data: sorted.map(r => +(r.pct_regular      * 100).toFixed(1)), backgroundColor: COND_COLORS.regular,  stack: 'cond', yAxisID: 'y', order: 1 },
        { label: 'Bom + Muito Bom',data: sorted.map(r => +(r.pct_bom          * 100).toFixed(1)), backgroundColor: COND_COLORS.bom,      stack: 'cond', yAxisID: 'y', order: 1 },
        {
          type: 'line', label: 'Investimento/km/ano (R$ mil)',
          data: sorted.map(r => +(r.liq_por_km / 1000).toFixed(1)),
          borderColor: '#1F4E79', backgroundColor: 'rgba(31,78,121,0.12)',
          borderWidth: 2.5, pointRadius: 6, pointBackgroundColor: '#1F4E79',
          pointBorderColor: 'white', pointBorderWidth: 2,
          yAxisID: 'y1', tension: 0, fill: false, order: 0
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              if(ctx.dataset.yAxisID === 'y1')
                return ` Invest./km/ano: R$ ${fmtNum(ctx.raw, 1)} mil`;
              return ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)}%`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true, max: 100,
          ticks: { callback: v => v + '%' },
          title: { display: true, text: '% da malha', font: { size: 11 } },
          grid: { color: '#F0F0F0' }
        },
        y1: {
          position: 'right',
          title: { display: true, text: 'R$ mil/km/ano', font: { size: 11 }, color: '#1F4E79' },
          grid: { display: false },
          ticks: { color: '#1F4E79', callback: v => fmtNum(v, 0) + 'k' }
        }
      }
    }
  });
  reaplicarIsolamento(chFig6, serieIsoladaFig6);
}

// Cruza a variação de % Bom+Muito Bom entre os dois anos SAM mais recentes
// (mesma fonte/anos de renderEvolucaoMalha, aba Diagnóstico da Malha) com o
// Liquidado/km/ano do ano mais recente, por SR. Dois gráficos de barras
// horizontais lado a lado (mesma ordem de SR em ambos, sem eixo combinado)
// em vez de eixo duplo, para não sugerir relação funcional entre variação
// de condição (p.p.) e valor liquidado (R$) — ver nota metodológica no HTML.
function renderEvolucaoLiquidadoRegional(){
  const canvasVar = document.getElementById('chartEvolucaoLiquidadoVariacao');
  const canvasVal = document.getElementById('chartEvolucaoLiquidadoValor');
  if(!canvasVar || !canvasVal) return;

  const anosSerie = anosDisponiveisMalha();
  if(anosSerie.length < 2) return;
  const anoA = anosSerie[anosSerie.length - 2];
  const anoB = anosSerie[anosSerie.length - 1];

  // chartEvolucaoLiquidadoValor acompanha o ano selecionado em #filtroAnoMalha
  // (diferente de anoA/anoB acima, que são fixos nos dois exercícios mais
  // recentes só para o cálculo de variação de condição).
  const anoValorSelecionado = (typeof anoSelecionadoMalha !== 'undefined' && anosSerie.includes(anoSelecionadoMalha))
    ? anoSelecionadoMalha
    : anoB;

  const periodoEl = document.getElementById('evolucaoLiquidadoPeriodo');
  if(periodoEl) periodoEl.textContent = anoA + '→' + anoB;
  const anoRefEl = document.getElementById('evolucaoLiquidadoAnoRef');
  if(anoRefEl) anoRefEl.textContent = anoValorSelecionado;
  const fonteRefEl = document.getElementById('evolucaoLiquidadoFonteRef');
  if(fonteRefEl) fonteRefEl.innerHTML = '<strong>Fonte:</strong> Contratos DOPSR1 por Regional.xlsx (' + anoValorSelecionado + ').';

  const linhas = SR_ORDER.map(sr => {
    const porAno = appState.datasets.regionalByYear[sr] || {};
    const dA = porAno[anoA];
    const dB = porAno[anoB];
    if(!dA || !dB) return null;
    const pctA = (dA.condition.pct.bom_muito_bom || 0) * 100;
    const pctB = (dB.condition.pct.bom_muito_bom || 0) * 100;
    return { sr, delta: pctB - pctA, lkm: porAno[anoValorSelecionado]?.financial?.liquidado_por_km ?? null };
  }).filter(Boolean);
  if(!linhas.length) return;

  // Ordenado da maior melhora para a maior piora; o segundo gráfico usa a
  // mesma ordem (não reordena por valor liquidado), para permitir leitura
  // lado a lado SR-a-SR sem forçar um eixo combinado.
  const sorted = [...linhas].sort((a, b) => b.delta - a.delta);
  const labels = sorted.map(r => r.sr.replace('SR ', ''));

  makeChart(canvasVar, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: sorted.map(r => +r.delta.toFixed(1)),
        backgroundColor: sorted.map(r => r.delta >= 0 ? '#4a8a4a' : '#C00000'),
        borderRadius: 3
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw >= 0 ? '+' : ''}${fmtNum(ctx.raw, 1)} p.p. (${anoA}→${anoB})` } }
      },
      scales: {
        x: { grid: { color: '#F0F0F0' }, ticks: { callback: v => (v >= 0 ? '+' : '') + v + ' p.p.' } },
        y: { grid: { display: false } }
      }
    }
  });

  makeChart(canvasVal, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: sorted.map(r => r.lkm != null ? Math.round(r.lkm) : 0),
        backgroundColor: sorted.map(r => SR_COLORS[r.sr] || '#888'),
        borderRadius: 3
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` R$ ${fmtNum(ctx.raw)}/km/ano (${anoValorSelecionado})` } }
      },
      scales: {
        x: { grid: { color: '#F0F0F0' }, ticks: { callback: v => v >= 1000 ? fmtNum(v / 1000, 0) + 'k' : v } },
        y: { grid: { display: false } }
      }
    }
  });
}

// Compara, por SR, a variação da condição SAM entre os dois anos SAM mais
// recentes (2024→2025) com o total empenhado no ano anterior à medição mais
// recente — o ano em que o esforço de manutenção que antecede 2025 foi
// contratado. Único intervalo disponível (n=5 SRs); não calcula correlação
// (ver nota metodológica no HTML — fragilidade estatística com 5 pontos).
// Dois gráficos de barras horizontais lado a lado (mesma ordem de SR em
// ambos, sem eixo combinado) em vez de eixo duplo, para não sugerir relação
// funcional entre variação de condição (p.p.) e empenhado (R$) — mesmo
// padrão de renderEvolucaoLiquidadoRegional.
function renderDeltaCondicaoEmpenho(){
  const canvasDelta = document.getElementById('chartDeltaCondicao');
  const canvasEmp   = document.getElementById('chartEmpenhado2024');
  if(!canvasDelta || !canvasEmp) return;
  const anosSerie = anosDisponiveisMalha();
  if(anosSerie.length < 2) return;
  const anoA = anosSerie[anosSerie.length - 2];
  const anoB = anosSerie[anosSerie.length - 1];

  const periodoEl = document.getElementById('deltaCondicaoEmpenhoPeriodo');
  if(periodoEl) periodoEl.textContent = anoA + '→' + anoB;
  const periodoEl2 = document.getElementById('deltaCondicaoEmpenhoPeriodo2');
  if(periodoEl2) periodoEl2.textContent = anoA + '→' + anoB;
  const anoRefEl = document.getElementById('deltaCondicaoEmpenhoAnoRef');
  if(anoRefEl) anoRefEl.textContent = anoA;

  const linhas = SR_ORDER.map(sr => {
    const porAno = appState.datasets.regionalByYear[sr] || {};
    const dA = porAno[anoA];
    const dB = porAno[anoB];
    if(!dA || !dB) return null;
    const pctA = (dA.condition.pct.bom_muito_bom || 0) * 100;
    const pctB = (dB.condition.pct.bom_muito_bom || 0) * 100;
    return { sr, delta: pctB - pctA, empenhado: dA.financial?.empenhado ?? null };
  }).filter(Boolean);
  if(!linhas.length) return;

  // Ordenado da maior melhora para a maior piora; o segundo gráfico usa a
  // mesma ordem (não reordena por empenhado), para permitir leitura lado a
  // lado SR-a-SR sem forçar um eixo combinado.
  const sorted = [...linhas].sort((a, b) => b.delta - a.delta);
  const labels = sorted.map(r => r.sr.replace('SR ', ''));

  makeChart(canvasDelta, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: sorted.map(r => +r.delta.toFixed(1)),
        backgroundColor: sorted.map(r => r.delta >= 0 ? '#4a8a4a' : '#C00000'),
        borderRadius: 3
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw >= 0 ? '+' : ''}${fmtNum(ctx.raw, 1)} p.p. (${anoA}→${anoB})` } }
      },
      scales: {
        x: { grid: { color: '#F0F0F0' }, ticks: { callback: v => (v >= 0 ? '+' : '') + v + ' p.p.' } },
        y: { grid: { display: false } }
      }
    }
  });

  makeChart(canvasEmp, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: sorted.map(r => r.empenhado != null ? Math.round(r.empenhado) : 0),
        backgroundColor: sorted.map(r => SR_COLORS[r.sr] || '#888'),
        borderRadius: 3
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` R$ ${fmtNum(ctx.raw)} (${anoA})` } }
      },
      scales: {
        x: { grid: { color: '#F0F0F0' }, ticks: { callback: v => v >= 1e6 ? fmtNum(v / 1e6, 0) + 'M' : fmtNum(v) } },
        y: { grid: { display: false } }
      }
    }
  });

  renderDeltaCondicaoEmpenhoNarrativa(sorted, anoA, anoB);
}

function renderDeltaCondicaoEmpenhoNarrativa(linhas, anoA, anoB){
  const el = document.getElementById('delta-narrativa');
  if(!el || !linhas.length) return;

  const empenhoMediana = median(linhas.filter(r => r.empenhado != null).map(r => r.empenhado));
  const posRelativa = v => v == null ? 'sem dado' : (v >= empenhoMediana ? 'acima da mediana' : 'abaixo da mediana');

  const srMelhora = linhas.reduce((a, b) => b.delta > a.delta ? b : a, linhas[0]);
  const srPiora   = linhas.reduce((a, b) => b.delta < a.delta ? b : a, linhas[0]);

  el.innerHTML =
    `A <strong>${esc(srMelhora.sr)}</strong> apresenta a maior variação positiva de condição no período ` +
    `(${srMelhora.delta >= 0 ? '+' : ''}${fmtNum(srMelhora.delta, 1)} p.p., ${anoA}→${anoB}), com empenhado ${anoA} ` +
    `de ${fmtR(srMelhora.empenhado)} (${posRelativa(srMelhora.empenhado)} entre as 5 SRs). ` +
    `A <strong>${esc(srPiora.sr)}</strong> registra a variação menos favorável no mesmo intervalo ` +
    `(${srPiora.delta >= 0 ? '+' : ''}${fmtNum(srPiora.delta, 1)} p.p.), com empenhado ${anoA} ` +
    `de ${fmtR(srPiora.empenhado)} (${posRelativa(srPiora.empenhado)}). ` +
    `Com apenas dois anos de dados e 5 SRs, este padrão é descritivo — não estatisticamente robusto e não permite ` +
    `inferir relação de causa e efeito entre empenho e variação de condição observada.`;
}

function renderRelacaoRegional(sr=''){
  srFiltro = sr;
  appState.filters.sr = sr;
  const samLookup = Object.fromEntries(malhaLiqKm.map(m => [m.sr, m]));
  const tbody = document.getElementById('tbodyReg');
  tbody.innerHTML = regionais.map(r=>{
    const isNorte = r.sr==='SR Norte';
    const isSelected = !sr || r.sr===sr;
    const rowCls = isNorte ? 'tr-norte' : '';
    const dimCls = sr && !isSelected ? 'row-dimmed' : '';
    const sam = samLookup[r.sr] || {};
    const pctBomSAM = sam.pct_bom != null ? fmtPctCond(sam.pct_bom, 0) : '—';
    const emgHtml = r.emg>0
      ? `<span class="emg-count">${r.emg} ⚠️</span>`
      : r.emg;
    return `<tr class="${rowCls} ${dimCls}">
      <td><strong>${esc(r.sr)}</strong></td>
      <td>${fmtRF(r.liquidado)}</td>
      <td>${r.lkm == null ? badgePeriodo('não comparável', { mix: true, title: 'Competências temporais incompatíveis' }) : 'R$&nbsp;' + r.lkm.toLocaleString('pt-BR')}</td>
      <td>${pctBomSAM}</td>
      <td>${r.nc}</td>
      <td>${emgHtml}</td>
    </tr>`;
  }).join('');

  renderScatter(sr);
}

function _linearRegression(pts){
  const n=pts.length, sx=pts.reduce((a,p)=>a+p.x,0), sy=pts.reduce((a,p)=>a+p.y,0);
  const sxy=pts.reduce((a,p)=>a+p.x*p.y,0), sx2=pts.reduce((a,p)=>a+p.x*p.x,0);
  const slope=(n*sxy-sx*sy)/(n*sx2-sx*sx);
  const intercept=(sy-slope*sx)/n;
  return {slope,intercept};
}

function renderScatter(sr=''){
  chScatterFilter = sr;
  const canvas = document.getElementById('scatter');
  if(!canvas) return;
  const maxKm  = Math.max(...regionais.map(r=>r.kmTotal||1));

  const baseRadius = r => 8 + Math.sqrt((r.kmTotal||1)/maxKm)*14;

  const samLookup = Object.fromEntries(malhaLiqKm.map(m=>[m.sr, m]));
  const scatterData = regionais.map(r=>{
    const sam = samLookup[r.sr] || {};
    return {
      x: +(( sam.pct_ruim_pessimo || 0) * 100).toFixed(2),
      y: r.lkm, sr: r.sr,
      pctBom: +((sam.pct_bom || 0) * 100).toFixed(1),
      emg: r.emg, kmTotal: r.kmTotal
    };
  });
  const pts = scatterData.map(d=>({x:d.x,y:d.y}));
  const reg = _linearRegression(pts);
  const xMin = Math.min(...scatterData.map(d=>d.x));
  const xMax = Math.max(...scatterData.map(d=>d.x));
  const trend = [{x:xMin,y:reg.slope*xMin+reg.intercept},{x:xMax,y:reg.slope*xMax+reg.intercept}];

  const pctBomMedian = median(scatterData.map(d=>d.pctBom));
  const colorSam = pct => pct>=pctBomMedian ? COND_COLORS.bom : COND_COLORS.ruim;
  const pointColors  = scatterData.map(d=>{
    const hex = colorSam(d.pctBom);
    if(!sr || d.sr===sr) return hex;
    return hex+'33'; // dimmed if filtered out
  });
  const pointRadii = scatterData.map(d=>{
    const r = baseRadius(d);
    return (!sr || d.sr===sr) ? r : r*0.6;
  });

  if(chScatter){
    chScatter.data.datasets[0].backgroundColor = pointColors;
    chScatter.data.datasets[0].pointBackgroundColor = pointColors;
    chScatter.data.datasets[0].pointRadius = pointRadii;
    chScatter.data.datasets[0].pointHoverRadius = pointRadii.map(r=>r+3);
    chScatter.update('none');
    return;
  }

  chScatter = makeChart(canvas,{
    type:'scatter',
    data:{
      datasets:[
        {
          label:'SR',
          data: scatterData,
          backgroundColor: pointColors,
          pointBackgroundColor: pointColors,
          pointBorderColor:'white',
          pointBorderWidth:2,
          pointRadius: pointRadii,
          pointHoverRadius: pointRadii.map(r=>r+3)
        },
        {
          type:'line',
          label:'Tendência linear',
          data: trend,
          borderColor:'#8FA6C1',
          borderWidth:1.5,
          borderDash:[5,4],
          pointRadius:0,
          fill:false,
          tension:0
        }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          filter: item => item.datasetIndex===0,
          callbacks:{
            title:()=>'',
            label: ctx=>{
              const d=ctx.raw;
              const lines=[d.sr,
                `% Ruim+Péssimo (SAM ${anoSelecionadoMalha}): ${fmtNum(d.x,1)}%`,
                `% Bom+Muito Bom (SAM ${anoSelecionadoMalha}): ${fmtNum(d.pctBom,0)}%`,
                `Liquidado/km/ano: R$ ${fmtNum(d.y)} (${anoSelecionadoMalha})`,
                `Malha total: ${fmtNum(d.kmTotal||0,0)} km`
              ];
              if(d.emg>0) lines.push(`Contratos emergenciais ${anoSelecionadoMalha}: ${d.emg}`);
              return lines;
            }
          }
        }
      },
      scales:{
        x:{
          title:{display:true,text:'% Ruim+Péssimo — SAM ' + anoSelecionadoMalha,font:{size:12},color:'#555'},
          grid:{color:'#F0F0F0'},
          ticks:{callback:v=>v+'%'}
        },
        y:{
          title:{display:true,text:'Liquidado/km/ano — ' + anoSelecionadoMalha + ' (R$)',font:{size:12},color:'#555'},
          grid:{color:'#F0F0F0'},
          ticks:{callback:v=>v>=1000?fmtNum(v/1000,0)+'k':v}
        }
      }
    }
  });
}

// =======================================================
// ABA 3 — CONDIÇÃO DA MALHA
// =======================================================

function renderMalha(){
  // Ranking de criticidade (Ruim+Péssimo) em % da extensão de cada SR — evita que
  // regionais com malhas de tamanhos muito diferentes distorçam a leitura visual
  // (uma SR pequena com poucos km ruins pode parecer melhor do que é, proporcionalmente).
  if(malhaLiqKm.length > 0){
    const critSorted = [...malhaLiqKm]
      .map(r=>({sr:r.sr, ruimPessimo:(r.pct_ruim_pessimo||0)*100, regular:(r.pct_regular||0)*100, bom:(r.pct_bom||0)*100}))
      .sort((a,b)=>b.ruimPessimo-a.ruimPessimo);
    chKmCriticos = makeChart(document.getElementById('chartKmCriticos'),{
      type:'bar',
      data:{
        labels: critSorted.map(r=>r.sr.replace('SR ','')),
        datasets:[
          { label:'Ruim + Péssimo', data:critSorted.map(r=>+r.ruimPessimo.toFixed(1)), backgroundColor:COND_COLORS.pessimo, borderRadius:3 },
          { label:'Regular',        data:critSorted.map(r=>+r.regular.toFixed(1)),     backgroundColor:COND_COLORS.regular,  borderRadius:3 },
          { label:'Bom + Muito Bom',data:critSorted.map(r=>+r.bom.toFixed(1)),         backgroundColor:COND_COLORS.bom,      borderRadius:3 }
        ]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{position:'bottom',labels:{font:{size:11},padding:12}},
          tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.x,1)}%`}}
        },
        scales:{
          x:{stacked:true,min:0,max:100,ticks:{callback:v=>v+'%'},grid:{color:'#F0F0F0'}},
          y:{stacked:true,grid:{display:false}}
        }
      }
    });
    reaplicarIsolamento(chKmCriticos, serieIsoladaKmCriticos);
  }

  // Composição da malha por condição, em %
  if(malhaLiqKm.length > 0){
    const pctSorted = [...malhaLiqKm].sort((a,b)=>a.pct_ruim_pessimo-b.pct_ruim_pessimo);
    makeChart(document.getElementById('chartMalhaPct'),{
      type:'bar',
      data:{
        labels: pctSorted.map(r=>r.sr.replace('SR ','')),
        datasets:[
          { label:'Péssimo',   data:pctSorted.map(r=>+((r.pct_pessimo||0)*100).toFixed(1)),  backgroundColor:COND_COLORS.pessimo   },
          { label:'Ruim',      data:pctSorted.map(r=>+((r.pct_ruim||0)*100).toFixed(1)),      backgroundColor:COND_COLORS.ruim      },
          { label:'Regular',   data:pctSorted.map(r=>+((r.pct_regular||0)*100).toFixed(1)),   backgroundColor:COND_COLORS.regular   },
          { label:'Boa',       data:pctSorted.map(r=>+((r.pct_boa||0)*100).toFixed(1)),       backgroundColor:COND_COLORS.bom       },
          { label:'Muito Boa', data:pctSorted.map(r=>+((r.pct_otima||0)*100).toFixed(1)),     backgroundColor:COND_COLORS.muito_bom }
        ]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{position:'bottom',labels:{font:{size:11},padding:12}},
          tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.x,1)}%`}}
        },
        scales:{
          x:{stacked:true,min:0,max:100,ticks:{callback:v=>v+'%'},grid:{color:'#F0F0F0'}},
          y:{stacked:true,grid:{display:false}}
        }
      }
    });
  }

  renderMapaRodovias();
  renderTmdaCondicao();
  renderEvolucaoMalha();
  renderMalhaDonutsPorSR();
}

// Pequenos múltiplos: um gráfico de rosca por SR, mostrando a composição
// completa da malha (5 faixas de condição) daquela regional isoladamente.
// Complementa o chartMalhaPct (barras empilhadas comparando as 5 SRs lado a
// lado) — aqui o objetivo é ler o detalhe exato de uma SR sem a barra
// combinada "espremer" as faixas menores. Fonte: mesmo malhaLiqKm (nenhum
// dado novo, nenhuma chamada ao pipeline Python).
function renderMalhaDonutsPorSR(){
  const container = document.getElementById('grid-malha-donuts-sr');
  if(!container || !malhaLiqKm.length) return;

  Object.values(chDonutsSR).forEach(ch => ch && ch.destroy());
  chDonutsSR = {};

  container.innerHTML = malhaLiqKm.map(r => `
    <div class="donut-sr-card">
      <div class="donut-sr-title">${esc(r.sr.replace('SR ',''))}</div>
      <canvas id="donutSR-${esc(r.sr.replace(/\s+/g,''))}" role="img" aria-label="Gráfico de rosca: composição da malha por condição na Superintendência Regional ${esc(r.sr)}"></canvas>
    </div>
  `).join('');

  malhaLiqKm.forEach(r => {
    const canvasId = `donutSR-${r.sr.replace(/\s+/g,'')}`;
    const canvas = document.getElementById(canvasId);
    if(!canvas) return;
    chDonutsSR[r.sr] = makeChart(canvas, {
      type:'doughnut',
      data:{
        labels:['Péssimo','Ruim','Regular','Boa','Muito Boa'],
        datasets:[{
          data:[
            +((r.pct_pessimo||0)*100).toFixed(1),
            +((r.pct_ruim||0)*100).toFixed(1),
            +((r.pct_regular||0)*100).toFixed(1),
            +((r.pct_boa||0)*100).toFixed(1),
            +((r.pct_otima||0)*100).toFixed(1)
          ],
          backgroundColor:[COND_COLORS.pessimo, COND_COLORS.ruim, COND_COLORS.regular, COND_COLORS.bom, COND_COLORS.muito_bom],
          borderWidth:1,
          borderColor:'#fff'
        }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        cutout:'55%',
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:ctx=>` ${ctx.label}: ${fmtNum(ctx.parsed,1)}%`}}
        }
      }
    });
  });
}

// Bloco "Evolução da Malha — 2024 → 2025": gráfico de barras agrupadas,
// mini-cards por SR e leitura narrativa — sempre comparando os dois anos
// disponíveis lado a lado (independente do ano selecionado em #filtroAnoMalha,
// que controla o restante da aba). Fonte: regionaisRaw[sr].malha_por_ano.
function renderEvolucaoMalha(){
  const canvas = document.getElementById('chartEvolucaoMalha');
  const gridEl = document.getElementById('grid-evolucao-malha');
  const narrEl = document.getElementById('evolucao-malha-narrativa');
  if(!canvas || !gridEl || !narrEl) return;

  const anosSerie = anosDisponiveisMalha();
  if(anosSerie.length < 2){
    const anoUnico = anosSerie[0] || 'indisponível';
    const existing = window.Chart && Chart.getChart(canvas);
    if(existing) existing.destroy();
    gridEl.innerHTML = '';
    narrEl.innerHTML = `<strong>Evolução indisponível:</strong> há apenas um levantamento SAM disponível (${esc(anoUnico)}). ` +
      `O painel não cria comparação artificial sem dois períodos observados.`;
    return;
  }

  const anoA = anosSerie[anosSerie.length - 2];
  const anoB = anosSerie[anosSerie.length - 1];
  const linhasDinamicas = SR_ORDER.map(sr => {
    const porAno = appState.datasets.regionalByYear[sr] || {};
    const dA = porAno[anoA];
    const dB = porAno[anoB];
    if(!dA || !dB) return null;
    const pctA = (dA.condition.pct.bom_muito_bom || 0) * 100;
    const pctB = (dB.condition.pct.bom_muito_bom || 0) * 100;
    return { sr, pctA, pctB, delta: pctB - pctA };
  }).filter(Boolean);

  if(!linhasDinamicas.length){
    const existing = window.Chart && Chart.getChart(canvas);
    if(existing) existing.destroy();
    gridEl.innerHTML = '';
    narrEl.innerHTML = `<strong>Evolução indisponível:</strong> os dois anos mais recentes (${esc(anoA)} e ${esc(anoB)}) ` +
      `não possuem pares completos por regional.`;
    return;
  }

  makeChart(canvas, {
    type: 'bar',
    data: {
      labels: linhasDinamicas.map(r => r.sr.replace('SR ', '')),
      datasets: [
        { label: anoA, data: linhasDinamicas.map(r => r.pctA), backgroundColor: '#9DC3E6', borderRadius: 3 },
        { label: anoB, data: linhasDinamicas.map(r => r.pctB), backgroundColor: '#2E75B6', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)}%` } }
      },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#F0F0F0' } },
        x: { grid: { display: false } }
      }
    }
  });

  gridEl.innerHTML = linhasDinamicas.map(r => {
    const cls  = r.delta > 0.05 ? 'up' : r.delta < -0.05 ? 'down' : 'flat';
    const seta = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '—';
    const sinal = r.delta > 0 ? '+' : '';
    return `<div class="kpi-card">
      <div class="kpi-label">${esc(r.sr.replace('SR ', ''))}</div>
      <div class="kpi-value" style="font-size:22px">${fmtNum(r.pctB, 1)}%</div>
      <div class="kpi-sub">${esc(anoA)}: ${fmtNum(r.pctA, 1)}% Bom+Muito Bom</div>
      <div class="kpi-delta ${cls}">${seta} ${sinal}${fmtNum(r.delta, 1)} p.p.</div>
    </div>`;
  }).join('');

  const melhorDyn = [...linhasDinamicas].sort((a, b) => b.delta - a.delta)[0];
  const piorDyn   = [...linhasDinamicas].sort((a, b) => a.delta - b.delta)[0];
  const negativasDyn = linhasDinamicas.filter(r => r.delta < -0.05);
  const positivasDyn = linhasDinamicas.length - negativasDyn.length;
  let alertaDyn = '';
  if(negativasDyn.length === 1){
    const r = negativasDyn[0];
    alertaDyn = `A <strong>${esc(r.sr)}</strong> registrou queda de aproximadamente ${fmtNum(Math.abs(r.delta), 1)} pontos percentuais ` +
      `(a única regional com variação negativa, enquanto as demais ${positivasDyn} regionais melhoraram) — `;
  } else if(negativasDyn.length > 1){
    alertaDyn = `${negativasDyn.length} regionais (${negativasDyn.map(r => esc(r.sr)).join(', ')}) registraram queda no período — `;
  }
  narrEl.innerHTML =
    `<strong>Leitura:</strong> entre ${esc(anoA)} e ${esc(anoB)}, a <strong>${esc(melhorDyn.sr)}</strong> registrou a maior melhora em % Boa+Ótima ` +
    `(${melhorDyn.delta > 0 ? '+' : ''}${fmtNum(melhorDyn.delta, 1)} p.p., de ${fmtNum(melhorDyn.pctA, 1)}% para ${fmtNum(melhorDyn.pctB, 1)}%), ` +
    `enquanto a <strong>${esc(piorDyn.sr)}</strong> registrou a maior piora ` +
    `(${piorDyn.delta > 0 ? '+' : ''}${fmtNum(piorDyn.delta, 1)} p.p., de ${fmtNum(piorDyn.pctA, 1)}% para ${fmtNum(piorDyn.pctB, 1)}%).<br><br>` +
    `<strong>Nota metodológica:</strong> esta comparação mostra a variação observada entre os dois levantamentos mais recentes disponíveis, não uma tendência. ` +
    alertaDyn +
    `dois pontos no tempo não constituem série histórica; confirme metodologia e cobertura dos levantamentos antes de usar este dado em conclusões.`;
  return;

  const SR_ORDER_EVOL = ['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];
  const linhas = SR_ORDER_EVOL.map(sr => {
    const porAno = (regionaisRaw[sr] || {}).malha_por_ano || {};
    const d24 = porAno['2024'];
    const d25 = porAno['2025'];
    if(!d24 || !d25) return null;
    const pct24 = (d24.pct.bom_muito_bom || 0) * 100;
    const pct25 = (d25.pct.bom_muito_bom || 0) * 100;
    return { sr, pct24, pct25, delta: pct25 - pct24 };
  }).filter(Boolean);

  if(!linhas.length) return;

  makeChart(canvas, {
    type: 'bar',
    data: {
      labels: linhas.map(r => r.sr.replace('SR ', '')),
      datasets: [
        { label: '2024', data: linhas.map(r => r.pct24), backgroundColor: '#9DC3E6', borderRadius: 3 },
        { label: '2025', data: linhas.map(r => r.pct25), backgroundColor: '#2E75B6', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)}%` } }
      },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#F0F0F0' } },
        x: { grid: { display: false } }
      }
    }
  });

  gridEl.innerHTML = linhas.map(r => {
    const cls  = r.delta > 0.05 ? 'up' : r.delta < -0.05 ? 'down' : 'flat';
    const seta = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '—';
    const sinal = r.delta > 0 ? '+' : '';
    return `<div class="kpi-card">
      <div class="kpi-label">${esc(r.sr.replace('SR ', ''))}</div>
      <div class="kpi-value" style="font-size:22px">${fmtNum(r.pct25, 1)}%</div>
      <div class="kpi-sub">2024: ${fmtNum(r.pct24, 1)}% Bom+Muito Bom</div>
      <div class="kpi-delta ${cls}">${seta} ${sinal}${fmtNum(r.delta, 1)} p.p.</div>
    </div>`;
  }).join('');

  const melhor = [...linhas].sort((a, b) => b.delta - a.delta)[0];
  const pior   = [...linhas].sort((a, b) => a.delta - b.delta)[0];

  const negativas = linhas.filter(r => r.delta < -0.05);
  const positivas = linhas.length - negativas.length;
  let alertaSR = '';
  if(negativas.length === 1){
    const r = negativas[0];
    alertaSR = `A <strong>${esc(r.sr)}</strong> registrou queda de aproximadamente ${fmtNum(Math.abs(r.delta), 1)} pontos percentuais ` +
      `(a única regional com variação negativa, enquanto as demais ${positivas} regionais melhoraram) — `;
  } else if(negativas.length > 1){
    alertaSR = `${negativas.length} regionais (${negativas.map(r => esc(r.sr)).join(', ')}) registraram queda no período — `;
  }

  narrEl.innerHTML =
    `<strong>Leitura:</strong> entre 2024 e 2025, a <strong>${esc(melhor.sr)}</strong> registrou a maior melhora em % Boa+Ótima ` +
    `(${melhor.delta > 0 ? '+' : ''}${fmtNum(melhor.delta, 1)} p.p., de ${fmtNum(melhor.pct24, 1)}% para ${fmtNum(melhor.pct25, 1)}%), ` +
    `enquanto a <strong>${esc(pior.sr)}</strong> registrou a maior piora ` +
    `(${pior.delta > 0 ? '+' : ''}${fmtNum(pior.delta, 1)} p.p., de ${fmtNum(pior.pct24, 1)}% para ${fmtNum(pior.pct25, 1)}%).<br><br>` +
    `<strong>Nota metodológica:</strong> esta comparação mostra a variação observada entre os dois levantamentos, não uma tendência — dois pontos no tempo não constituem série histórica, e ainda não há confirmação de que os levantamentos SAM de 2024 e 2025 seguiram exatamente a mesma metodologia e cobertura de trechos. ` +
    alertaSR +
    `recomenda-se confirmar com o DER se essa variação reflete deterioração real da malha ou diferença de escopo/levantamento entre os dois anos, antes de usar este dado em conclusões.`;
}

function renderRegionalAlignmentCharts(){
  if(!malhaKm.length) return;
  const custoSorted = [...regionais].sort((a,b)=>b.lkm-a.lkm);
  makeChart(document.getElementById('chartCustoKm'),{
    type:'bar',
    data:{
      labels: custoSorted.map(r=>r.sr.replace('SR ','')),
      datasets:[{
        data: custoSorted.map(r=>r.lkm),
        backgroundColor: custoSorted.map(r=>SR_COLORS[r.sr]||'#888'),
        borderRadius:3
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>` R$ ${fmtNum(ctx.raw)}/km/ano de rede total`}}
      },
      scales:{
        x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v>=1000?fmtNum(v/1000,0)+'k':v},title:{display:true,text:'R$/km/ano',font:{size:11}}},
        y:{grid:{display:false}}
      }
    }
  });
}

// =======================================================
// CONTRATOS
// =======================================================

const SR_DISPLAY = {
  'SR LESTE':'SR Leste','SR CAMPOS GERAIS':'SR Campos Gerais',
  'SR NORTE':'SR Norte','SR NOROESTE':'SR Noroeste','SR OESTE':'SR Oeste',
  'SR Leste':'SR Leste','SR Campos Gerais':'SR Campos Gerais',
  'SR Norte':'SR Norte','SR Noroeste':'SR Noroeste','SR Oeste':'SR Oeste'
};

const TIPO_COLORS = {
  'PROCONSERVA':'#2E75B6','COP':'#70AD47','INTEGRA':'#1F4E79',
  'CREMEP':'#FFC000','EMERGENCIAL':'#C00000'
};

// Rampa sequencial de um hue só (mesmo magenta do segmento RP, #e87ba4) para o
// ranking de concentração de RP (Fase 5) — claro→escuro mede intensidade
// ("quanto"), distinto da cor sólida de identidade ("isso é RP") do gráfico de
// execução. Endpoints validados com scripts/validate_palette.js do skill de
// dataviz: o extremo escuro original (derivado só escurecendo #e87ba4) batia
// ΔE 14,5 contra o vermelho já usado no painel (#C00000 — SR Norte/EMERGENCIAL/
// sinal alto do SPC), abaixo do piso de 15. #570f2a mantém o mesmo hue
// (337°) mas escurece mais, e limpa ΔE 23,4 contra #C00000.
const RP_RANK_RAMP_LIGHT = [249, 220, 231]; // #f9dce7
const RP_RANK_RAMP_DARK  = [87, 15, 42];    // #570f2a
// Domínio fixo (não normalizado pelo min/max do que está sendo exibido no
// momento) — senão a mesma cor passaria a significar níveis de pressão
// diferentes conforme o usuário troca o filtro de regional/tipo/status. 80%
// dá folga acima do máximo observado na base (~74,6%).
const RP_RANK_DOMAIN_MAX = 0.8;

function rpRankRamp(t){
  const c = Math.max(0, Math.min(1, t));
  const rgb = RP_RANK_RAMP_LIGHT.map((l, i) => Math.round(l + (RP_RANK_RAMP_DARK[i] - l) * c));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

let chContSR = null, chContTipo = null, chRpRanking = null;
let contratoFiltersReady = false;

// Toggle escopado ao card do chartContSR — 'ano' (padrão, comportamento
// existente) ou 'comparar' (2024 x 2025 lado a lado). Não interfere com
// #filtroAnoMalha nem com nenhum outro seletor global: KPIs, ranking, tabela e
// divergências continuam só no ano do seletor global, sempre.
let execChartMode = 'ano';
const SR_LABELS_SHORT = SR_ORDER.map(s => SR_DISPLAY[s].replace('SR ', ''));

function normalizaContrato(c, fallbackYear){
  return {
    ano: String(c.ano || c.Ano || c.year || fallbackYear || ''),
    contrato: c.contrato || c.Contrato || '',
    empenhado: Number(c.empenhado || c.Empenhado || 0),
    liquidado: Number(c.liquidado || c['Liquidado(R$)'] || c.liquidado_rs || 0),
    pago: Number(c.pago || c.Pago || 0),
    sr: SR_DISPLAY[c.sr] || c.sr || '',
    tipo: String(c.tipo || c['TIPO CONTRATO'] || '').toUpperCase(),
    fonte: c.fonte || 'Contratos DOPSR1 por Regional.xlsx',
  };
}

function buildContratosPorAno(d){
  const byYear = {};
  const sourceByYear = d.contratos_dopsr1_por_ano || {};
  Object.keys(sourceByYear).forEach(year => {
    byYear[String(year)] = (sourceByYear[year] || []).map(c => normalizaContrato(c, year));
  });
  return byYear;
}

// =======================================================
// RP / EXERCÍCIO ANTERIOR — cruzamento com rp_reconciliado.json
// =======================================================
// rp_reconciliado.contratos usa sr sem prefixo ("Leste"); contratosPorAno usa
// sr já normalizado pelo SR_DISPLAY ("SR Leste"). Tira o prefixo dos dois
// lados para a chave bater.
function normalizaSrParaChaveRp(sr){
  return String(sr || '').replace(/^SR\s+/i, '').trim();
}

function chaveRp(contrato, sr, ano){
  return `${contrato}|${normalizaSrParaChaveRp(sr)}|${ano}`;
}

// Indexa rp_reconciliado.contratos por contrato+sr+ano. Não dá para indexar só
// por contrato+ano: o mesmo número de contrato pode aparecer em regionais
// diferentes com status distinto (ex.: CO257/2012DOP e CO133/2021DOP em 2024 —
// ver _meta do JSON e nota de divergências).
function indexarRpReconciliado(data){
  rpReconciliado = data || { contratos: [], regionais: [], _meta: null };
  rpIndex = new Map();
  (rpReconciliado.contratos || []).forEach(r => {
    rpIndex.set(chaveRp(r.contrato, r.sr, r.ano), r);
  });
}

// Cruza contratosPorAno (fonte: Contratos DOPSR1 por Regional.xlsx / Empenhos
// CGM) com rpReconciliado.contratos (fonte: Painel_DER_Empenho + RP.xlsx) pela
// chave contrato+sr+ano. Contratos com status 'so_rp' em rp_reconciliado não
// têm empenhado/pago na base do painel (não existem em
// contratos_dopsr1_por_ano) e por isso não entram em contratosPorAno mesmo
// depois do cruzamento — ficam em rpSemContratoBase para a seção de
// divergências (Fase 6). Idempotente: pode ser chamada de novo sem duplicar
// nada, já que só atribui campos nos objetos existentes.
function attachRpAContratos(){
  const usados = new Set();
  Object.keys(contratosPorAno).forEach(ano => {
    (contratosPorAno[ano] || []).forEach(c => {
      const chave = chaveRp(c.contrato, c.sr, Number(ano));
      const rp = rpIndex.get(chave);
      if(rp){
        usados.add(chave);
        c.exercicioCorrente = rp.exercicio_corrente;
        c.rp = rp.rp;
        c.totalComRp = rp.total_com_rp;
        c.statusRp = rp.status;
        c.pctRp = rp.pct;
      } else {
        c.exercicioCorrente = null;
        c.rp = null;
        c.totalComRp = null;
        c.statusRp = null; // não encontrado nem em rp_reconciliado — diferente de 'so_base'
        c.pctRp = null;
      }
    });
  });
  rpSemContratoBase = (rpReconciliado.contratos || []).filter(r => !usados.has(chaveRp(r.contrato, r.sr, r.ano)));

  console.group('[RP] rp_reconciliado.json cruzado com contratosPorAno');
  Object.keys(contratosPorAno).sort().forEach(ano => {
    const lista = contratosPorAno[ano] || [];
    const casado = lista.filter(c => c.statusRp === 'casado').length;
    const soBase = lista.filter(c => c.statusRp === 'so_base').length;
    const semRp  = lista.filter(c => c.statusRp == null).length;
    // "sem linha em rp_reconciliado.json" = falha do JOIN (chave contrato+sr+ano não
    // encontrada em rpIndex) — não confundir com so_base, que É uma linha encontrada,
    // só que marcada upstream (na planilha) como sem RP calculável.
    console.log(`${ano}: ${lista.length} contratos — ${casado} casado, ${soBase} so_base, ${semRp} sem linha em rp_reconciliado.json (falha de join, chave nao encontrada)`);
  });
  console.log('Contratos só na planilha de RP (sem empenhado/pago na base do painel):',
    rpSemContratoBase.length, rpSemContratoBase.map(r => `${r.contrato} (${r.sr}, ${r.ano})`));
  console.groupEnd();
}

function contratoStatusText(c){
  const pct = c.empenhado > 0 ? c.liquidado / c.empenhado * 100 : 0;
  if(pct >= 90) return 'Alta execução';
  if(pct >= 70) return 'Execução moderada';
  return 'Baixa execução';
}

function normalizeFilterText(txt){
  return (txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getContratoFilterValues(){
  appState.filters.contratos = {
    busca: normalizeFilterText(document.getElementById('filtroContratoBusca')?.value || ''),
    regiao: document.getElementById('filtroContratoRegiao')?.value || '',
    tipo: document.getElementById('filtroContratoTipo')?.value || '',
    status: document.getElementById('filtroContratoStatus')?.value || ''
  };
  return appState.filters.contratos;
}

// Extraído de getContratosFiltrados() para poder aplicar os mesmos critérios
// de filtro (regiao/tipo/status/busca) a uma lista de outro ano — usado pelo
// comparativo 2024×2025 no kpi-sub de RP (ver renderContratos), que precisa
// comparar o mesmo recorte no ano corrente vs. no outro ano, não os totais
// brutos de cada um.
function filtrarContratosPorCriterios(lista, f){
  return lista.filter(c=>{
    const srTxt = SR_DISPLAY[c.sr] || c.sr || '';
    const tipoTxt = c.tipo || '';
    const statusTxt = contratoStatusText(c);
    return (!f.busca || normalizeFilterText(c.contrato).includes(f.busca)) &&
      (!f.regiao || srTxt === f.regiao) &&
      (!f.tipo || tipoTxt === f.tipo) &&
      (!f.status || statusTxt === f.status);
  });
}

function getContratosFiltrados(){
  const f = getContratoFilterValues();
  return filtrarContratosPorCriterios(contratos, f);
}

function fillContratoSelect(select, values, defaultLabel){
  if(!select) return;
  const current = select.value;
  const unique = Array.from(new Set(values.filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt'));
  select.innerHTML = `<option value="">${esc(defaultLabel)}</option>` +
    unique.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if(unique.includes(current)) select.value = current;
}

function populateContratoFilterOptions(){
  fillContratoSelect(
    document.getElementById('filtroContratoRegiao'),
    contratos.map(c=>SR_DISPLAY[c.sr] || c.sr),
    'Todas as regiões'
  );
  fillContratoSelect(
    document.getElementById('filtroContratoTipo'),
    contratos.map(c=>c.tipo),
    'Todos os tipos'
  );
  fillContratoSelect(
    document.getElementById('filtroContratoStatus'),
    contratos.map(c=>contratoStatusText(c)),
    'Todos os status'
  );
}

// Ordenação da tabela de contratos (clique no th). null/undefined (contratos
// sem RP calculável) vai sempre para o fim da lista, nas duas direções — não
// compete por posição com valores reais (inclusive 0, que é um RP calculado
// e confirmado, diferente de "não sabemos"). Ver rpStatusFlag() para o motivo
// de pctRp/rp virem null para so_base/so_rp/sem-linha.
let contratoSort = { key: null, dir: 1 };

const CONTRATO_SORT_TIPO = {
  contrato: 'text', sr: 'text', tipo: 'text', statusText: 'text',
  empenhado: 'num', liquidado: 'num', pago: 'num', rp: 'num', pctRp: 'num'
};

function valorOrdenavelContrato(c, key){
  return key === 'statusText' ? contratoStatusText(c) : c[key];
}

function ordenarContratos(data){
  if(!contratoSort.key) return data;
  const key = contratoSort.key, dir = contratoSort.dir;
  const tipo = CONTRATO_SORT_TIPO[key] || 'text';
  return [...data].sort((a,b)=>{
    const va = valorOrdenavelContrato(a, key), vb = valorOrdenavelContrato(b, key);
    const aNull = va == null, bNull = vb == null;
    if(aNull && bNull) return 0;
    if(aNull) return 1;  // sempre por último, independente de dir
    if(bNull) return -1;
    return tipo === 'text' ? dir * String(va).localeCompare(String(vb), 'pt') : dir * (va - vb);
  });
}

function atualizarCabecalhoOrdenacaoContratos(){
  document.querySelectorAll('#tblContratos thead th[data-key]').forEach(th=>{
    const arrow = th.querySelector('.sort-arrow');
    if(!arrow) return;
    arrow.textContent = th.dataset.key === contratoSort.key ? (contratoSort.dir === 1 ? '▲' : '▼') : '';
  });
}

function setupContratoTableFilters(){
  populateContratoFilterOptions();
  if(contratoFiltersReady) return;

  ['filtroContratoBusca','filtroContratoRegiao','filtroContratoTipo','filtroContratoStatus'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener(id === 'filtroContratoBusca' ? 'input' : 'change', ()=>{
      renderContratos(getContratosFiltrados());
    });
  });

  document.querySelectorAll('#tblContratos thead th[data-key]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.key;
      if(contratoSort.key === key) contratoSort.dir *= -1;
      else { contratoSort.key = key; contratoSort.dir = 1; }
      atualizarCabecalhoOrdenacaoContratos();
      renderTblContratos(getContratosFiltrados());
    });
  });

  const clearBtn = document.getElementById('limparFiltrosContrato');
  if(clearBtn){
    clearBtn.addEventListener('click', ()=>{
      const busca = document.getElementById('filtroContratoBusca');
      const regiao = document.getElementById('filtroContratoRegiao');
      const tipo = document.getElementById('filtroContratoTipo');
      const status = document.getElementById('filtroContratoStatus');
      if(busca) busca.value = '';
      if(regiao) regiao.value = '';
      if(tipo) tipo.value = '';
      if(status) status.value = '';
      renderContratos(contratos);
    });
  }

  const btnMostrarTodas = document.getElementById('btnMostrarTodasContSR');
  if(btnMostrarTodas){
    btnMostrarTodas.addEventListener('click', ()=>{
      if(!chContSR) return;
      chContSR.data.datasets.forEach((_,i)=>{
        chContSR.getDatasetMeta(i).hidden = false;
      });
      chContSR.update();
    });
  }

  document.querySelectorAll('#execModeToggle button[data-mode]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.mode === execChartMode) return;
      execChartMode = btn.dataset.mode;
      document.querySelectorAll('#execModeToggle button[data-mode]').forEach(b=>{
        b.classList.toggle('active', b === btn);
      });
      renderContratos(getContratosFiltrados());
    });
  });

  contratoFiltersReady = true;
}

function updateContratoFilterCount(qtd){
  const countEl = document.getElementById('contratoFilterCount');
  if(countEl) countEl.textContent = `Exibindo ${qtd} de ${contratos.length} contratos`;
  const empty = document.getElementById('contratoFilterEmpty');
  if(empty) empty.hidden = qtd > 0;
}

// Dispatcher do gráfico Empenhado/Liquidado/Pago por SR — decide entre o modo
// 'ano' (comportamento original, intacto) e 'comparar' (2024x2025), e ajusta a
// nota e o botão "Mostrar todas" (que só faz sentido no modo 'ano', onde há
// legenda clicável — em 'comparar' a legenda fica oculta).
function renderExecChart(data){
  const btnTodas = document.getElementById('btnMostrarTodasContSR');
  const note = document.getElementById('execModeNote');

  if(execChartMode === 'comparar'){
    if(btnTodas) btnTodas.hidden = true;
    if(note){
      note.hidden = false;
      note.innerHTML =
        'Modo comparação mostra apenas a composição do Liquidado (Exercício Corrente + RP). ' +
        'Empenhado e Pago voltam ao trocar para "Ano selecionado". ' +
        'Comparando 2024 x 2025 — <strong>ignora o seletor de ano acima</strong> (mantém os filtros de regional/tipo/status/busca da tabela abaixo). ' +
        'Em cada par de barras, a da esquerda é 2024 e a da direita é 2025 — passe o mouse para confirmar.';
    }
    renderExecChartCompare();
  } else {
    if(btnTodas) btnTodas.hidden = false;
    if(note){ note.hidden = true; note.innerHTML = ''; }
    renderExecChartAno(data);
  }
}

// Modo 'ano' — comportamento original da Fase 3, inalterado: Empenhado /
// Liquidado (Exercício Corrente + RP) / Pago por SR, no ano do seletor global.
function renderExecChartAno(data){
  const empBySR  = SR_ORDER.map(sr=>data.filter(c=>c.sr===sr).reduce((a,c)=>a+c.empenhado,0));
  const liqBySR  = SR_ORDER.map(sr=>data.filter(c=>c.sr===sr).reduce((a,c)=>a+c.liquidado,0));
  const pagBySR  = SR_ORDER.map(sr=>data.filter(c=>c.sr===sr).reduce((a,c)=>a+(c.pago||0),0));
  // RP = soma de rp só dos contratos 'casado' (so_base/so_rp não têm RP calculável).
  // Corrente = liqBySR (o Liquidado já existente na base, inalterado) — RP é
  // somado POR CIMA, não recortado de dentro dele. RP é dinheiro adicional (restos
  // a pagar de anos anteriores, liquidados no ano corrente), então o total
  // empilhado (Corrente+RP) fica maior que liqBySR sozinho quando há RP — nunca
  // igual. O liquidado de contratos so_base (RP desconhecido) continua dentro do
  // segmento Corrente — por isso esses contratos precisam aparecer na lista de
  // divergências (Fase 6).
  const rpBySR       = SR_ORDER.map(sr=>data.filter(c=>c.sr===sr && c.statusRp==='casado').reduce((a,c)=>a+(c.rp||0),0));
  const correnteBySR = liqBySR;
  const totalLiqComRpBySR = correnteBySR.map((liq,i)=>liq + rpBySR[i]);

  chContSR = makeChart(document.getElementById('chartContSR'),{
    type:'bar',
    data:{
      labels: SR_LABELS_SHORT,
      datasets:[
        { label:'Empenhado', data:empBySR, backgroundColor:'#BDD7EE', borderRadius:3, stack:'empenhado' },
        { label:'Exercício Corrente', data:correnteBySR, backgroundColor:'#2E75B6', stack:'liquidado',
          borderRadius:{topLeft:0,topRight:0,bottomLeft:3,bottomRight:3}, borderSkipped:false,
          // Gap de 2px na cor da superfície do card (#fff) na costura com RP —
          // não é um contorno ao redor do segmento (isso seria um traço de dado
          // falso), é só a borda superior, imitando o espaçador de 2px que separa
          // segmentos empilhados/barras adjacentes.
          borderWidth:{top:2,left:0,right:0,bottom:0}, borderColor:'#fff' },
        { label:'RP', data:rpBySR, backgroundColor:'#e87ba4', stack:'liquidado',
          borderRadius:{topLeft:3,topRight:3,bottomLeft:0,bottomRight:0}, borderSkipped:false },
        { label:'Pago',      data:pagBySR, backgroundColor:'#1F4E79', borderRadius:3, stack:'pago' }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      // Clique numa barra filtra a tabela de contratos abaixo pela SR clicada,
      // reaproveitando o filtro #filtroContratoRegiao já existente (mesmo
      // caminho de um usuário trocando o select manualmente).
      onClick(evt, elements){
        if(!elements.length) return;
        const sr = SR_ORDER[elements[0].index];
        const select = document.getElementById('filtroContratoRegiao');
        if(!select || !sr) return;
        select.value = sr;
        select.dispatchEvent(new Event('change'));
        document.getElementById('tblContratos')?.scrollIntoView({behavior:'smooth', block:'start'});
      },
      onHover(evt, elements){
        if(evt.native) evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins:{
        legend:{
          position:'bottom',
          labels:{font:{size:11},padding:12},
          onClick(evt, legendItem, legend){
            // Toggle independente por série
            const idx  = legendItem.datasetIndex;
            const meta = legend.chart.getDatasetMeta(idx);
            meta.hidden = !meta.hidden;
            legend.chart.update();
          }
        },
        tooltip:{callbacks:{
          label:ctx=>` ${ctx.dataset.label}: ${fmtCur(ctx.raw)}`,
          // Para os segmentos do Liquidado (Corrente/RP), mostra o total do SR
          // no rodapé — Corrente+RP, que agora é maior que liqBySR sozinho
          // quando há RP (RP é somado por cima, não recortado de dentro).
          footer:items=>{
            const item = items[0];
            if(!item || item.dataset.stack !== 'liquidado') return '';
            const idx = item.dataIndex;
            return `Total Liquidado: ${fmtCur(totalLiqComRpBySR[idx])}`;
          }
        }}
      },
      scales:{
        x:{grid:{display:false}},
        y:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v>=1e6?fmtNum(v/1e6,0)+' M':v}}
      }
    }
  });
}

// Modo 'comparar' — 2024 x 2025 lado a lado, só Exercício Corrente + RP
// (Empenhado/Pago somem, ver nota no card). Recalcula os dois anos a partir de
// contratosPorAno + rpIndex já carregados (nunca de totais agregados prontos
// de rp_reconciliado.regionais, que não respeitam filtro), aplicando os MESMOS
// critérios de filtro (regiao/tipo/status/busca) que já existem — tudo exceto
// o ano, que aqui é sempre os dois. Mesma regra de todo o resto: RP e %RP só
// somam contratos 'casado'. Reaproveita filtrarContratosPorCriterios(), a
// mesma função usada no comparativo de ano do KPI (Fase 7 enxuta) — um único
// lugar calculando "outro ano com os mesmos filtros", não duas versões que
// podem divergir.
function renderExecChartCompare(){
  const canvas = document.getElementById('chartContSR');
  if(!canvas) return;

  const f = getContratoFilterValues();
  const anos = Object.keys(contratosPorAno).sort();
  const porAno = {};
  anos.forEach(ano=>{
    const filtrado = filtrarContratosPorCriterios(contratosPorAno[ano] || [], f);
    const liqBySR = SR_ORDER.map(sr=>filtrado.filter(c=>c.sr===sr).reduce((a,c)=>a+c.liquidado,0));
    const rpBySR  = SR_ORDER.map(sr=>filtrado.filter(c=>c.sr===sr && c.statusRp==='casado').reduce((a,c)=>a+(c.rp||0),0));
    // Corrente = liqBySR inalterado; RP é somado por cima (ver mesma correção em
    // renderExecChartAno acima) — o total do par de barras é correnteBySR+rpBySR,
    // não liqBySR sozinho.
    const correnteBySR = liqBySR;
    const totalBySR = correnteBySR.map((liq,i)=>liq + rpBySR[i]);
    porAno[ano] = { liqBySR, rpBySR, correnteBySR, totalBySR };
  });

  const datasets = [];
  anos.forEach(ano=>{
    datasets.push({
      label:`Exercício Corrente ${ano}`, data:porAno[ano].correnteBySR, backgroundColor:'#2E75B6',
      stack:ano, categoryPercentage:0.62, barPercentage:0.86,
      borderRadius:{topLeft:0,topRight:0,bottomLeft:3,bottomRight:3}, borderSkipped:false,
      borderWidth:{top:2,left:0,right:0,bottom:0}, borderColor:'#fff'
    });
    datasets.push({
      label:`RP ${ano}`, data:porAno[ano].rpBySR, backgroundColor:'#e87ba4',
      stack:ano, categoryPercentage:0.62, barPercentage:0.86,
      borderRadius:{topLeft:3,topRight:3,bottomLeft:0,bottomRight:0}, borderSkipped:false
    });
  });

  chContSR = makeChart(canvas,{
    type:'bar',
    data:{ labels: SR_LABELS_SHORT, datasets },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title:items=>{
            const year = items[0].dataset.label.split(' ').pop();
            return `${items[0].label} — ${year}`;
          },
          label:item=>{
            const kind = item.dataset.label.includes('RP') ? 'RP' : 'Exercício corrente';
            return ` ${kind}: ${fmtCur(item.raw)}`;
          },
          // Mesmo padrão do mockup_rp.html original: footer com o total do
          // ano/SR e o %RP — total = Corrente+RP (totalBySR), não liqBySR
          // sozinho, e o %RP usa esse mesmo total como denominador
          // (rp/(exercicio_corrente+rp), igual ao resto do painel — Fase 5).
          footer:items=>{
            const item = items[0];
            const year = item.dataset.label.split(' ').pop();
            const idx = item.dataIndex;
            const total = porAno[year].totalBySR[idx];
            const rp = porAno[year].rpBySR[idx];
            const pct = total > 0 ? (rp/total*100) : 0;
            return `Total ${year}: ${fmtCur(total)}  (RP: ${fmtNum(pct,1)}%)`;
          }
        }}
      },
      scales:{
        x:{grid:{display:false}},
        y:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v>=1e6?fmtNum(v/1e6,0)+' M':v}}
      }
    }
  });
}

function renderContratos(data = contratos){
  if(!contratos.length) return;
  setupContratoTableFilters();
  updatePeriodoBadges();

  // RP / Exercício Anterior — composição do Liquidado. Soma só contratos com
  // statusRp === 'casado': so_base/so_rp/null não têm RP calculável (ver _meta
  // de rp_reconciliado.json) e ficam de fora tanto do numerador (rp) quanto do
  // denominador (totalComRp), senão o % fica distorcido por liquidado de
  // contrato sem RP mensurável. Reage a `data`, que já vem filtrada por
  // ano/regional/tipo/status pela chamada em getContratosFiltrados().
  const casadoRp = data.filter(c => c.statusRp === 'casado');
  const totalRp  = casadoRp.reduce((a,c)=>a+(c.rp||0),0);
  const totalComRpCasado = casadoRp.reduce((a,c)=>a+(c.totalComRp||0),0);

  const totalEmp  = data.reduce((a,c)=>a+c.empenhado,0);
  // Total Liquidado do KPI = liquidado da base (inalterado, todos os contratos)
  // + RP somado por cima (totalRp, só 'casado') — mesma correção do chartContSR
  // acima. Cálculo duplicado: este KPI soma direto sobre `data`, não reaproveita
  // renderExecChartAno, então a correção de lá não se propaga sozinha aqui.
  const totalLiqBase = data.reduce((a,c)=>a+c.liquidado,0);
  const totalLiq  = totalLiqBase + totalRp;
  const pctExec   = totalEmp>0?(totalLiq/totalEmp*100):0;
  document.getElementById('kpi-cont-total').textContent = data.length;
  document.getElementById('kpi-cont-emp').innerHTML     = fmtR(totalEmp);
  document.getElementById('kpi-cont-liq').innerHTML     = fmtR(totalLiq);
  document.getElementById('kpi-cont-exec').textContent  = fmtNum(pctExec,1)+'%';
  const execCard = document.getElementById('kpi-cont-exec-card');
  if(execCard) execCard.classList.toggle('alert', pctExec<70);
  const pctRpCasado = totalComRpCasado>0 ? (totalRp/totalComRpCasado*100) : 0;

  // Comparativo com o outro ano disponível — versão enxuta no lugar da Fase 7
  // original (toggle + gráfico pareado): não cria seletor/infraestrutura
  // paralela, só mais um texto na mesma linha que já existe, reagindo ao MESMO
  // seletor global. Aplica os MESMOS critérios de filtro (regiao/tipo/status/
  // busca) ao outro ano, senão a comparação mistura recortes diferentes.
  let compTxt = '';
  const anoAtual = appState.selectedFinancialYear;
  const outroAno = Object.keys(contratosPorAno).find(a => a !== anoAtual);
  if(casadoRp.length && outroAno){
    const f = getContratoFilterValues();
    const outroCasado = filtrarContratosPorCriterios(contratosPorAno[outroAno] || [], f)
      .filter(c => c.statusRp === 'casado');
    const outroTotalComRp = outroCasado.reduce((a,c)=>a+(c.totalComRp||0),0);
    if(outroCasado.length && outroTotalComRp > 0){
      const outroPct = outroCasado.reduce((a,c)=>a+(c.rp||0),0) / outroTotalComRp * 100;
      const delta = pctRpCasado - outroPct;
      const seta = delta >= 0 ? '▲' : '▼';
      compTxt = ` — ${seta} ${fmtNum(Math.abs(delta),1)} p.p. vs. ${esc(outroAno)}`;
    }
  }

  const liqRpSub = document.getElementById('kpi-cont-liq-rp');
  if(liqRpSub){
    // O % é sobre o subconjunto 'casado' (totalComRpCasado), não sobre o Liquidado
    // total exibido acima (totalLiq, que também soma o liquidado de contratos
    // so_base/so_rp sem RP calculável, além do RP dos 'casado') — os dois números
    // partem de universos diferentes, então o asterisco + title deixam isso
    // explícito em vez de sugerir "26,4 / totalLiq".
    liqRpSub.innerHTML = casadoRp.length
      ? `${fmtR(totalRp)} de RP (<span title="% sobre o liquidado dos ${casadoRp.length} contratos casados (${fmtR(totalComRpCasado)}) — não sobre os ${fmtR(totalLiq)} do card acima, que também inclui o liquidado de contratos sem RP calculável (so_base/so_rp)">${fmtNum(pctRpCasado,1)}%*</span>${compTxt})`
      : '';
  }

  // Destrói instâncias anteriores antes de recriar
  if(chContSR)  { chContSR.destroy();  chContSR  = null; }
  if(chContTipo){ chContTipo.destroy(); chContTipo = null; }

  renderExecChart(data);

  // Chart 2 — Liquidado por tipo (barras horizontais, ordenado desc)
  const tiposAtivos = Object.keys(TIPO_COLORS).filter(t=>data.some(c=>c.tipo===t));
  const tipoLiqMap  = tiposAtivos.map(t=>({
    tipo:t,
    liq: data.filter(c=>c.tipo===t).reduce((a,c)=>a+c.liquidado,0)
  })).sort((a,b)=>b.liq-a.liq);

  chContTipo = makeChart(document.getElementById('chartContTipo'),{
    type:'bar',
    data:{
      labels: tipoLiqMap.map(t=>t.tipo),
      datasets:[{
        data: tipoLiqMap.map(t=>t.liq),
        backgroundColor: tipoLiqMap.map(t=>TIPO_COLORS[t.tipo]||'#888'),
        borderRadius:3
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>` Liquidado: ${fmtCur(ctx.raw)}`}}
      },
      scales:{
        x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v>=1e6?fmtNum(v/1e6,0)+' M':v}},
        y:{grid:{display:false}}
      }
    }
  });

  renderRpRanking(data);
  renderTblContratos(data);
  renderRpDivergencias();
  renderSRTipoMatrix();
  updateContratoFilterCount(data.length);
}

// Fase 6 — Divergências: ao contrário da Fase 4 (onde só 'so_base' podia
// ocorrer, porque so_rp nunca entra em contratosPorAno), aqui as duas
// categorias aparecem juntas pela primeira vez — e são operacionalmente
// diferentes: so_base = achamos o contrato, falta o RP (mais brando, pode ser
// só planilha incompleta); so_rp = contrato nem está na base do painel, só na
// planilha do DER (mais grave — reclassificação, encerramento ou erro de
// cadastro). Por isso dois tratamentos visuais distintos aqui (badge + texto),
// não o ícone único da Fase 4 — usar um sinal genérico esconderia exatamente a
// distinção que é o motivo desta seção existir. Escopo só por ano (seletor
// global), sem os filtros de regional/tipo/status/busca da tabela de
// contratos — a lista de divergências é por definição sobre TODOS os
// contratos do ano, não um recorte.
function displaySrRp(sr){
  return String(sr || '').startsWith('SR ') ? sr : `SR ${sr}`;
}

function renderRpDivergencias(){
  const ano = appState.selectedFinancialYear;
  const countBadge = document.getElementById('rpDivergenciasCount');
  const listEl = document.getElementById('rpDivergenciasList');
  if(!listEl || !ano) return;

  const soBase = (contratosPorAno[ano] || []).filter(c => c.statusRp !== 'casado');
  const soRp = rpSemContratoBase.filter(r => String(r.ano) === String(ano));
  const total = soBase.length + soRp.length;

  if(countBadge) countBadge.textContent = `${total} em ${ano}`;

  const itemSoBase = c => {
    const msg = c.statusRp === 'so_base'
      ? `Consta na base de exercício corrente (${esc(displaySrRp(c.sr))}, ${esc(c.ano)}) com ${fmtRF(c.liquidado)} liquidado, mas não aparece na planilha de Pagamentos com RP enviada pelo DER — confirmar se o contrato foi encerrado ou reclassificado.`
      : `Consta na base de exercício corrente (${esc(displaySrRp(c.sr))}, ${esc(c.ano)}) com ${fmtRF(c.liquidado)} liquidado, mas sem correspondência em rp_reconciliado.json (nem 'casado' nem 'so_base' — falha de join a investigar, ver console).`;
    return `<div class="note warn note-compact disc-item">
      <span class="badge b-yellow">⚠ Só na base</span>
      <span><strong>${esc(c.contrato)}</strong> — ${msg}</span>
    </div>`;
  };

  const itemSoRp = r => {
    const msg = `Consta na planilha de Pagamentos com RP (${esc(displaySrRp(r.sr))}, ${esc(r.ano)}) com ${fmtRF(r.total_com_rp)} liquidado, mas não existe na base de exercício corrente do painel (Contratos DOPSR1 por Regional.xlsx / Empenhos CGM) — todo o valor pode ser RP/exercício anterior, ou o contrato foi reclassificado/encerrado sem entrar nessa base. Confirmar com o DER.`;
    return `<div class="note critical note-compact disc-item">
      <span class="badge b-red">✕ Só na planilha c/ RP</span>
      <span><strong>${esc(r.contrato)}</strong> — ${msg}</span>
    </div>`;
  };

  listEl.innerHTML = total
    ? soBase.map(itemSoBase).join('') + soRp.map(itemSoRp).join('')
    : `<p class="chart-source">Nenhuma divergência para ${esc(ano)} — todos os contratos casaram entre as duas bases.</p>`;

  // Resumo fixo por ano (não precisa de toggle/interatividade) — útil para
  // mostrar se a qualidade da reconciliação melhorou de um ano pro outro.
  const resumoEl = document.getElementById('rpDivergenciasResumoAnos');
  if(resumoEl){
    const partes = Object.keys(contratosPorAno).sort().map(a=>{
      const sb = (contratosPorAno[a] || []).filter(c => c.statusRp !== 'casado').length;
      const sr = rpSemContratoBase.filter(r => String(r.ano) === String(a)).length;
      const t = sb + sr;
      if(!t) return `Em ${esc(a)}: nenhuma divergência`;
      const sub = [sb ? `${sb} só na base` : null, sr ? `${sr} só no RP` : null].filter(Boolean).join(' + ');
      return `Em ${esc(a)}: ${t} divergência${t===1?'':'s'} (${sub})`;
    });
    resumoEl.textContent = partes.join(' · ');
  }
}

// Fase 5 — ranking de concentração de RP: top 8-10 contratos 'casado' por %RP,
// no recorte já filtrado (ano do seletor global + regional/tipo/status/busca
// atuais), mesma `data` que já alimenta KPIs/gráfico de execução/tabela.
function renderRpRanking(data){
  const canvas = document.getElementById('chartRpRanking');
  if(!canvas) return;

  const legendRamp = document.getElementById('rpRankLegendRamp');
  if(legendRamp) legendRamp.style.background = `linear-gradient(90deg, ${rpRankRamp(0)}, ${rpRankRamp(1)})`;

  const top = data
    .filter(c => c.statusRp === 'casado' && c.pctRp != null)
    .sort((a,b) => b.pctRp - a.pctRp)
    .slice(0, 10);

  if(chRpRanking){ chRpRanking.destroy(); chRpRanking = null; }
  if(!top.length) return;

  const labels = top.map(c => `${c.contrato} — ${SR_DISPLAY[c.sr]||c.sr}`);
  const values = top.map(c => c.pctRp*100);
  // Cor por posição na escala FIXA (0–RP_RANK_DOMAIN_MAX), não pelo min/max do
  // `top` exibido no momento — ver comentário em RP_RANK_DOMAIN_MAX.
  const colors = top.map(c => rpRankRamp(c.pctRp / RP_RANK_DOMAIN_MAX));

  chRpRanking = makeChart(canvas, {
    type:'bar',
    data:{ labels, datasets:[{ data: values, backgroundColor: colors, borderRadius:3, barPercentage:0.72 }] },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          label:ctx=>{
            const c = top[ctx.dataIndex];
            return [` % RP: ${fmtNum(c.pctRp*100,1)}%`, ` RP: ${fmtRF(c.rp)}`, ` Total Liquidado c/ RP: ${fmtRF(c.totalComRp)}`];
          }
        }}
      },
      scales:{
        x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v+'%'},suggestedMax:RP_RANK_DOMAIN_MAX*100},
        y:{grid:{display:false}}
      }
    }
  });
}

function renderSRTipoMatrix(){
  const el = document.getElementById('tblSRTipo');
  if(!el || !contratos.length) return;

  const srs  = ['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];
  const tipos = Object.keys(TIPO_COLORS);
  const tipoLabel = {PROCONSERVA:'PROCONSERVA',COP:'COP',INTEGRA:'INTEGRA',CREMEP:'CREMEP',EMERGENCIAL:'Emergencial'};

  const cnt = {};
  srs.forEach(sr => { cnt[sr] = {}; tipos.forEach(t => { cnt[sr][t] = 0; }); });
  contratos.forEach(c => { if(cnt[c.sr] && cnt[c.sr][c.tipo] !== undefined) cnt[c.sr][c.tipo]++; });

  const tiposAtivos = tipos.filter(t => srs.some(sr => cnt[sr][t] > 0));

  el.innerHTML =
    `<div class="chart-title" style="margin-bottom:8px">Distribuição de Contratos por SR e Tipo ${badgePeriodo('Dados ' + (appState.selectedFinancialYear || '—'))}</div>` +
    `<div class="table-wrap" style="margin-bottom:0"><table class="tbl-sr-tipo">` +
    `<thead><tr><th>SR</th>` +
    tiposAtivos.map(t=>`<th style="text-align:center"><span class="badge" style="background:${TIPO_COLORS[t]};color:#fff;font-size:11px">${tipoLabel[t]||t}</span></th>`).join('') +
    `<th style="text-align:center">Total</th></tr></thead><tbody>` +
    srs.map(sr=>{
      const total = tiposAtivos.reduce((a,t)=>a+cnt[sr][t],0);
      return `<tr>` +
        `<td><strong>${SR_DISPLAY[sr]||sr}</strong></td>` +
        tiposAtivos.map(t=>{
          const n = cnt[sr][t];
          return `<td style="text-align:center">${n>0?`<strong>${n}</strong>`:'<span style="color:#ccc">—</span>'}</td>`;
        }).join('') +
        `<td style="text-align:center;font-weight:600">${total}</td></tr>`;
    }).join('') +
    `</tbody></table></div>` +
    `<p class="chart-source"><strong>Fonte:</strong> Contratos DOPSR1 ${esc(appState.selectedFinancialYear || '—')}</p>`;
}

// Sinal discreto para linhas cujo RP não pôde ser calculado. so_rp NÃO aparece
// nesta tabela — esses contratos não têm empenhado/liquidado/pago na base do
// painel (não estão em contratos_dopsr1_por_ano) e por isso ficam só em
// rpSemContratoBase, listados na Fase 6. Aqui só ocorrem 'so_base' (achamos o
// contrato, mas não a linha de RP dele) e, defensivamente, null (nem chave
// encontrada em rp_reconciliado — não deveria acontecer em uso normal, ver log
// de attachRpAContratos). Decisão consciente: um ícone só, não dois — como
// so_rp está fora desta tabela, a distinção operacional so_base vs. so_rp que
// o mockup fazia com dois badges não se aplica aqui; o texto do title ainda
// diferencia os dois casos que podem ocorrer, pra quem passar o mouse.
function rpStatusFlag(c){
  if(c.statusRp === 'casado') return '';
  const msg = c.statusRp === 'so_base'
    ? 'RP não calculável: contrato não encontrado na planilha de Pagamentos com RP (Total Liquidado é o valor normal, sem composição de RP conhecida). Ver Divergências.'
    : 'RP não calculável: contrato sem correspondência em rp_reconciliado.json. Ver Divergências.';
  return ` <span class="rp-flag" title="${esc(msg)}">⚠</span>`;
}

function renderTblContratos(data){
  const tipoBadge = t=>{
    const cls={'PROCONSERVA':'b-blue','COP':'b-green','INTEGRA':'b-blue','CREMEP':'b-yellow','EMERGENCIAL':'b-red'};
    return `<span class="badge ${cls[t]||'b-gray'}">${esc(t)}</span>`;
  };
  const tblBody = document.getElementById('tbodyContratos');
  if(!tblBody) return;
  const sorted = ordenarContratos(data);
  tblBody.innerHTML = sorted.map(c=>{
    const pct = c.empenhado>0?c.liquidado/c.empenhado*100:0;
    const emgRow = c.tipo==='EMERGENCIAL'?'tr-emergencial':'';
    const pctRpPct = c.pctRp!=null ? c.pctRp*100 : null;
    return `<tr class="${emgRow}">
      <td><strong>${esc(c.contrato)}</strong></td>
      <td>${esc(SR_DISPLAY[c.sr]||c.sr)}</td>
      <td>${tipoBadge(c.tipo)}</td>
      <td>${fmtRF(c.empenhado)}</td>
      <td>${fmtRF(c.liquidado)}</td>
      <td>${fmtRF(c.pago)}</td>
      <td>${fmtRF(c.rp)}${rpStatusFlag(c)}</td>
      <td>${fmtP(pctRpPct)}</td>
      <td>${execBadge(pct)}</td>
    </tr>`;
  }).join('');
}

// Composição do gasto liquidado por tipo de intervenção contratual, por SR,
// cruzada com condição SAM (malhaLiqKm.pct_bom) — mesmo padrão visual do
// chartFig6 (barras empilhadas + linha em eixo secundário). Leitura de
// "esforço" distinta de investimento/km: descreve que tipo de trabalho está
// sendo feito, não quanto custa por km. Ver ressalva de causalidade reversa
// no HTML — SR com mais CREMEP/COP pode refletir necessidade estrutural
// pré-existente, não maior dedicação de recursos.
function renderTipoCondicao(){
  const canvas = document.getElementById('chartTipoCondicao');
  if(!canvas || !contratos.length || !malhaLiqKm.length) return;

  const TIPOS_INTERVENCAO_PROFUNDA = ['CREMEP', 'COP'];
  const TIPOS_INTERVENCAO_LEVE = ['PROCONSERVA'];
  const tipos = Object.keys(TIPO_COLORS);
  const tipoLabel = {PROCONSERVA:'PROCONSERVA', COP:'COP', INTEGRA:'INTEGRA', CREMEP:'CREMEP', EMERGENCIAL:'Emergencial'};

  const linhas = malhaLiqKm.map(m => {
    const contratosSR = contratos.filter(c => (SR_DISPLAY[c.sr] || c.sr) === m.sr);
    const liquidadoTotalSR = contratosSR.reduce((a, c) => a + c.liquidado, 0);
    const porTipo = {};
    tipos.forEach(t => {
      porTipo[t] = contratosSR.filter(c => c.tipo === t).reduce((a, c) => a + c.liquidado, 0);
    });
    const liquidadoProfundoSR     = TIPOS_INTERVENCAO_PROFUNDA.reduce((a, t) => a + porTipo[t], 0);
    const liquidadoLeveSR         = TIPOS_INTERVENCAO_LEVE.reduce((a, t) => a + porTipo[t], 0);
    const liquidadoEmergencialSR  = porTipo['EMERGENCIAL'] || 0;
    const liquidadoIntegraSR      = porTipo['INTEGRA'] || 0;
    const pctProfundoSR    = liquidadoTotalSR > 0 ? liquidadoProfundoSR / liquidadoTotalSR * 100 : 0;
    const pctEmergencialSR = liquidadoTotalSR > 0 ? liquidadoEmergencialSR / liquidadoTotalSR * 100 : 0;
    const pctPorTipo = {};
    tipos.forEach(t => { pctPorTipo[t] = liquidadoTotalSR > 0 ? porTipo[t] / liquidadoTotalSR * 100 : 0; });
    return {
      sr: m.sr, pct_bom: m.pct_bom, liquidadoTotalSR,
      liquidadoProfundoSR, liquidadoLeveSR, liquidadoEmergencialSR, liquidadoIntegraSR,
      pctProfundoSR, pctEmergencialSR, pctPorTipo
    };
  }).filter(r => r.liquidadoTotalSR > 0);

  if(!linhas.length) return;

  const sorted = [...linhas].sort((a, b) => b.pct_bom - a.pct_bom);
  const labels = sorted.map(r => r.sr.replace('SR ', ''));

  makeChart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        ...tipos.map(t => ({
          label: tipoLabel[t] || t,
          data: sorted.map(r => +r.pctPorTipo[t].toFixed(1)),
          backgroundColor: TIPO_COLORS[t],
          stack: 'tipo', yAxisID: 'y', order: 1
        })),
        {
          type: 'line', label: 'Condição SAM (% Bom+Muito Bom)',
          data: sorted.map(r => +(r.pct_bom * 100).toFixed(1)),
          borderColor: '#1F4E79', backgroundColor: 'rgba(31,78,121,0.12)',
          borderWidth: 2.5, pointRadius: 6, pointBackgroundColor: '#1F4E79',
          pointBorderColor: 'white', pointBorderWidth: 2,
          yAxisID: 'y1', tension: 0, fill: false, order: 0
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              if(ctx.dataset.yAxisID === 'y1')
                return ` Condição SAM: ${fmtNum(ctx.raw, 1)}% Bom+Muito Bom`;
              return ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 1)}% do liquidado da SR`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true, max: 100,
          ticks: { callback: v => v + '%' },
          title: { display: true, text: '% do liquidado', font: { size: 11 } },
          grid: { color: '#F0F0F0' }
        },
        y1: {
          position: 'right', max: 100,
          title: { display: true, text: '% Bom+Muito Bom', font: { size: 11 }, color: '#1F4E79' },
          grid: { display: false },
          ticks: { color: '#1F4E79', callback: v => v + '%' }
        }
      }
    }
  });

  const narrEl = document.getElementById('esforco-narrativa');
  if(narrEl){
    const mediaBom = linhas.reduce((a, r) => a + r.pct_bom, 0) / linhas.length * 100;
    const srMaiorProfundo = [...linhas].sort((a, b) => b.pctProfundoSR - a.pctProfundoSR)[0];
    const srMaiorEmergencial = [...linhas].sort((a, b) => b.pctEmergencialSR - a.pctEmergencialSR)[0];
    const bomProfundo = srMaiorProfundo.pct_bom * 100;
    const diffProfundo = bomProfundo - mediaBom;
    const posicaoProfundo = Math.abs(diffProfundo) < 1
      ? 'próxima da média estadual'
      : diffProfundo < 0 ? 'abaixo da média estadual' : 'acima da média estadual';
    const fraseEmergencial = srMaiorEmergencial.pctEmergencialSR > 0
      ? `A <strong>${esc(srMaiorEmergencial.sr)}</strong> apresenta a maior participação de contratos emergenciais no liquidado ` +
        `(${fmtNum(srMaiorEmergencial.pctEmergencialSR, 1)}%), com ${fmtPctCond(srMaiorEmergencial.pct_bom, 0)} Bom+Muito Bom. `
      : `Nenhuma SR registrou contratos emergenciais em ${esc(anoSelecionadoMalha)}. `;
    narrEl.innerHTML =
      `A <strong>${esc(srMaiorProfundo.sr)}</strong> apresenta a maior participação de intervenção profunda (CREMEP+COP) no liquidado ` +
      `(${fmtNum(srMaiorProfundo.pctProfundoSR, 1)}% do total), com condição SAM ${posicaoProfundo} ` +
      `(${fmtPctCond(srMaiorProfundo.pct_bom, 0)} Bom+Muito Bom frente a ${fmtNum(mediaBom, 0)}% de média entre as SRs). ` +
      fraseEmergencial +
      `<strong>Atenção à causalidade reversa:</strong> maior participação de intervenção profunda ou emergencial pode refletir necessidade estrutural pré-existente da malha, ` +
      `não necessariamente maior esforço de manutenção — este indicador descreve a composição do gasto, sem estabelecer relação de causa e efeito.`;
  }
}

// =======================================================
// ABA 4 - DIAGNOSTICO E ALINHAMENTO REGIONAL
// =======================================================

function renderAnalitica(){
  const compat = compatibilidadeAtual(['condition','financial']);
  if(!compat.compatible){
    ['tbodyBenchmarkInterno','tbodyParticipacaoCriticidade','tbodyPressaoFutura'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = `<tr><td colspan="6">${notaNaoComparavelHTML(compat)}</td></tr>`;
    });
    ['quadrantesResumo'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = notaNaoComparavelHTML(compat);
    });
    return;
  }
  // Relacao descritiva entre condicao favoravel acumulada e liquidado anual.
  if(malhaKm.length > 0){
    const relacaoData = calcularRelacaoCondicaoLiquidado(malhaKm.map(r => ({
      sr: r.sr,
      kmFavoravel: (r.boa_km || 0) + (r.muito_boa_km || 0),
      liquidado: r.liquidado
    })));

    const totalKmBom  = relacaoData.reduce((a,r)=>a+r.kmBom, 0);
    const totalLiqRelacao = relacaoData.reduce((a,r)=>a+r.liquidado, 0);
    const avgKmMi     = totalLiqRelacao > 0 ? totalKmBom / totalLiqRelacao * 1e6 : 0;
    const srMaiorRelacao = relacaoData.reduce((a,b)=>b.kmPorMilhao>a.kmPorMilhao?b:a);
    const avgCusto    = totalKmBom > 0 ? totalLiqRelacao / totalKmBom : null;

    document.getElementById('kpi-relacao-km-bom').textContent        = fmtNum(totalKmBom,1)+' km';
    document.getElementById('kpi-relacao-km-por-mi').textContent     = fmtNum(avgKmMi,2)+' km';
    document.getElementById('kpi-relacao-sr-maior').textContent  = srMaiorRelacao.sr.replace('SR ','');
    document.getElementById('kpi-relacao-sr-maior-sub').textContent = fmtNum(srMaiorRelacao.kmPorMilhao,2)+' km / R$ mi liquidado/ano (relacao descritiva)';
    document.getElementById('kpi-relacao-liquidado-km').innerHTML        = 'R$&nbsp;'+fmtNum(avgCusto||0);

    // Chart: km favoravel por R$ milhao liquidado, em ordem decrescente.
    const sortedRelacao = [...relacaoData].sort((a,b)=>b.kmPorMilhao-a.kmPorMilhao);
    makeChart(document.getElementById('chartRelacaoKm'),{
      type:'bar',
      data:{
        labels: sortedRelacao.map(r=>r.sr.replace('SR ','')),
        datasets:[{
          data: sortedRelacao.map(r=>r.kmPorMilhao),
          backgroundColor: sortedRelacao.map(r=>SR_COLORS[r.sr]||'#888'),
          borderRadius:3
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:ctx=>` ${fmtNum(ctx.raw,2)} km favoravel / R$ milhao liquidado; indicador descritivo, sem inferencia causal`}}
        },
        scales:{
          x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>fmtNum(v,1)+' km'}},
          y:{grid:{display:false}}
        }
      }
    });

    // Chart: liquidado por km em condicao favoravel, em ordem crescente.
    const sortedCusto = [...relacaoData].filter(r=>r.custoPorKmBom!=null).sort((a,b)=>a.custoPorKmBom-b.custoPorKmBom);
    makeChart(document.getElementById('chartRelacaoLiquidadoKm'),{
      type:'bar',
      data:{
        labels: sortedCusto.map(r=>r.sr.replace('SR ','')),
        datasets:[{
          data: sortedCusto.map(r=>r.custoPorKmBom),
          backgroundColor: sortedCusto.map(r=>SR_COLORS[r.sr]||'#888'),
          borderRadius:3
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:ctx=>` R$ ${fmtNum(ctx.raw)} liquidados/ano / km em condicao favoravel`}}
        },
        scales:{
          x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v>=1000?fmtNum(v/1000,0)+'k':v}},
          y:{grid:{display:false}}
        }
      }
    });
  }

  renderRegionalAlignmentCharts();
  renderFig6();
  renderTipoCondicao();
  renderEvolucaoLiquidadoRegional();
  renderDeltaCondicaoEmpenho();

  // ── Alinhamento por Regional ─────────────────────────────
  renderRelacaoRegional('');
  renderBenchmarkInterno();
  renderParticipacaoCriticidade();
  renderQuadrantesNecessidade();
  renderSinalizadorPressaoConservacao();
}

// =======================================================
// BENCHMARK INTERNO DE CUSTO POR KM
// =======================================================

function calcularBenchmarkInterno(dadosPorSR) {
  const valores = dadosPorSR.map(r => r.lkm);
  const med = median(valores);
  return dadosPorSR.map(r => {
    const desvio = med > 0 ? (r.lkm - med) / med : 0;
    let classificacao;
    if (desvio > LIMIAR_BENCHMARK)       classificacao = 'Maior custo relativo observado';
    else if (desvio < -LIMIAR_BENCHMARK) classificacao = 'Menor custo relativo observado';
    else                                  classificacao = 'Custo intermediário';
    return { sr: r.sr, lkm: r.lkm, desvio, classificacao };
  });
}

function renderBenchmarkInterno() {
  const tbody = document.getElementById('tbodyBenchmarkInterno');
  if (!tbody || !regionais.length) return;
  const benchData = calcularBenchmarkInterno(regionais);
  const sorted    = [...benchData].sort((a, b) => b.lkm - a.lkm);
  const classBadge = c => {
    if (c === 'Maior custo relativo observado') return 'b-amber';
    if (c === 'Menor custo relativo observado')   return 'b-blue';
    return 'b-yellow';
  };
  tbody.innerHTML = sorted.map(item => {
    const cor       = SR_COLORS[item.sr] || '#888';
    const sinal     = item.desvio >= 0 ? '+' : '';
    const desvioPct = fmtNum(item.desvio * 100, 1);
    return `<tr>
      <td><strong style="color:${cor}">${esc(item.sr)}</strong></td>
      <td>R$&nbsp;${fmtNum(item.lkm)}</td>
      <td>${sinal}${desvioPct}%</td>
      <td><span class="badge ${classBadge(item.classificacao)}">${esc(item.classificacao)}</span></td>
    </tr>`;
  }).join('');
}

// =======================================================
// PARTICIPAÇÃO NO GASTO × PARTICIPAÇÃO NA CRITICIDADE
// =======================================================

function calcularParticipacaoGastoVsCriticidade(dadosPorSR) {
  const totalLiq  = dadosPorSR.reduce((s, r) => s + (r.liquidado  || 0), 0);
  const totalCrit = dadosPorSR.reduce((s, r) => s + (r.ruim_km    || 0) + (r.pessimo_km || 0), 0);
  return dadosPorSR.map(r => {
    const liq      = r.liquidado  || 0;
    const crit     = (r.ruim_km || 0) + (r.pessimo_km || 0);
    const pctGasto = totalLiq  > 0 ? liq  / totalLiq  * 100 : 0;
    const pctCrit  = totalCrit > 0 ? crit / totalCrit * 100 : 0;
    const diff   = pctGasto - pctCrit;
    const indice = pctCrit > 0 ? pctGasto / pctCrit : null; // null → sem km críticos (N/A)
    return { sr: r.sr, pctGasto, pctCrit, diff, indice };
  });
}

function renderParticipacaoCriticidade() {
  const tbody = document.getElementById('tbodyParticipacaoCriticidade');
  if (!tbody || !malhaKm.length) return;
  const dados  = calcularParticipacaoGastoVsCriticidade(malhaKm);
  const sorted = [...dados].sort((a, b) => b.diff - a.diff);
  tbody.innerHTML = sorted.map(r => {
    const cor       = SR_COLORS[r.sr] || '#888';
    const sinal     = r.diff >= 0 ? '+' : '';
    const diffStyle = r.diff > LIMIAR_PARTICIPACAO
      ? 'color:#C00000;font-weight:600'
      : r.diff < -LIMIAR_PARTICIPACAO
        ? 'color:#1A6B3A;font-weight:600'
        : 'color:#888';
    const indiceStr   = r.indice === null ? 'N/A' : fmtNum(r.indice, 2);
    const indiceBadge = r.indice === null
      ? '<span class="badge b-yellow">N/A</span>'
      : r.indice > LIMIAR_ADERENCIA_HIGH
        ? '<span class="badge b-blue">maior liquidado relativo</span>'
        : r.indice < LIMIAR_ADERENCIA_LOW
          ? '<span class="badge b-yellow">menor liquidado relativo</span>'
          : '<span class="badge b-gray">participação próxima</span>';
    return `<tr>
      <td><strong style="color:${cor}">${esc(r.sr)}</strong></td>
      <td>${fmtNum(r.pctGasto, 1)}%</td>
      <td>${fmtNum(r.pctCrit, 1)}%</td>
      <td style="${diffStyle}">${sinal}${fmtNum(r.diff, 1)}&nbsp;p.p.</td>
      <td>${indiceStr}&nbsp;${indiceBadge}</td>
    </tr>`;
  }).join('');
}

// =======================================================
// MATRIZ DE QUADRANTES NECESSIDADE × INVESTIMENTO
// =======================================================

function calcularQuadrantesNecessidadeInvestimento(dadosPorSR) {
  const samLookup = Object.fromEntries(malhaLiqKm.map(m => [m.sr, m]));
  const pts = dadosPorSR.map(r => {
    const sam = samLookup[r.sr] || {};
    return {
      sr: r.sr,
      x: +((sam.pct_ruim_pessimo || 0) * 100).toFixed(2), // % Ruim+Péssimo SAM 2025
      y: r.lkm                                             // Liquidado/km da malha SAM avaliada 2025
    };
  });
  const medX = median(pts.map(p => p.x));
  const medY = median(pts.map(p => p.y));
  return pts.map(p => {
    const altaCrit = p.x >= medX;
    const altoInv  = p.y >= medY;
    let quadrante;
    if      ( altaCrit &&  altoInv) quadrante = 'O esforço financeiro observado está respondendo a um passivo já identificado?';
    else if ( altaCrit && !altoInv) quadrante = 'Há demanda reprimida, restrição contratual ou intervenção prevista fora do recorte analisado?';
    else if (!altaCrit &&  altoInv) quadrante = 'O gasto observado está associado a prevenção, obras mais complexas ou contratos emergenciais?';
    else                            quadrante = 'A condição favorável permite menor esforço financeiro no curto prazo?';
    return { ...p, medX, medY, quadrante };
  });
}

function renderQuadrantesNecessidade() {
  const canvas    = document.getElementById('chartQuadrantes');
  const resumoDiv = document.getElementById('quadrantesResumo');
  if (!canvas || !regionais.length || !malhaLiqKm.length) return;

  const dados      = calcularQuadrantesNecessidadeInvestimento(regionais);
  const { medX, medY } = dados[0];

  const xVals = dados.map(p => p.x);
  const yVals = dados.map(p => p.y);
  const xSpan = Math.max(Math.max(...xVals) - Math.min(...xVals), 2);
  const ySpan = Math.max(Math.max(...yVals) - Math.min(...yVals), 1000);
  const xMin  = Math.max(0, Math.min(...xVals) - xSpan * 0.3);
  const xMax  = Math.max(...xVals) + xSpan * 0.3;
  const yMin  = Math.max(0, Math.min(...yVals) - ySpan * 0.3);
  const yMax  = Math.max(...yVals) + ySpan * 0.3;

  const quadPlugin = {
    id: 'quadZones',
    beforeDatasetsDraw(ch) {
      const { ctx, chartArea: { left, right, top, bottom }, scales } = ch;
      const mxPx = scales.x.getPixelForValue(medX);
      const myPx = scales.y.getPixelForValue(medY);
      ctx.save();
      ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();

      // Zone fills
      const zones = [
        { x1: mxPx, x2: right, y1: top,  y2: myPx,   fill: 'rgba(46,117,182,0.07)',  label: ['Alta crit.', 'Maior liq./km'],  tx: right-6, ty: top+6,    ta:'right', tb:'top'    },
        { x1: left,  x2: mxPx, y1: top,  y2: myPx,   fill: 'rgba(150,150,150,0.06)', label: ['Baixa crit.', 'Maior liq./km'], tx: left+6,  ty: top+6,    ta:'left',  tb:'top'    },
        { x1: mxPx, x2: right, y1: myPx, y2: bottom, fill: 'rgba(200,160,60,0.08)',  label: ['Alta crit.', 'Menor liq./km'],  tx: right-6, ty: bottom-6, ta:'right', tb:'bottom' },
        { x1: left,  x2: mxPx, y1: myPx, y2: bottom, fill: 'rgba(100,130,100,0.06)', label: ['Baixa crit.', 'Menor liq./km'], tx: left+6,  ty: bottom-6, ta:'left',  tb:'bottom' }
      ];
      zones.forEach(z => {
        ctx.fillStyle = z.fill;
        ctx.fillRect(z.x1, z.y1, z.x2 - z.x1, z.y2 - z.y1);
      });

      // Median lines
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(100,100,100,0.40)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mxPx, top);  ctx.lineTo(mxPx, bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, myPx); ctx.lineTo(right, myPx);  ctx.stroke();
      ctx.setLineDash([]);

      // Quadrant corner labels
      ctx.font = 'italic 9.5px sans-serif';
      zones.forEach(z => {
        ctx.fillStyle   = 'rgba(80,80,80,0.5)';
        ctx.textAlign   = z.ta;
        ctx.textBaseline = z.tb;
        z.label.forEach((ln, i) => {
          const yOff = z.tb === 'top' ? z.ty + i * 13 : z.ty - (z.label.length - 1 - i) * 13;
          ctx.fillText(ln, z.tx, yOff);
        });
      });
      ctx.restore();
    },
    afterDatasetsDraw(ch) {
      // SR name labels above each point
      const { ctx, scales } = ch;
      const ds = ch.data.datasets[0];
      if (!ds) return;
      ctx.save();
      ctx.font         = 'bold 10px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      (ds.data || []).forEach((pt, i) => {
        const px = scales.x.getPixelForValue(pt.x);
        const py = scales.y.getPixelForValue(pt.y);
        ctx.fillStyle = Array.isArray(ds.pointBackgroundColor) ? ds.pointBackgroundColor[i] : '#333';
        ctx.fillText(pt.sr.replace('SR ', ''), px, py - 11);
      });
      ctx.restore();
    }
  };

  chQuadrantes = makeChart(canvas, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'SR',
        data:  dados.map(p => ({ x: p.x, y: p.y, sr: p.sr, quadrante: p.quadrante })),
        pointBackgroundColor: dados.map(p => SR_COLORS[p.sr] || '#888'),
        pointBorderColor:    'white',
        pointBorderWidth:    2,
        pointRadius:         9,
        pointHoverRadius:    12
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: () => '',
            label: ctx => {
              const d = ctx.raw;
              return [
                d.sr,
                `Criticidade (% Ruim+Péssimo SAM ${anoSelecionadoMalha}): ${fmtNum(d.x, 1)}%`,
                `Liquidado/km/ano observado: R\$ ${fmtNum(d.y)}`,
                `Pergunta orientadora: ${d.quadrante}`,
                `Leitura: ponto para aprofundamento, não conclusão de alocação adequada ou inadequada.`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: '% Ruim+Péssimo (SAM ' + anoSelecionadoMalha + ')', font: { size: 11 } },
          min: xMin, max: xMax,
          grid: { color: '#F0F0F0' },
          ticks: { callback: v => fmtNum(v, 1) + '%' }
        },
        y: {
          title: { display: true, text: 'Liquidado/km/ano (R$)', font: { size: 11 } },
          min: yMin, max: yMax,
          grid: { color: '#F0F0F0' },
          ticks: { callback: v => v >= 1000 ? fmtNum(v / 1000, 0) + 'k' : fmtNum(v, 0) }
        }
      }
    },
    plugins: [quadPlugin]
  });

  // Tabela-resumo de quadrantes
  if (resumoDiv) {
    const quadBadge = () => 'b-blue';
    const quadOrder = [
      'Há demanda reprimida, restrição contratual ou intervenção prevista fora do recorte analisado?',
      'O esforço financeiro observado está respondendo a um passivo já identificado?',
      'O gasto observado está associado a prevenção, obras mais complexas ou contratos emergenciais?',
      'A condição favorável permite menor esforço financeiro no curto prazo?'
    ];
    const sorted = [...dados].sort((a, b) => quadOrder.indexOf(a.quadrante) - quadOrder.indexOf(b.quadrante));
    resumoDiv.innerHTML = `<div class="table-wrap" style="margin-top:16px">
      <table>
        <thead><tr>
          <th>SR</th>
          <th>% Ruim+Péssimo (SAM ${anoSelecionadoMalha})</th>
          <th>Liquidado/km/ano observado (R$)</th>
          <th>Pergunta orientadora</th>
        </tr></thead>
        <tbody>${sorted.map(p => {
          const cor = SR_COLORS[p.sr] || '#888';
          return `<tr>
            <td><strong style="color:${cor}">${esc(p.sr)}</strong></td>
            <td>${fmtNum(p.x, 1)}%</td>
            <td>R\$&nbsp;${fmtNum(p.y)}</td>
            <td><span class="badge ${quadBadge(p.quadrante)}">${esc(p.quadrante)}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }
}

// =======================================================
// SINALIZADOR DE PRESSAO DE CONSERVACAO
// =======================================================

function montarInsumosSinalizadorPressao(dadosPorSR) {
  const samLookup = Object.fromEntries(malhaLiqKm.map(m => [m.sr, m]));
  return dadosPorSR.map(r => {
    const sam = samLookup[r.sr] || {};
    return {
      sr:           r.sr,
      pctRegular:   +((sam.pct_regular       || 0) * 100).toFixed(2),
      pctRuimPess:  +((sam.pct_ruim_pessimo  || 0) * 100).toFixed(2),
      pctEmg:       r.nc > 0 ? +(r.emg / r.nc * 100).toFixed(2) : 0,
      lkm:          r.lkm,
      periodos: {
        conditionYear: sam.conditionYear || anoSelecionadoMalha,
        financialYear: r.financialYear || appState.selectedFinancialYear,
        contractsYear: r.contractsYear || appState.selectedFinancialYear
      }
    };
  });
}

function calcularSinalizadorPressaoConservacaoPainel(dadosPorSR) {
  return calcularSinalizadorPressaoConservacao(montarInsumosSinalizadorPressao(dadosPorSR), {
    thresholds: { alta: LIMIAR_PRESSAO_ALTA, media: LIMIAR_PRESSAO_MEDIA },
    srOrder: SR_ORDER
  });
}

function renderSensibilidadePressao(insumos) {
  const holder = document.getElementById('pressao-sensibilidade');
  if (!holder) return;
  const analise = analisarSensibilidadePressao(insumos, {
    thresholds: { alta: LIMIAR_PRESSAO_ALTA, media: LIMIAR_PRESSAO_MEDIA },
    srOrder: SR_ORDER
  });
  if (!analise.scenarios.length) {
    holder.innerHTML = 'Analise de sensibilidade indisponivel para o recorte selecionado.';
    return;
  }
  const linhas = analise.scenarios.map(s => {
    const ranking = (s.ranking || []).map(sr => (sr || '').replace('SR ', '')).join(' > ');
    return `<div><strong>${esc(s.label)}:</strong> ${esc(ranking)}</div>`;
  }).join('');
  const alerta = analise.rankingMudou
    ? '<div class="mt-8"><strong>Limitação metodológica:</strong> o ranking muda em cenário alternativo de pesos. Use o sinalizador como apoio à investigação e evite categorias rígidas.</div>'
    : '<div class="mt-8">O ranking permaneceu estável nos cenários testados; ainda assim, o sinalizador é relativo às cinco SRs e não antecipa resultado futuro.</div>';
  holder.innerHTML = `${linhas}${alerta}`;
}

function renderSinalizadorPressaoConservacao() {
  const tbody = document.getElementById('tbodyPressaoFutura');
  if (!tbody || !regionais.length || !malhaLiqKm.length) return;
  const insumos = montarInsumosSinalizadorPressao(regionais);
  const dados  = calcularSinalizadorPressaoConservacao(insumos, {
    thresholds: { alta: LIMIAR_PRESSAO_ALTA, media: LIMIAR_PRESSAO_MEDIA },
    srOrder: SR_ORDER
  });
  const sorted = [...dados].sort((a, b) => b.score - a.score);
  tbody.innerHTML = sorted.map(r => {
    const cor      = SR_COLORS[r.sr] || '#888';
    const spcStyle = r.score >= LIMIAR_PRESSAO_ALTA
      ? 'color:#C00000;font-weight:700'
      : r.score >= LIMIAR_PRESSAO_MEDIA
        ? 'color:#E07B00;font-weight:600'
        : 'color:#1A6B3A;font-weight:600';
    const spcLabel = r.score >= LIMIAR_PRESSAO_ALTA
      ? '<span class="badge b-red">sinal alto</span>'
      : r.score >= LIMIAR_PRESSAO_MEDIA
        ? '<span class="badge b-yellow">sinal intermediario</span>'
        : '<span class="badge b-green">sinal baixo</span>';
    const missingNote = r.missing && r.missing.length ? ` title="Dados ausentes tratados como zero: ${esc(r.missing.join(', '))}"` : '';
    return `<tr>
      <td><strong style="color:${cor}">${esc(r.sr)}</strong></td>
      <td>${fmtNum(r.pctRegular, 1)}%</td>
      <td>${fmtNum(r.pctRuimPess, 1)}%</td>
      <td>${fmtNum(r.pctEmg, 1)}%</td>
      <td style="${spcStyle}"${missingNote}>${fmtNum(r.score, 3)}&nbsp;${spcLabel}</td>
      <td>R$&nbsp;${fmtNum(r.lkm)}</td>
    </tr>`;
  }).join('');
  renderSensibilidadePressao(insumos);

  // Popula card KPI na Sintese Executiva.
  const srMaiorSinal = sorted[0];
  if (srMaiorSinal) {
    const elVal = document.getElementById('kpi-sint-sr-pressao');
    const elSub = document.getElementById('kpi-sint-sr-pressao-sub');
    if (elVal) elVal.textContent = (srMaiorSinal.sr || '').replace('SR ', '');
    if (elSub) {
      const nivel = srMaiorSinal.score >= LIMIAR_PRESSAO_ALTA ? 'alto' : srMaiorSinal.score >= LIMIAR_PRESSAO_MEDIA ? 'intermediario' : 'baixo';
      elSub.textContent = 'SPC ' + fmtNum(srMaiorSinal.score, 3) + ' - sinal ' + nivel;
    }
    // Popula copia do KPI de pressao na aba Contexto e Analise.
    const elVal2 = document.getElementById('kpi-sint2-sr-pressao');
    const elSub2 = document.getElementById('kpi-sint2-sr-pressao-sub');
    if (elVal2) elVal2.textContent = (srMaiorSinal.sr || '').replace('SR ', '');
    if (elSub2) {
      const nivel2 = srMaiorSinal.score >= LIMIAR_PRESSAO_ALTA ? 'alto' : srMaiorSinal.score >= LIMIAR_PRESSAO_MEDIA ? 'intermediario' : 'baixo';
      elSub2.textContent = 'SPC ' + fmtNum(srMaiorSinal.score, 3) + ' - sinal ' + nivel2;
    }
  }
}

// =======================================================
// ABA 4 — BENCHMARK NACIONAL
// =======================================================

// Dados carregados de DATA_PATH.DASHBOARD + benchmark_nacional.json via renderBenchmark()
// Para regenerar o arquivo execute: python scripts/extract_benchmark_nacional.py
let benchmarkEstados = {};
let benchmarkBrasil  = {};
let benchmarkAnos    = [];

let chBenchRanking = null;
let chBenchLine    = null;
let benchPlayTimer = null;
let benchAnoIdx    = benchmarkAnos.length - 1; // inicia em 2025

function getBenchRanking(ano){
  return Object.entries(benchmarkEstados)
    .filter(([,d]) => d.serie[ano] != null)
    .map(([uf,d])  => ({uf, nome:d.nome, val:d.serie[ano]}))
    .sort((a,b)    => b.val - a.val);
}

function getBenchComparison(ano){
  const ufs = ['PR','SC','RS','SP','MS','MG'];
  return ufs
    .map(uf => {
      const d = benchmarkEstados[uf];
      return d && d.serie[ano] != null ? {uf, nome:d.nome, val:d.serie[ano]} : null;
    })
    .filter(Boolean)
    .sort((a,b)=>b.val-a.val);
}

function updateBenchYear(idx){
  benchAnoIdx = idx;
  const ano = benchmarkAnos[idx];
  const slider = document.getElementById('benchSlider');
  if(slider) slider.value = idx;
  document.getElementById('benchYearLabel').textContent = ano;
  ['benchBadgePR','benchBadgePos','benchBadgeBR','benchRankingBadge'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.textContent = ano;
  });
  const ranking = getBenchRanking(ano);
  const prIdx   = ranking.findIndex(e => e.uf === 'PR');
  const prEntry = prIdx >= 0 ? ranking[prIdx] : null;
  document.getElementById('benchKpiPR').textContent  = prEntry ? fmtNum(prEntry.val,1)+'%' : '—';
  document.getElementById('benchKpiPos').textContent = prEntry ? (prIdx+1)+'º de '+ranking.length : '—';
  document.getElementById('benchKpiBR').textContent  = benchmarkBrasil[ano] != null ? fmtNum(benchmarkBrasil[ano],1)+'%' : '—';

  // ── KPIs de ponte (aba Posicionamento Estadual) ──────────
  const pontePos    = document.getElementById('bench-ponte-pos');
  const ponteBadge  = document.getElementById('bench-ponte-badge-pos');
  const ponteMelhor = document.getElementById('bench-ponte-sr-melhor');
  const ponteMelhorSub = document.getElementById('bench-ponte-sr-melhor-sub');
  const pontePress  = document.getElementById('bench-ponte-sr-pressao');
  const pontePressSub = document.getElementById('bench-ponte-sr-pressao-sub');
  const ponteNarr   = document.getElementById('bench-ponte-narrativa');

  if (pontePos && prEntry) {
    pontePos.textContent   = (prIdx + 1) + 'º de ' + ranking.length;
    if (ponteBadge) ponteBadge.textContent = ano;
  }

  if (malhaLiqKm.length) {
    const srMelhor = malhaLiqKm.reduce((a, b) => b.pct_bom > a.pct_bom ? b : a, malhaLiqKm[0]);
    if (ponteMelhor) ponteMelhor.textContent = srMelhor.sr.replace('SR ', '');
    if (ponteMelhorSub) ponteMelhorSub.textContent = fmtPctCond(srMelhor.pct_bom, 0) + ' Bom+Muito Bom (SAM ' + anoSelecionadoMalha + ')';
  }

  const pressaoValEl = document.getElementById('kpi-sint-sr-pressao');
  const pressaoSubEl = document.getElementById('kpi-sint-sr-pressao-sub');
  if (pontePress && pressaoValEl) pontePress.textContent = pressaoValEl.textContent;
  if (pontePressSub && pressaoSubEl) pontePressSub.textContent = pressaoSubEl.textContent;

  if (ponteNarr && prEntry && malhaLiqKm.length) {
    const mediaBR = benchmarkBrasil[ano];
    const diffPR  = prEntry.val - (mediaBR || 0);
    const diffTxt = diffPR >= 0
      ? `<strong>${fmtNum(Math.abs(diffPR), 1)} p.p. acima</strong> da média nacional`
      : `<strong>${fmtNum(Math.abs(diffPR), 1)} p.p. abaixo</strong> da média nacional`;
    const srMelhor = malhaLiqKm.reduce((a, b) => b.pct_bom > a.pct_bom ? b : a, malhaLiqKm[0]);
    const srMaiorRuimPessimo = findSrMaiorPctRuimPessimo(malhaLiqKm) || {};
    ponteNarr.innerHTML =
      `Em ${ano}, o Paraná ocupou a <strong>${prIdx + 1}ª posição</strong> no ranking nacional da Pesquisa CNT ` +
      `com <strong>${fmtNum(prEntry.val, 1)}%</strong> de malha em boa ou ótima condição — ${diffTxt} ` +
      `(${fmtNum(mediaBR || 0, 1)}%). ` +
      `Internamente, a malha estadual administrada pelo DER-PR apresenta variação significativa entre regionais: ` +
      `a <strong>${esc(srMelhor.sr)}</strong> alcançou <strong>${fmtPctCond(srMelhor.pct_bom, 0)}</strong> de malha em condição Bom+Muito Bom (SAM ${esc(anoSelecionadoMalha)}), ` +
      `enquanto a <strong>${esc(srMaiorRuimPessimo.sr)}</strong> registrou a maior proporção Ruim+Péssimo (<strong>${fmtPctCond(srMaiorRuimPessimo.pct_ruim_pessimo, 0)}</strong>). ` +
      `Essa heterogeneidade interna não é visível no dado agregado estadual da CNT e é o que os indicadores das abas anteriores buscam detalhar.`;
  }

  if(chBenchRanking){
    const comparison = getBenchRanking(ano);
    chBenchRanking.data.labels = comparison.map(e => e.nome);
    chBenchRanking.data.datasets[0].data            = comparison.map(e => e.val);
    chBenchRanking.data.datasets[0].backgroundColor = comparison.map(e => e.uf==='PR' ? '#E07B00' : '#BDD7EE');
    chBenchRanking.update('none');
  }
  if(chBenchLine){
    chBenchLine.data.datasets.forEach(ds => {
      ds.pointRadius      = benchmarkAnos.map((_,i) => i===idx ? 8 : 4);
      ds.pointBorderWidth = benchmarkAnos.map((_,i) => i===idx ? 3 : 1);
    });
    chBenchLine.update('none');
  }
}

function renderBenchmark(){
  const errEl = document.getElementById('bench-error');
  loadJsonData('benchmark_nacional', `${DATA_PATH.DASHBOARD}benchmark_nacional.json`, 'benchmark_nacional.json')
    .then(data => {
      benchmarkEstados = data.estados || {};
      benchmarkBrasil  = data.brasil  || {};
      benchmarkAnos    = data.anos    || [];
      if(errEl) errEl.innerHTML = '';
      _initBenchCharts();
    })
    .catch(err => {
      if(errEl) errEl.innerHTML =
        `<div class="note warn mt-8"><strong>Erro ao carregar dados de benchmark:</strong> ${esc(err.message)}.<br>` +
        `Execute <code>python scripts/extract_benchmark_nacional.py</code> na raiz do projeto para gerar ` +
        `<code>dashboard/data/benchmark_nacional.json</code> e recarregue o painel.</div>`;
    });
}

function _initBenchCharts(){
  benchAnoIdx = benchmarkAnos.length - 1;
  const lineLabels  = benchmarkAnos.map(String);
  const prSerie     = benchmarkAnos.map(a => benchmarkEstados['PR'].serie[a]);
  const brSerie     = benchmarkAnos.map(a => benchmarkBrasil[a]);
  const initRadius  = benchmarkAnos.map((_,i) => i===benchAnoIdx ? 8 : 4);
  const initBW      = benchmarkAnos.map((_,i) => i===benchAnoIdx ? 3 : 1);

  chBenchLine = makeChart(document.getElementById('chartBenchLine'),{
    type:'line',
    data:{
      labels: lineLabels,
      datasets:[
        {
          label:'Parana',
          data: prSerie,
          borderColor:'#E07B00',
          backgroundColor:'rgba(224,123,0,.10)',
          fill:true, tension:0,
          pointRadius:[...initRadius],
          pointBackgroundColor:'#E07B00',
          pointBorderColor:'#fff',
          pointBorderWidth:[...initBW],
          spanGaps:false
        },
        {
          label:'Brasil (media nacional)',
          data: brSerie,
          borderColor:'#1F4E79',
          backgroundColor:'rgba(31,78,121,.06)',
          fill:false, tension:0,
          pointRadius:[...initRadius],
          pointBackgroundColor:'#1F4E79',
          pointBorderColor:'#fff',
          pointBorderWidth:[...initBW],
          spanGaps:false
        }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{position:'bottom',labels:{font:{size:11},padding:12}},
        tooltip:{callbacks:{
          title: ctx => 'Ano: '+ctx[0].label,
          label: ctx => ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y,1)}%`
        }}
      },
      scales:{
        x:{grid:{color:'#F0F0F0'},ticks:{font:{size:11}}},
        y:{
          min:0, max:100,
          grid:{color:'#F0F0F0'},
          ticks:{callback: v => v+'%'},
          title:{display:true,text:'% Boa + Otima (CNT)',font:{size:11},color:'#666'}
        }
      }
    }
  });

  chBenchRanking = makeChart(document.getElementById('chartBenchRanking'),{
    type:'bar',
    data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:3,barPercentage:.75}]},
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      animation:{duration:0},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title: ctx => { const r=getBenchRanking(benchmarkAnos[benchAnoIdx]); return r[ctx[0].dataIndex]?.nome||''; },
          label: ctx => ` % Boa ou Otima: ${fmtNum(ctx.raw,1)}%`
        }}
      },
      scales:{
        x:{min:0,max:100,grid:{color:'#F0F0F0'},ticks:{callback:v=>v+'%'}},
        y:{grid:{display:false},ticks:{font:{size:11}}}
      }
    }
  });

  document.getElementById('benchSlider').addEventListener('input', e => {
    if(benchPlayTimer){
      clearInterval(benchPlayTimer); benchPlayTimer=null;
      document.getElementById('benchPlayBtn').textContent = '▶ Play';
    }
    updateBenchYear(+e.target.value);
  });

  document.getElementById('benchPlayBtn').addEventListener('click', () => {
    const btn = document.getElementById('benchPlayBtn');
    if(benchPlayTimer){
      clearInterval(benchPlayTimer); benchPlayTimer=null;
      btn.textContent = '▶ Play';
    } else {
      if(benchAnoIdx >= benchmarkAnos.length - 1) updateBenchYear(0);
      btn.textContent = '⏸ Pause';
      benchPlayTimer = setInterval(() => {
        if(benchAnoIdx >= benchmarkAnos.length - 1){
          clearInterval(benchPlayTimer); benchPlayTimer=null;
          btn.textContent = '▶ Play'; return;
        }
        updateBenchYear(benchAnoIdx + 1);
      }, 1200);
    }
  });

  updateBenchYear(benchAnoIdx);
}

// =======================================================
// ABA 5 — MAPA DA MALHA POR REGIONAL (Leaflet)
// =======================================================

let leafletMapInstance = null;
let mapaRodLayer        = null;  // L.geoJSON layer group — geometria fixa, reaproveitada entre anos
let mapaRodSrPctPorAno  = {};    // {sr: pct_bom_muito_bom} do ano atualmente exibido no mapa
let mapaRodLegendEl     = null;  // <div> da legenda, para atualizar sem recriar o L.control

function _mapaRodColor(pct){
  if(pct < 30) return '#C00000';  // condição crítica
  if(pct < 50) return '#E07B00';  // condição intermediária
  return '#70AD47';                // boa condição
}

// Monta {sr: pct_bom_muito_bom} (escala 0–100) para o ano pedido, a partir de
// regionaisRaw[sr].malha_por_ano — mesma fonte usada por renderEvolucaoMalha().
// Nenhum valor hardcoded: SRs/anos ausentes na base simplesmente não entram no objeto.
function srPctBomPorAno(ano){
  const out = {};
  Object.keys(regionaisRaw).forEach(sr => {
    const d = (regionaisRaw[sr].malha_por_ano || {})[ano];
    if(d) out[sr] = (d.pct.bom_muito_bom || 0) * 100;
  });
  return out;
}

// HTML da legenda do mapa — extraído para ser reaproveitado tanto na criação
// (legend.onAdd) quanto na atualização por troca de ano (updateMapaRodoviasAno).
function _mapaRodLegendHtml(srPctPorAno, ano){
  const escalas = [
    {cor:'#70AD47', label:'≥ 50% — Boa condição'},
    {cor:'#E07B00', label:'30–50% — Intermediária'},
    {cor:'#C00000', label:'< 30% — Crítica'}
  ];
  const SR_ORDER_MAP = ['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];
  return '<b>% SAM Bom + Muito Bom</b>' +
    escalas.map(it=>
      `<div class="map-rod-leg-item">` +
      `<div class="map-rod-leg-swatch" style="background:${it.cor}"></div>${it.label}` +
      `</div>`
    ).join('') +
    '<hr class="map-rod-separator">' +
    `<b>Por SR (SAM ${esc(ano)})</b>` +
    SR_ORDER_MAP.map(sr => {
      const pct  = srPctPorAno[sr];
      const tmda = tmdaPorSr[sr];
      return `<div class="map-rod-leg-item">` +
        `<div class="map-rod-leg-swatch" style="background:${_mapaRodColor(pct!=null?pct:0)}"></div>` +
        `${esc(sr.replace('SR ',''))}${pct!=null?' — '+fmtNum(pct,1)+'%':''}` +
        `${tmda!=null?' · TMDA '+fmtNum(tmda,0):''}` +
        `</div>`;
    }).join('');
}

// Chamada pelo listener 'change' de #filtroAnoMalha (onAnoMalhaChange). Não recarrega
// o GeoJSON — a geometria é fixa; só recalcula cor/tooltip/legenda a partir de
// regionaisRaw[sr].malha_por_ano[ano]. Sem efeito se o mapa ainda não foi inicializado
// (aba "Diagnóstico da Malha" nunca visitada) — updateMapaRodoviasAno roda de novo, com
// o ano corrente, na primeira vez que _initLeafletMap() carregar o GeoJSON.
function updateMapaRodoviasAno(ano){
  if(!mapaRodLayer) return;
  mapaRodSrPctPorAno = srPctBomPorAno(ano);

  mapaRodLayer.eachLayer(layer => {
    mapaRodLayer.resetStyle(layer);  // recalcula a cor via style() com o objeto atualizado
    const p   = layer.feature.properties;
    const pct = mapaRodSrPctPorAno[p.sr];
    layer.setTooltipContent(
      `<strong>${esc(p.sr)}</strong><br>` +
      `SAM Bom + Muito Bom (${esc(ano)}): <strong>${fmtNum(pct,1)}%</strong><br>` +
      `TMDA médio: <strong>${fmtNum(tmdaPorSr[p.sr]||0,0)}</strong> veíc/dia` +
      `<br>Rodovia: ${esc(p.ref)}`
    );
  });

  if(mapaRodLegendEl){
    mapaRodLegendEl.innerHTML = _mapaRodLegendHtml(mapaRodSrPctPorAno, ano);
  }
}

function _loadLeaflet(cb){
  if(window.L){ cb(); return; }
  if(STANDALONE_MODE){
    const errEl = document.getElementById('mapa-rod-error');
    if(errEl) errEl.innerHTML =
      `<div class="note warn mt-8"><strong>Mapa indisponível no arquivo autossuficiente:</strong> ` +
      `a biblioteca Leaflet não foi embutida corretamente. Gere novamente o HTML standalone.</div>`;
    return;
  }
  // Dependência externa: substituir por assets/vendor/leaflet quando houver versão local.
  const lnk = document.createElement('link');
  lnk.rel = 'stylesheet';
  lnk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(lnk);
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  s.onload = cb;
  document.head.appendChild(s);
}

function _initLeafletMap(){
  const errEl   = document.getElementById('mapa-rod-error');
  const alertEl = document.getElementById('mapa-rod-alerta-aprox');

  const map = L.map('map-rodovias', {center:[-24.8,-51.5], zoom:7, scrollWheelZoom:false});
  leafletMapInstance = map;
  // TODO: adicionar filtro por SR usando uma camada Leaflet filtrável, se a tela precisar dessa segmentação.

  const mapEl = document.getElementById('map-rodovias');
  if(mapEl) mapEl.classList.add('leaflet-offline-map');

  // Dependência externa de mapa-base: manter OSM até haver tile/cache local definido pelo
  // projeto. "Dados embutidos" (STANDALONE_MODE) não implica "sem acesso a rede" — o tile
  // layer é sempre solicitado; leaflet-offline-map só dá a cor de fallback (#EAF0F6)
  // enquanto os tiles carregam ou se algum tile falhar.
  const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxZoom: 18
  });
  tileLayer.on('tileerror', function(e){
    console.warn('Falha ao carregar tile OSM:', e);
  });
  tileLayer.addTo(map);

  if(STANDALONE_MODE){
    map.attributionControl.addAttribution('Geometria: © OpenStreetMap contributors');
  }

  loadJsonData('rodovias_pr', `${DATA_PATH.DASHBOARD}rodovias_pr.geojson`, 'rodovias_pr.geojson')
    .then(geojson => {
      if(errEl) errEl.innerHTML = '';

      // Mostra aviso de aproximação se algum trecho estiver marcado
      if(alertEl && geojson.features.some(f => f.properties.atribuicao_aproximada)){
        alertEl.classList.remove('is-hidden');
      }

      // Cor/tooltip/legenda vêm de regionaisRaw[sr].malha_por_ano[anoSelecionadoMalha],
      // não de propriedades estáticas do GeoJSON — a geometria é a mesma para todos os
      // anos, só a condição (cor) muda. Ver srPctBomPorAno()/updateMapaRodoviasAno().
      mapaRodSrPctPorAno = srPctBomPorAno(anoSelecionadoMalha);

      let geoLayer = L.geoJSON(geojson, {
        style: feature => ({
          color:   _mapaRodColor(mapaRodSrPctPorAno[feature.properties.sr]),
          weight:  2.5,
          opacity: 0.8
        }),
        onEachFeature: (feature, layer) => {
          const p   = feature.properties;
          const pct = mapaRodSrPctPorAno[p.sr];
          layer.bindTooltip(
            `<strong>${esc(p.sr)}</strong><br>` +
            `SAM Bom + Muito Bom (${esc(anoSelecionadoMalha)}): <strong>${fmtNum(pct,1)}%</strong><br>` +
            `TMDA médio: <strong>${fmtNum(tmdaPorSr[p.sr]||0,0)}</strong> veíc/dia` +
            `<br>Rodovia: ${esc(p.ref)}`,
            {sticky:true, className:''}
          );
          layer.on({
            mouseover: e => e.target.setStyle({weight:5, opacity:1}),
            mouseout:  e => geoLayer.resetStyle(e.target)
          });
        }
      }).addTo(map);
      mapaRodLayer = geoLayer;

      // Ajusta o zoom para cobrir toda a extensão dos dados
      try {
        map.fitBounds(geoLayer.getBounds(), {padding:[20,20]});
      } catch(err) {
        console.warn('Não foi possível ajustar o zoom do mapa (fitBounds):', err);
      }

      // Legenda
      const legend = L.control({position:'bottomright'});
      legend.onAdd = () => {
        const div = L.DomUtil.create('div','map-rod-legend');
        mapaRodLegendEl = div;
        div.innerHTML = _mapaRodLegendHtml(mapaRodSrPctPorAno, anoSelecionadoMalha);
        return div;
      };
      legend.addTo(map);
    })
    .catch(err => {
      if(errEl) errEl.innerHTML =
        `<div class="note warn mt-8"><strong>Erro ao carregar dados do mapa:</strong> ${esc(err.message)}.<br>` +
        `Execute <code>python scripts/fetch_rodovias_pr.py</code> na raiz do projeto para gerar ` +
        `<code>dashboard/data/rodovias_pr.geojson</code> e recarregue o painel.</div>`;
    });
}

function renderMapaRodovias(){
  if(leafletMapInstance){
    setTimeout(()=>leafletMapInstance.invalidateSize(), 50);
    return;
  }
  _loadLeaflet(()=>_initLeafletMap());
}

let chTmdaCondicao = null;

// Cruza TMDA médio (tmdaPorSr) com condição da malha (regionais[].pctBom, SAM) por SR.
// Mesma paleta de condição do mapa (_mapaRodColor) — verde/laranja/vermelho.
function renderTmdaCondicao(){
  const canvas = document.getElementById('chartTmdaCondicao');
  if(!canvas) return;

  const scatterData = regionais.map(r => ({
    x: tmdaPorSr[r.sr] || 0,
    y: pctToDisplay(r.pctBom || 0),
    sr: r.sr
  }));
  const pointColors = scatterData.map(d => _mapaRodColor(d.y));

  chTmdaCondicao = makeChart(canvas,{
    type:'scatter',
    data:{
      datasets:[{
        label:'SR',
        data: scatterData,
        backgroundColor: pointColors,
        pointBackgroundColor: pointColors,
        pointBorderColor:'white',
        pointBorderWidth:2,
        pointRadius:10,
        pointHoverRadius:13
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        datalabels:{
          display:true,
          align:'top',
          offset:6,
          color:'#333',
          font:{size:11,weight:600},
          formatter:(value)=>esc(value.sr.replace('SR ',''))
        },
        tooltip:{
          callbacks:{
            title:()=>'',
            label: ctx=>{
              const d = ctx.raw;
              return [
                d.sr,
                `TMDA médio: ${fmtNum(d.x,0)} veíc/dia`,
                `% Bom+Muito Bom (SAM ${anoSelecionadoMalha}): ${fmtNum(d.y,1)}%`
              ];
            }
          }
        }
      },
      scales:{
        x:{
          title:{display:true,text:'TMDA médio (veíc/dia)'},
          grid:{color:'#F0F0F0'}
        },
        y:{
          title:{display:true,text:'% Malha Bom+Muito Bom (SAM)'},
          min:0, max:100,
          ticks:{callback:v=>v+'%'},
          grid:{color:'#F0F0F0'}
        }
      }
    }
  });
}

// =======================================================
// CONTROLE DE ABAS
// =======================================================

const rendered={};

function activateTab(id){
  document.querySelectorAll('.tab-btn').forEach(b=>{
    const active=b.dataset.tab===id;
    b.classList.toggle('active',active);
    b.setAttribute('aria-selected',active?'true':'false');
  });
  document.querySelectorAll('.tab-pane').forEach(p=>{
    p.classList.remove('active');
    p.style.display='none';
  });
  const pane=document.getElementById('tab-'+id);
  if(!pane) return;
  pane.style.display='block';
  void pane.offsetHeight;
  pane.classList.add('active');
  // Update reading flow indicator
  document.querySelectorAll('.reading-step').forEach(s=>{
    s.classList.toggle('active', s.dataset.flowTab===id);
  });

  if(!rendered[id]){
    rendered[id]=true;
    setTimeout(()=>{
      if(id==='pressao-execucao')       renderExecucao();
      else if(id==='malha-diagnostico')    { renderMalha(); renderAnalitica(); }
      else if(id==='benchmark')        renderBenchmark();
    }, 30);
  } else {
    if(id==='malha-diagnostico')
      setTimeout(()=>{ if(leafletMapInstance) leafletMapInstance.invalidateSize(); }, 50);
  }
}

document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));

document.getElementById('filtroSR').addEventListener('change', e=>{
  renderRelacaoRegional(e.target.value);
});

wireCondPillBar('filtroKmCriticos', () => chKmCriticos, v => { serieIsoladaKmCriticos = v; });
wireCondPillBar('filtroCondicaoInvest', () => chFig6, v => { serieIsoladaFig6 = v; });
setupNotaPopovers();

// Inicialização via fetch — ver initDashboard() abaixo

// =======================================================
// CARGA DE DADOS — DATA_PATH.ROOT
// =======================================================

// KPIs e narrativa do topo da aba "Diagnóstico da Malha" — depende apenas de
// malhaKm/malhaLiqKm (globais reconstruídas por buildMalhaForAno() a cada
// troca de ano), nunca do ano "de referência" fixo em der_precomputed.
// Chamada em initDashboard() (carga inicial) e em onAnoMalhaChange() (troca
// do seletor #filtroAnoMalha) — sem isso, estes 4 cards ficavam travados no
// ano de referência (2025) mesmo quando o usuário selecionava 2024.
function renderMalhaExecKPIs(){
  if (!(malhaLiqKm.length && malhaKm.length)) return;

  const kmTotal    = malhaKm.reduce((a, r) => a + (r.ruim_km||0) + (r.pessimo_km||0) + (r.regular_km||0) + (r.boa_km||0) + (r.muito_boa_km||0), 0);
  const kmBomTotal = malhaKm.reduce((a, r) => a + (r.boa_km||0) + (r.muito_boa_km||0), 0);
  const pctBomGeral = kmTotal > 0 ? (kmBomTotal / kmTotal) : 0;
  const srMelhor  = malhaLiqKm.reduce((a, b) => b.pct_bom > a.pct_bom ? b : a, malhaLiqKm[0]);
  const srMaiorRuimPessimo = findSrMaiorPctRuimPessimo(malhaLiqKm) || {};

  const elKmTotal   = document.getElementById('kpi-exec-km-total');
  const elPctBom    = document.getElementById('kpi-exec-pct-bom');
  const elPctBomSub = document.getElementById('kpi-exec-pct-bom-sub');
  const elMelhor    = document.getElementById('kpi-exec-sr-melhor');
  const elMelhorSub = document.getElementById('kpi-exec-sr-melhor-sub');
  const elNarr      = document.getElementById('kpi-exec-narrativa');

  if (elKmTotal)   elKmTotal.textContent   = fmtNum(kmTotal, 0) + ' km';
  if (elPctBom)    elPctBom.textContent    = fmtPctCond(pctBomGeral, 0);
  if (elPctBomSub) elPctBomSub.textContent = fmtNum(kmBomTotal, 0) + ' km em Bom+Muito Bom';
  if (elMelhor)    elMelhor.textContent    = srMelhor.sr.replace('SR ', '');
  if (elMelhorSub) elMelhorSub.textContent = fmtPctCond(srMelhor.pct_bom, 0) + ' Bom+Muito Bom';

  const elCritico    = document.getElementById('kpi-exec-sr-critico');
  const elCriticoSub = document.getElementById('kpi-exec-sr-critico-sub');
  if (elCritico)    elCritico.textContent    = (srMaiorRuimPessimo.sr || '').replace('SR ', '');
  if (elCriticoSub) elCriticoSub.textContent = fmtPctCond(srMaiorRuimPessimo.pct_ruim_pessimo, 0) + ' Ruim+Péssimo';

  if (elNarr) {
    elNarr.innerHTML =
      `<strong>Leitura geral:</strong> Das ${fmtNum(kmTotal, 0)} km avaliadas pelo SAM ${esc(anoSelecionadoMalha)}, ` +
      `<strong>${fmtPctCond(pctBomGeral, 0)}</strong> encontram-se em condição Boa ou Muito Boa. ` +
      `A <strong>${esc(srMelhor.sr)}</strong> apresenta a melhor condição relativa ` +
      `(${fmtPctCond(srMelhor.pct_bom, 0)} Bom+Muito Bom), ` +
      `enquanto a <strong>${esc(srMaiorRuimPessimo.sr)}</strong> registra o maior percentual Ruim+Péssimo ` +
      `(${fmtPctCond(srMaiorRuimPessimo.pct_ruim_pessimo, 0)} Ruim+Péssimo; Regular tratado separadamente). ` +
      `O cruzamento com os dados de execução orçamentária — detalhado nas abas <strong>Pressão e Execução</strong> e <strong>Leitura por Regional</strong> — ` +
      `revela que volume de gasto por km e condição da malha não seguem proporção direta entre as regionais.`;
  }
}

// Síntese Executiva (KPIs + narrativa), alerta CREMEP/Emergencial da SR Noroeste e cards
// #hl-grid — todos dependem de regionais/malhaLiqKm, que mudam quando o usuário troca o ano
// no seletor #filtroAnoMalha — precisam ser re-executados em onAnoMalhaChange, não só uma vez
// em initDashboard() (mesmo motivo pelo qual renderMalhaExecKPIs existe separadamente).
function renderSinteseExecutiva(){
  if (!regionais.length || !malhaLiqKm.length) return;

  const avgLkm      = Math.round(regionais.reduce((a, r) => a + r.lkm, 0) / regionais.length);
  const srsByLkm    = [...regionais].sort((a, b) => b.lkm - a.lkm);

  // KPIs Síntese
  const srMelhorSAM = malhaLiqKm.reduce((a,b) => b.pct_bom > a.pct_bom ? b : a, malhaLiqKm[0] || {});
  const srMaiorRuimPessimo = findSrMaiorPctRuimPessimo(malhaLiqKm) || {};
  document.getElementById('kpi-sint-sr-melhor').textContent     = (srMelhorSAM.sr||'').replace('SR ','');
  document.getElementById('kpi-sint-sr-melhor-sub').textContent = fmtPctCond(srMelhorSAM.pct_bom, 0) + ' Bom+Muito Bom';
  document.getElementById('kpi-sint-sr-pior').textContent       = (srMaiorRuimPessimo.sr||'').replace('SR ','');
  document.getElementById('kpi-sint-sr-pior-sub').textContent   = fmtPctCond(srMaiorRuimPessimo.pct_ruim_pessimo, 0) + ' Ruim+Péssimo';
  document.getElementById('kpi-sint-sr-gasto').textContent      = srsByLkm[0].sr.replace('SR ','');
  document.getElementById('kpi-sint-sr-gasto-sub').innerHTML    = 'R$&nbsp;' + fmtNum(srsByLkm[0].lkm) + '/km/ano';

  // Narrativa da Síntese — ancorada no Relatório 001/2026
  const sintNarr = document.getElementById('sint-narrativa');
  if(sintNarr && malhaLiqKm.length){
    const sNorte = malhaLiqKm.find(m=>m.sr==='SR Norte')  || {};
    const sNoro  = malhaLiqKm.find(m=>m.sr==='SR Noroeste')|| {};
    const sLeste = malhaLiqKm.find(m=>m.sr==='SR Leste')  || {};
    const sOeste = malhaLiqKm.find(m=>m.sr==='SR Oeste')  || {};
    const sCG    = malhaLiqKm.find(m=>m.sr==='SR Campos Gerais')||{};
    sintNarr.innerHTML =
      `<strong>Achados do Relatório de Pesquisa nº 001/2026 — Consórcio Gerenciador EDVP (26/05/2026):</strong> ` +
      `o cruzamento entre condição SAM ${esc(anoSelecionadoMalha)} e liquidado DOPSR1 do mesmo ano revela que volume de gasto por km e qualidade da malha não seguem proporção direta. ` +
      `A ${esc(sNorte.sr||'SR Norte')} registrou o maior custo por km entre as cinco regionais ` +
      `(~R$&nbsp;${fmtNum((sNorte.liq_por_km||0)/1000,1)}&nbsp;mil/km), com condição intermediária ` +
      `(${fmtPctCond(sNorte.pct_bom,0)} Bom+Muito Bom). ` +
      `A ${esc(sNoro.sr||'SR Noroeste')}, que administra a maior extensão de malha do estado, ` +
      `alcançou a melhor condição registrada (${fmtPctCond(sNoro.pct_bom,0)} Bom+Muito Bom) ` +
      `com o menor gasto por km (~R$&nbsp;${fmtNum((sNoro.liq_por_km||0)/1000,1)}&nbsp;mil/km). ` +
      `A ${esc(sLeste.sr||'SR Leste')} apresentou o menor percentual em condição satisfatória ` +
      `(${fmtPctCond(sLeste.pct_bom,0)} Bom+Muito Bom) e a maior proporção de trechos em estado Regular ` +
      `(${fmtPctCond(sLeste.pct_regular,0)}), faixa intermediária distinta de Ruim+Péssimo. ` +
      `${esc(sOeste.sr||'SR Oeste')} e ${esc(sCG.sr||'SR Campos Gerais')} apresentaram custo por km e condição da malha próximos à média das regionais. ` +
      `A conclusão do relatório aponta que a condição da malha depende não apenas do volume de recursos aplicados, ` +
      `mas também de fatores estruturais históricos do pavimento de cada regional.`;
    const ctxEl = document.getElementById('sint-narrativa-ctx');
    if (ctxEl) ctxEl.innerHTML = sintNarr.innerHTML;
  }

  // -- Alert card Noroeste - CREMEP e EMERGENCIAL ----------
  const noroeste    = regionais.find(r => r.sr === 'SR Noroeste');
  const cremepNoro  = contratos.filter(c => (SR_DISPLAY[c.sr] || c.sr) === 'SR Noroeste' && c.tipo === 'CREMEP');
  const cremepLiq   = cremepNoro.reduce((a, c) => a + c.liquidado, 0);
  const emergNoro   = contratos.filter(c => (SR_DISPLAY[c.sr] || c.sr) === 'SR Noroeste' && c.tipo === 'EMERGENCIAL');
  const emergLiq    = emergNoro.reduce((a, c) => a + c.liquidado, 0);
  const finYear = appState.selectedFinancialYear || anoSelecionadoMalha;
  document.getElementById('alert-noroeste').innerHTML =
    `<strong>${esc(noroeste.sr)} — Contratos Emergenciais e CREMEP (${esc(finYear)}):</strong> ` +
    `${emergNoro.length} contrato${emergNoro.length !== 1 ? 's' : ''} EMERGENCIAL (${fmtR(emergLiq)}) ` +
    `e ${cremepNoro.length} CREMEP (${fmtR(cremepLiq)}) identificados na SR Noroeste — ` +
    `sinal de pressão corretiva não planejada, indicativo de deterioração em trecho sem cobertura contratual regular. ` +
    `Na matriz de sinais para investigação, a ${esc(noroeste.sr)} combina a maior extensão de malha com o menor liquidado/km observado — ` +
    `ponto de investigação técnica que pode refletir contratos emergenciais de menor rendimento por km, demanda reprimida ou perfil de intervenção ` +
    `(R$&nbsp;${fmtNum(noroeste.lkm)}/km, o menor valor entre as ${regionais.length} SRs).`;

  // ── HL cards Aba 3 ──────────────────────────────────────
  const srPiorRegional = regionais.find(r => r.sr === srMaiorRuimPessimo.sr) || {};
  const srNoroeste  = noroeste;
  const srMaiorLkm  = srsByLkm[0];
  const noroesteKmTotal = Math.round(srNoroeste.kmTotal || 0);
  document.getElementById('hl-grid').innerHTML =
    `<div class="hl-card danger">` +
      `<h4>⚠ ${esc(srMaiorRuimPessimo.sr)} — Maior Ruim+Péssimo (SAM) <span class="periodo-badge">SAM ${anoSelecionadoMalha}</span></h4>` +
      `<p>${fmtPctCond(srMaiorRuimPessimo.pct_ruim_pessimo, 1)} da malha em Ruim+Péssimo — maior proporção entre as ${regionais.length} SRs. Regular permanece separado (${fmtPctCond(srMaiorRuimPessimo.pct_regular, 1)}); condição Boa+Muito Boa: ${fmtPctCond(srMaiorRuimPessimo.pct_bom, 1)}, frente a ${fmtPctCond(srMelhorSAM.pct_bom, 1)} da ${esc(srMelhorSAM.sr)}. ` +
      `Recebe R$ ${fmtNum(srPiorRegional.lkm)}/km (${anoSelecionadoMalha}), ${(srPiorRegional.lkm||0) >= avgLkm ? 'acima' : 'abaixo'} da média estadual (R$ ${fmtNum(avgLkm)}/km).</p>` +
    `</div>` +
    `<div class="hl-card warn">` +
      `<h4>${esc(srNoroeste.sr)} — Maior Extensão de Malha <span class="periodo-badge">Dados ${anoSelecionadoMalha}</span></h4>` +
      `<p>Maior rede gerenciada do estado (${fmtNum(noroesteKmTotal)} km). ` +
      `Condição SAM ${anoSelecionadoMalha}: ${fmtPctCond(srNoroeste.pctBom, 1)} Bom+Muito Bom — com ${srNoroeste.emg} contratos emergenciais em ${esc(finYear)} ` +
      `— menor gasto/km (R$ ${fmtNum(srNoroeste.lkm)}/km).</p>` +
    `</div>` +
    `<div class="hl-card">` +
      `<h4>${esc(srMaiorLkm.sr)} — Maior Liquidado por km <span class="periodo-badge">Dados ${anoSelecionadoMalha}</span></h4>` +
      `<p>Maior liquidado absoluto (${fmtR(srMaiorLkm.liquidado)}) e maior gasto por km (R$ ${fmtNum(srMaiorLkm.lkm)}/km), ` +
      `com condição SAM de ${fmtPctCond(srMaiorLkm.pctBom, 1)} Bom+Muito Bom — frente à SR de maior Ruim+Péssimo (${esc(srMaiorRuimPessimo.sr)}).</p>` +
    `</div>`;
}

function rebuildRegionaisForSelectedYear(){
  const finYear = appState.selectedFinancialYear;
  const samYear = appState.selectedSamYear;
  const compat = compatibilidadeAtual(['condition','financial','contracts']);
  regionais = SR_ORDER.map(sr => {
    const r = appState.datasets.regionalByYear[sr]?.[samYear] || {};
    const km = r.km || {};
    const pct = r.condition?.pct || {};
    const fin = r.financial || {};
    const cont = r.contracts || {};
    const emg = r.emergencyContracts || {};
    return {
      sr,
      liquidado: compat.compatible ? (fin.liquidado || 0) : null,
      lkm: compat.compatible && fin.liquidado_por_km != null ? Math.round(fin.liquidado_por_km) : null,
      kmTotal: km.total || 0,
      pctBom: normalizePctFraction(pct.bom_muito_bom || 0),
      nc:  compat.compatible ? (cont.n_contratos || 0) : null,
      emg: compat.compatible ? (emg.n_contratos || 0) : null,
      conditionYear: samYear,
      financialYear: finYear,
      temporalCompatible: compat.compatible,
    };
  }).filter(r => appState.datasets.regionalByYear[r.sr]?.[samYear]);
  contratos = contratosPorAno[finYear] || [];
}

function updatePeriodoBadges(){
  const samYear = appState.selectedSamYear || anoSelecionadoMalha;
  const finYear = appState.selectedFinancialYear || samYear;
  const compat = verificarCompatibilidadeTemporal({ condition: samYear, financial: finYear, contracts: finYear });
  const title = compat.compatible ? '' : compat.message;
  document.querySelectorAll('[data-periodo-malha]').forEach(el => {
    el.textContent = el.dataset.periodoMalha.replaceAll('{ano}', samYear);
    el.title = '';
  });
  document.querySelectorAll('[data-periodo-financeiro]').forEach(el => {
    el.textContent = el.dataset.periodoFinanceiro.replaceAll('{ano}', finYear);
    el.title = title;
    el.classList.toggle('mix', !compat.compatible);
  });
  document.querySelectorAll('[data-periodo-contratos]').forEach(el => {
    el.textContent = el.dataset.periodoContratos.replaceAll('{ano}', finYear);
    el.title = title;
    el.classList.toggle('mix', !compat.compatible);
  });
  document.querySelectorAll('[data-periodo-combinado]').forEach(el => {
    el.textContent = el.dataset.periodoCombinado
      .replaceAll('{sam}', samYear)
      .replaceAll('{financeiro}', finYear)
      .replaceAll('{contratos}', finYear);
    el.title = title;
    el.classList.toggle('mix', !compat.compatible);
  });
}

function applyTemporalSelection(samYear){
  const requested = String(samYear);
  const samYears = appState.datasets.availableYears.sam;
  appState.selectedSamYear = samYears.includes(requested) ? requested : samYears.at(-1);
  anoSelecionadoMalha = appState.selectedSamYear;
  appState.selectedFinancialYear = appState.datasets.availableYears.financial.includes(anoSelecionadoMalha)
    ? anoSelecionadoMalha
    : (appState.datasets.availableYears.financial.at(-1) || null);

  const built = buildMalhaForAno(anoSelecionadoMalha);
  malhaKm    = built.km;
  malhaLiqKm = built.pct;
  rebuildRegionaisForSelectedYear();
  updatePeriodoBadges();
  window.DER_TEMPORAL_STATE = appState;
}

function hideLoadingOverlay(){
  const overlay = document.getElementById('loading-overlay');
  if(overlay) overlay.remove();
}

function initDashboard(d) {
  hideLoadingOverlay();

  // Data de extração no cabeçalho
  const hdrDataRef = document.getElementById('hdr-data-ref');
  if(hdrDataRef && d.generated){
    const gen = new Date(d.generated);
    hdrDataRef.textContent = 'Dados: SAM/SGP ' + gen.toLocaleDateString('pt-BR');
  }

  // ── Regionais ───────────────────────────────────────────
  // ── Visão Executiva — topo da aba Diagnóstico da Malha ──
  // Extraída em função própria (renderMalhaExecKPIs) porque depende de
  // malhaLiqKm/malhaKm, que mudam quando o usuário troca o ano no seletor
  // #filtroAnoMalha — precisa ser re-executada em onAnoMalhaChange, não só
  // uma vez aqui em initDashboard().
  renderMalhaExecKPIs();

  // Síntese Executiva, alerta CREMEP/Emergencial e cards #hl-grid — mesmo motivo
  // acima: extraída em renderSinteseExecutiva() para poder ser re-executada em
  // onAnoMalhaChange().
  renderSinteseExecutiva();

  // ── Inicializa painel ────────────────────────────────────
  activateTab('malha-diagnostico');
}

// Inicializa malhaKm/malhaLiqKm a partir de regionaisRaw para o ano mais
// recente disponível, e configura o seletor de ano (<select id="filtroAnoMalha">).
function setupMalhaPorAno(){
  const anos = anosDisponiveisMalha();
  applyTemporalSelection(anos.length ? anos[anos.length - 1] : anoSelecionadoMalha);

  const select = document.getElementById('filtroAnoMalha');
  if(select && anos.length){
    select.innerHTML = anos.map(a => `<option value="${a}"${a===anoSelecionadoMalha?' selected':''}>${a}</option>`).join('');
    select.addEventListener('change', e => onAnoMalhaChange(e.target.value));
  }
}

function prepareTemporalDatasets(d){
  regionaisRaw = d.regionais || {};
  appState.datasets.regionalByYear = buildRegionalByYear(d);
  appState.datasets.availableYears.sam = collectYears(appState.datasets.regionalByYear, entry => entry.metadata.conditionYear);
  appState.datasets.availableYears.financial = collectYears(appState.datasets.regionalByYear, entry => entry.metadata.financialYear);
  appState.datasets.availableYears.contracts = collectYears(appState.datasets.regionalByYear, entry => entry.metadata.contractsYear);
  appState.datasets.availableYears.emergencyContracts = collectYears(appState.datasets.regionalByYear, entry => entry.metadata.emergencyContractsYear);
  contratosPorAno = buildContratosPorAno(d);
}

// Chamado quando o usuário troca o ano no seletor — reconstrói malhaKm/malhaLiqKm,
// recalcula os campos derivados em `regionais` e re-renderiza as seções que
// dependem de condição da malha por ano (abas Diagnóstico da Malha e Sinais para
// Investigação — a malha SAM não tem granularidade mensal/diária, então o ano é o
// menor recorte temporal disponível na fonte).
function onAnoMalhaChange(anoStr){
  applyTemporalSelection(anoStr);
  /*
  const built = buildMalhaForAno(anoStr);
  malhaKm    = built.km;
  malhaLiqKm = built.pct;

  const kmLookup  = Object.fromEntries(malhaKm.map(m => [m.sr, m]));
  const pctLookup = Object.fromEntries(malhaLiqKm.map(m => [m.sr, m]));
  regionais.forEach(r => {
    const km  = kmLookup[r.sr];
    const pct = pctLookup[r.sr];
    if(km){
      const kmTotal = (km.ruim_km||0)+(km.pessimo_km||0)+(km.regular_km||0)+(km.boa_km||0)+(km.muito_boa_km||0);
      r.kmTotal = kmTotal;
      r.lkm = kmTotal > 0 ? Math.round(km.liquidado / kmTotal) : 0;
    }
    // pct.pct_bom vem de buildMalhaForAno() em fração (0-1); regionais[].pctBom
    // segue a mesma escala interna. A multiplicação por 100 fica restrita à apresentação.
    if(pct) r.pctBom = normalizePctFraction(pct.pct_bom || 0);
  });
  */

  // chFig6 e chScatter têm atalhos de "já existe, só atualiza cor" que não
  // recalculam posições/dados a partir de malhaLiqKm — forçar recriação completa.
  chFig6 = null;
  chScatter = null;
  chQuadrantes = null;

  /*
  document.querySelectorAll('[data-periodo-malha]').forEach(el => {
    el.textContent = el.dataset.periodoMalha.replace('{ano}', anoStr);
  });
  */

  renderMalha();
  renderAnalitica();
  if(rendered['pressao-execucao']) renderContratos(getContratosFiltrados());
  renderMalhaExecKPIs();
  renderSinteseExecutiva();
  updateMapaRodoviasAno(anoSelecionadoMalha);

  // Aba "Contexto Externo — CNT": os KPIs de ponte (bench-ponte-*) dependem de malhaLiqKm
  // (SAM do ano selecionado). Não chamamos renderBenchmark() aqui de novo porque ele refaz
  // o fetch de benchmark_nacional.json (dado da CNT, não muda com o seletor de SAM) — só
  // re-executamos updateBenchYear(), que já lê malhaLiqKm a cada chamada, e só se a aba já
  // foi inicializada (rendered['benchmark']); se o usuário ainda não visitou essa aba, os
  // KPIs de ponte serão montados corretamente na primeira visita, com o ano já atualizado.
  if(rendered['benchmark']) updateBenchYear(benchAnoIdx);
}

// Carrega rp_reconciliado.json e cruza com contratosPorAno. Falha aqui não
// derruba o painel — RP fica indisponível na sessão, mas Empenhado/Liquidado/
// Pago (que não dependem dele) continuam funcionando normalmente.
function loadRpReconciliado(){
  return loadJsonData('rp_reconciliado', `${DATA_PATH.DASHBOARD}rp_reconciliado.json`, 'rp_reconciliado.json')
    .then(rpData => { indexarRpReconciliado(rpData); attachRpAContratos(); })
    .catch(err => {
      console.error('Erro ao carregar rp_reconciliado.json — dados de RP ficarão indisponíveis nesta sessão:', err);
    });
}

if (window.STANDALONE_DATA && window.STANDALONE_DATA.der_precomputed) {
  const d      = window.STANDALONE_DATA.der_precomputed;
  tmdaPorSr = d.tmda_por_sr || {};
  prepareTemporalDatasets(d);
  loadRpReconciliado().then(()=>{
    setupMalhaPorAno();
    initDashboard(d);
  });
} else {
  Promise.all([
    loadJsonData('der_precomputed', `${DATA_PATH.ROOT}der_precomputed.json`, 'der_precomputed.json')
  ]).then(([d])=>{
    tmdaPorSr = d.tmda_por_sr || {};
    prepareTemporalDatasets(d);
    return loadRpReconciliado().then(()=>{
      setupMalhaPorAno();
      initDashboard(d);
    });
  }).catch(err=>{
    const fonteProvavel =
      /der_precomputed/i.test(err.message) ? 'der_precomputed.json' :
      'não identificada pela mensagem de erro';
    console.error('Erro ao carregar dados do painel. Fonte provável:', fonteProvavel, '— erro completo:', err);
    hideLoadingOverlay();
    document.querySelector('.tab-content').innerHTML =
      `<div class="error-panel"><h2>Não foi possível carregar os dados</h2><p>Se você abriu este arquivo com duplo clique (file://), o navegador bloqueia o carregamento dos dados por segurança. Rode um servidor local na pasta do painel — por exemplo: <code>python -m http.server</code> — e acesse via <code>http://localhost:8000/painel_der.html</code>.</p><p class="error-detail">Detalhe técnico: ${esc(err.message)} (fonte provável: ${esc(fonteProvavel)})</p><p class="error-help">Verifique o console do navegador (F12) para mais detalhes.</p></div>`;
  });
}


// Sincroniza o top do tab-nav com a altura real do header em qualquer breakpoint
(function(){
  const hdr = document.querySelector('.header-gov');
  const setTop = () => {
    if(hdr) document.documentElement.style.setProperty('--tab-nav-top', hdr.offsetHeight+'px');
  };
  setTop();
  window.addEventListener('resize', setTop);
})();
