/* painel.js - fonte do painel; embutido pelo build_standalone_html.ps1 */
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
          type: 'line', label: 'Investimento/km (R$ mil)',
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
                return ` Invest./km: R$ ${fmtNum(ctx.raw, 1)} mil`;
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
          title: { display: true, text: 'R$ mil/km', font: { size: 11 }, color: '#1F4E79' },
          grid: { display: false },
          ticks: { color: '#1F4E79', callback: v => fmtNum(v, 0) + 'k' }
        }
      }
    }
  });
  reaplicarIsolamento(chFig6, serieIsoladaFig6);
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
                `Liquidado/km: R$ ${fmtNum(d.y)} (${anoSelecionadoMalha})`,
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
          title:{display:true,text:'Liquidado/km — ' + anoSelecionadoMalha + ' (R$)',font:{size:12},color:'#555'},
          grid:{color:'#F0F0F0'},
          ticks:{callback:v=>v>=1000?fmtNum(v/1000,0)+'k':v}
        }
      }
    }
  });
  renderMatrizRecomendacao();
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
        tooltip:{callbacks:{label:ctx=>` R$ ${fmtNum(ctx.raw)}/km de rede total`}}
      },
      scales:{
        x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v>=1000?fmtNum(v/1000,0)+'k':v},title:{display:true,text:'R$/km',font:{size:11}}},
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

let chContSR = null, chContTipo = null;
let contratoFiltersReady = false;

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

function getContratosFiltrados(){
  const f = getContratoFilterValues();
  return contratos.filter(c=>{
    const srTxt = SR_DISPLAY[c.sr] || c.sr || '';
    const tipoTxt = c.tipo || '';
    const statusTxt = contratoStatusText(c);
    return (!f.busca || normalizeFilterText(c.contrato).includes(f.busca)) &&
      (!f.regiao || srTxt === f.regiao) &&
      (!f.tipo || tipoTxt === f.tipo) &&
      (!f.status || statusTxt === f.status);
  });
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

  contratoFiltersReady = true;
}

function updateContratoFilterCount(qtd){
  const countEl = document.getElementById('contratoFilterCount');
  if(countEl) countEl.textContent = `Exibindo ${qtd} de ${contratos.length} contratos`;
  const empty = document.getElementById('contratoFilterEmpty');
  if(empty) empty.hidden = qtd > 0;
}

function renderContratos(data = contratos){
  if(!contratos.length) return;
  setupContratoTableFilters();
  updatePeriodoBadges();

  const totalEmp  = data.reduce((a,c)=>a+c.empenhado,0);
  const totalLiq  = data.reduce((a,c)=>a+c.liquidado,0);
  const pctExec   = totalEmp>0?(totalLiq/totalEmp*100):0;
  document.getElementById('kpi-cont-total').textContent = data.length;
  document.getElementById('kpi-cont-emp').innerHTML     = fmtR(totalEmp);
  document.getElementById('kpi-cont-liq').innerHTML     = fmtR(totalLiq);
  document.getElementById('kpi-cont-exec').textContent  = fmtNum(pctExec,1)+'%';
  const execCard = document.getElementById('kpi-cont-exec-card');
  if(execCard) execCard.classList.toggle('alert', pctExec<70);

  // Destrói instâncias anteriores antes de recriar
  if(chContSR)  { chContSR.destroy();  chContSR  = null; }
  if(chContTipo){ chContTipo.destroy(); chContTipo = null; }

  // Chart 1 — Empenhado / Liquidado / Pago por SR
  const SR_ORDER_UP=['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];
  const srLabels = SR_ORDER_UP.map(s=>SR_DISPLAY[s].replace('SR ',''));
  const empBySR  = SR_ORDER_UP.map(sr=>data.filter(c=>c.sr===sr).reduce((a,c)=>a+c.empenhado,0));
  const liqBySR  = SR_ORDER_UP.map(sr=>data.filter(c=>c.sr===sr).reduce((a,c)=>a+c.liquidado,0));
  const pagBySR  = SR_ORDER_UP.map(sr=>data.filter(c=>c.sr===sr).reduce((a,c)=>a+(c.pago||0),0));

  const fmtCur = v => v>=1e9?'R$ '+fmtNum(v/1e9,2)+' bi':v>=1e6?'R$ '+fmtNum(v/1e6,1)+' mi':'R$ '+fmtNum(v);

  chContSR = makeChart(document.getElementById('chartContSR'),{
    type:'bar',
    data:{
      labels: srLabels,
      datasets:[
        { label:'Empenhado', data:empBySR, backgroundColor:'#BDD7EE', borderRadius:3 },
        { label:'Liquidado', data:liqBySR, backgroundColor:'#2E75B6', borderRadius:3 },
        { label:'Pago',      data:pagBySR, backgroundColor:'#1F4E79', borderRadius:3 }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{
          position:'bottom',
          labels:{font:{size:11},padding:12},
          onClick(evt, legendItem, legend){
            // Toggle independente por série (Empenhado / Liquidado / Pago)
            const idx  = legendItem.datasetIndex;
            const meta = legend.chart.getDatasetMeta(idx);
            meta.hidden = !meta.hidden;
            legend.chart.update();
          }
        },
        tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtCur(ctx.raw)}`}}
      },
      scales:{
        x:{grid:{display:false}},
        y:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v>=1e6?fmtNum(v/1e6,0)+' M':v}}
      }
    }
  });

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

  renderTblContratos(data);
  renderSRTipoMatrix();
  updateContratoFilterCount(data.length);
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

function renderTblContratos(data){
  const tipoBadge = t=>{
    const cls={'PROCONSERVA':'b-blue','COP':'b-green','INTEGRA':'b-blue','CREMEP':'b-yellow','EMERGENCIAL':'b-red'};
    return `<span class="badge ${cls[t]||'b-gray'}">${esc(t)}</span>`;
  };
  const tblBody = document.getElementById('tbodyContratos');
  if(!tblBody) return;
  tblBody.innerHTML = data.map(c=>{
    const pct = c.empenhado>0?c.liquidado/c.empenhado*100:0;
    const emgRow = c.tipo==='EMERGENCIAL'?'tr-emergencial':'';
    return `<tr class="${emgRow}">
      <td><strong>${esc(c.contrato)}</strong></td>
      <td>${esc(SR_DISPLAY[c.sr]||c.sr)}</td>
      <td>${tipoBadge(c.tipo)}</td>
      <td>${fmtRF(c.empenhado)}</td>
      <td>${fmtRF(c.liquidado)}</td>
      <td>${fmtRF(c.pago)}</td>
      <td>${execBadge(pct)}</td>
    </tr>`;
  }).join('');
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
    ['quadrantesResumo','matrizRecomendacaoTabela'].forEach(id => {
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
    document.getElementById('kpi-relacao-sr-maior-sub').textContent = fmtNum(srMaiorRelacao.kmPorMilhao,2)+' km / R$ mi (relacao descritiva)';
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
          tooltip:{callbacks:{label:ctx=>` R$ ${fmtNum(ctx.raw)} liquidados / km em condicao favoravel`}}
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
                `Liquidado/km observado: R\$ ${fmtNum(d.y)}`,
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
          title: { display: true, text: 'Liquidado/km (R$)', font: { size: 11 } },
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
          <th>Liquidado/km observado (R$)</th>
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
// MATRIZ DE ENCAMINHAMENTO POR SR
// =======================================================

function renderMatrizRecomendacao() {
  const container = document.getElementById('matrizRecomendacaoTabela');
  console.log('[Matriz] container:', !!container, '| regionais:', regionais.length, '| malhaLiqKm:', malhaLiqKm.length);
  if (!container || !regionais.length || !malhaLiqKm.length) { console.warn('[Matriz] guard ativado — abortando'); return; }

  const spcDados   = calcularSinalizadorPressaoConservacaoPainel(regionais);
  const quadDados  = calcularQuadrantesNecessidadeInvestimento(regionais);
  const benchDados = calcularBenchmarkInterno(regionais);
  const samLookup  = Object.fromEntries(malhaLiqKm.map(m => [m.sr, m]));
  const spcMap     = Object.fromEntries(spcDados.map(r  => [r.sr, r]));
  const quadMap    = Object.fromEntries(quadDados.map(r  => [r.sr, r]));
  const benchMap   = Object.fromEntries(benchDados.map(r => [r.sr, r]));

  function classificarSituacao(sr) {
    const spc   = spcMap[sr]   || {};
    const quad  = quadMap[sr]  || {};
    const bench = benchMap[sr] || {};
    const sam   = samLookup[sr] || {};
    const spcMedio   = (spc.score || 0) >= LIMIAR_PRESSAO_MEDIA;
    const altaCrit   = quad.quadrante && (quad.quadrante.startsWith('O esforço') || quad.quadrante.startsWith('Há demanda'));
    const altaInv    = quad.quadrante && (quad.quadrante.startsWith('O esforço') || quad.quadrante.startsWith('O gasto'));
    const custoAlto  = bench.classificacao === 'Maior custo relativo observado';
    const custoBaixo = bench.classificacao === 'Menor custo relativo observado';
    const pctBom     = normalizePctFraction(sam.pct_bom);
    if (custoAlto && altaInv && pctBom < 0.70)         return 'pressao-custo';
    if (altaCrit && !altaInv)                          return 'crit-estrutural';
    if (custoBaixo && pctBom >= 0.60)                  return 'condicao-favoravel';
    if (spcMedio && (spc.nEmg || 0) > 0.5)            return 'emergencial';
    return 'atencao';
  }

  function gerarCard(sr) {
    const spc   = spcMap[sr]   || {};
    const quad  = quadMap[sr]  || {};
    const bench = benchMap[sr] || {};
    const sam   = samLookup[sr] || {};
    const reg   = regionais.find(r => r.sr === sr) || {};
    const sit   = classificarSituacao(sr);
    const cor   = SR_COLORS[sr] || '#1F4E79';

    const nomeCurto  = sr.replace('SR ', '');
    const lkmFmt     = 'R$ ' + fmtNum(reg.lkm || 0);
    const pctBomFmt  = fmtPctCond(sam.pct_bom, 0);
    const pctCritFmt = fmtPctCond(sam.pct_ruim_pessimo, 0);
    const spcFmt     = fmtNum(spc.score || 0, 3);
    const pctEmgFmt  = fmtNum(spc.pctEmg || 0, 0) + '%';
    const desvioSinal = (bench.desvio || 0) >= 0 ? '+' : '';
    const desvioFmt  = desvioSinal + fmtNum((bench.desvio || 0) * 100, 1) + '%';
    const quadLabel  = esc(quad.quadrante || '—');

    const T = {
      'pressao-custo': {
        badge: 'matriz-sit-pressao-custo', situacao: 'Maior liquidado/km com condição intermediária',
        evidencia: `Liquidado/km observado: ${lkmFmt} (${desvioFmt} da mediana) · ${pctCritFmt} de malha crítica · sinal: ${quadLabel}`,
        interpretacao: `Maior esforço financeiro observado com condição SAM de ${pctBomFmt} Bom+Muito Bom — diferença relativa observada que pode refletir tipo de intervenção, porte da malha ou contratos de recuperação profunda`,
        acao: 'Investigar mix contratual',
        encaminhamento: `Verificar proporção preventivo vs. corretivo na carteira ativa de ${nomeCurto} e avaliar se os contratos vigentes estão alocados nos trechos de maior criticidade técnica (SAM)`
      },
      'crit-estrutural': {
        badge: 'matriz-sit-crit-estrutural', situacao: 'Alta criticidade, menor liquidado/km observado',
        evidencia: `${pctCritFmt} de malha Ruim+Péssimo (SAM ${anoSelecionadoMalha}) · menor liquidado/km observado: ${lkmFmt} · sinal: ${quadLabel}`,
        interpretacao: `Combinação de criticidade acima da mediana com menor esforço financeiro observado — sinal para investigação técnica sobre demanda reprimida, restrições contratuais, passivo acumulado ou intervenções previstas fora do recorte analisado`,
        acao: 'Investigar carteira e programação',
        encaminhamento: `Verificar se há demanda reprimida, contratos em fase de licitação ou intervenções estruturais previstas para ${nomeCurto}; avaliar passivo acumulado e extensão da malha antes de concluir sobre adequação alocativa`
      },
      'condicao-favoravel': {
        badge: 'matriz-sit-condicao-favoravel', situacao: 'Ponto de atenção analítica - condição favorável',
        evidencia: `Liquidado/km observado: ${lkmFmt} (${desvioFmt} da mediana) · ${pctBomFmt} Bom+Muito Bom (SAM ${anoSelecionadoMalha}) · SPC ${spcFmt}`,
        interpretacao: `Menor liquidado/km observado junto a boa condição SAM - combinação descritiva que merece investigação sobre tipo de intervenção, histórico de manutenção e extensão da malha administrada`,
        acao: 'Investigar e documentar contexto',
        encaminhamento: `Registrar perfil de intervenções em ${nomeCurto} para compreender os fatores associados à condição observada; acompanhar o SPC (atual ${spcFmt}) em novos ciclos SAM`
      },
      'emergencial': {
        badge: 'matriz-sit-emergencial', situacao: 'Pressão de demanda corretiva',
        evidencia: `${pctEmgFmt} de contratos emergenciais · SPC ${spcFmt} · ${pctCritFmt} de malha crítica (SAM ${anoSelecionadoMalha})`,
        interpretacao: `Concentração de contratos emergenciais indica ciclo reativo — parte do esforço financeiro observado pode estar associada a intervenções de urgência em vez de manutenção programada`,
        acao: 'Investigar tipologia de intervenção',
        encaminhamento: `Investigar causas da concentração emergencial em ${nomeCurto}; avaliar se o liquidado/km de ${lkmFmt} é influenciado por mobilizações de menor rendimento por km atendido`
      },
      'atencao': {
        badge: 'matriz-sit-atencao', situacao: 'Perfil para acompanhamento',
        evidencia: `Liquidado/km observado: ${lkmFmt} · ${pctBomFmt} Bom+Muito Bom (SAM ${anoSelecionadoMalha}) · SPC ${spcFmt} · sinal: ${quadLabel}`,
        interpretacao: `Perfil sem sinal de alerta agudo no período analisado — acompanhamento dos indicadores de condição no próximo ciclo SAM é suficiente no curto prazo`,
        acao: 'Monitoramento contínuo',
        encaminhamento: `Manter programação vigente em ${nomeCurto} e acompanhar indicadores de condição no próximo ciclo SAM`
      }
    };

    const t = T[sit] || T['atencao'];

    return `<div class="matriz-sr-card">
      <div>
        <div class="matriz-sr-name" style="color:${cor}">${esc(sr)}</div>
        <span class="matriz-sit-badge ${t.badge}">${esc(t.situacao)}</span>
      </div>
      <div>
        <div class="matriz-col-label">Evidência</div>
        <div class="matriz-col-body">${t.evidencia}</div>
      </div>
      <div>
        <div class="matriz-col-label">Interpretação</div>
        <div class="matriz-col-body">${esc(t.interpretacao)}</div>
      </div>
      <div>
        <div class="matriz-col-label">Encaminhamento</div>
        <div class="matriz-enc-acao">${esc(t.acao)}</div>
        <div class="matriz-col-body">${esc(t.encaminhamento)}</div>
      </div>
    </div>`;
  }

  const SR_ORDER_M = ['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];
  container.innerHTML = SR_ORDER_M.map(gerarCard).join('');
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
  document.getElementById('kpi-sint-sr-gasto-sub').innerHTML    = 'R$&nbsp;' + fmtNum(srsByLkm[0].lkm) + '/km';

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

function initDashboard(d) {
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

if (window.STANDALONE_DATA && window.STANDALONE_DATA.der_precomputed) {
  const d      = window.STANDALONE_DATA.der_precomputed;
  tmdaPorSr = d.tmda_por_sr || {};
  prepareTemporalDatasets(d);
  setupMalhaPorAno();
  initDashboard(d);
} else {
  Promise.all([
    loadJsonData('der_precomputed', `${DATA_PATH.ROOT}der_precomputed.json`, 'der_precomputed.json')
  ]).then(([d])=>{
    tmdaPorSr = d.tmda_por_sr || {};
    prepareTemporalDatasets(d);
    setupMalhaPorAno();
    initDashboard(d);
  }).catch(err=>{
    const fonteProvavel =
      /der_precomputed/i.test(err.message) ? 'der_precomputed.json' :
      'não identificada pela mensagem de erro';
    console.error('Erro ao carregar dados do painel. Fonte provável:', fonteProvavel, '— erro completo:', err);
    document.querySelector('.tab-content').innerHTML =
      `<div class="error-panel"><h2>Erro ao carregar dados</h2><p>Não foi possível carregar os arquivos de dados.</p><p class="error-detail">Detalhe: ${esc(err.message)}</p><p class="error-help">Abra o painel a partir de um servidor local (ex: <code>python -m http.server</code> na raiz do projeto).</p><p class="error-help">Verifique o console do navegador (F12) para detalhes técnicos.</p></div>`;
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
