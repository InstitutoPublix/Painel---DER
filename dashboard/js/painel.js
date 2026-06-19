// =======================================================
// DADOS — AÇÃO 8398 DER-PR
// =======================================================

const DATA_PATH = Object.freeze({
  ROOT: '../data/',
  DASHBOARD: 'data/'
});

const STANDALONE_DATA = window.STANDALONE_DATA || null;
const STANDALONE_MODE = !!STANDALONE_DATA;

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
let iri          = [];
let fwd          = [];

// Dados de DATA_PATH.ROOT + dados_extras.json
let contratos  = [];
let malhaKm    = [];
let malhaLiqKm = [];


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
const LIMIAR_PARTICIPACAO  = 5;    // p.p.: >+5 = gasta acima da criticidade relativa; <−5 = abaixo
const LIMIAR_ADERENCIA_LOW  = 0.8; // índice abaixo deste → possível subalocação relativa
const LIMIAR_ADERENCIA_HIGH = 1.2; // índice acima deste → acima da participação crítica
const LIMIAR_PRESSAO_ALTA   = 0.67; // IPF ≥ 0.67 → pressão alta (vermelho)
const LIMIAR_PRESSAO_MEDIA  = 0.33; // IPF ≥ 0.33 → pressão média (amarelo); abaixo → baixa (verde)

// ── Instâncias de gráficos reutilizáveis ─────────────────
let chScatter        = null;
let chScatterFilter  = '';
let chFig6           = null;
let chMalhaIRI       = null, chMalhaFWD  = null;
let chQuadrantes     = null;

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

function showChartRenderError(canvas, err){
  const wrap = canvas && canvas.parentElement;
  if(!wrap || wrap.querySelector('.chart-error-inline')) return;
  const msg = document.createElement('div');
  msg.className = 'chart-error-inline';
  msg.textContent = 'Grafico indisponivel nesta abertura. Os dados do painel continuam carregados.';
  wrap.appendChild(msg);
  console.error('Erro ao renderizar grafico', canvas && canvas.id ? canvas.id : canvas, err);
}

function makeChart(canvas, config){
  const el = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
  if(!el || !window.Chart) return null;
  try{
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
}

function renderEficiencia(sr=''){
  srFiltro = sr;
  const samLookup = Object.fromEntries(malhaLiqKm.map(m => [m.sr, m]));
  const tbody = document.getElementById('tbodyReg');
  tbody.innerHTML = regionais.map(r=>{
    const isNorte = r.sr==='SR Norte';
    const isSelected = !sr || r.sr===sr;
    const rowCls = isNorte ? 'tr-norte' : '';
    const dimCls = sr && !isSelected ? 'row-dimmed' : '';
    const sam = samLookup[r.sr] || {};
    const pctBomSAM = sam.pct_bom != null ? fmtNum(sam.pct_bom * 100, 0) + '%' : '—';
    const emgHtml = r.emg>0
      ? `<span class="emg-count">${r.emg} ⚠️</span>`
      : r.emg;
    return `<tr class="${rowCls} ${dimCls}">
      <td><strong>${esc(r.sr)}</strong></td>
      <td>${fmtRF(r.liquidado)}</td>
      <td>R$&nbsp;${r.lkm.toLocaleString('pt-BR')}</td>
      <td>${pctBomSAM}</td>
      <td>${pb(r.iri)}</td>
      <td>${pb(r.fwd,45)}</td>
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
  const colorFwd = pct => pct>=30?'#C00000':pct>=24?'#E07B00':'#2E75B6';

  const baseRadius = r => 8 + Math.sqrt((r.kmTotal||1)/maxKm)*14;

  const samLookup = Object.fromEntries(malhaLiqKm.map(m=>[m.sr, m]));
  const scatterData = regionais.map(r=>{
    const sam = samLookup[r.sr] || {};
    return {
      x: +(( sam.pct_ruim_pessimo || 0) * 100).toFixed(2),
      y: r.lkm, sr: r.sr,
      pctBom: +((sam.pct_bom || 0) * 100).toFixed(1),
      fwd: r.fwd, emg: r.emg, kmTotal: r.kmTotal
    };
  });
  const pts = scatterData.map(d=>({x:d.x,y:d.y}));
  const reg = _linearRegression(pts);
  const xMin = Math.min(...scatterData.map(d=>d.x));
  const xMax = Math.max(...scatterData.map(d=>d.x));
  const trend = [{x:xMin,y:reg.slope*xMin+reg.intercept},{x:xMax,y:reg.slope*xMax+reg.intercept}];

  const pointColors  = scatterData.map(d=>{
    const hex = colorFwd(d.fwd);
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
                `% Ruim+Péssimo (SAM 2025): ${fmtNum(d.x,1)}%`,
                `% Bom+Muito Bom (SAM 2025): ${fmtNum(d.pctBom,0)}%`,
                `FWD crítico (estruct. 2021–22): ${fmtNum(d.fwd,1)}%`,
                `Liquidado/km: R$ ${fmtNum(d.y)} (2025)`,
                `Malha total: ${fmtNum(d.kmTotal||0,0)} km`
              ];
              if(d.emg>0) lines.push(`Contratos emergenciais 2025: ${d.emg}`);
              return lines;
            }
          }
        }
      },
      scales:{
        x:{
          title:{display:true,text:'% Ruim+Péssimo — SAM 2025',font:{size:12},color:'#555'},
          grid:{color:'#F0F0F0'},
          ticks:{callback:v=>v+'%'}
        },
        y:{
          title:{display:true,text:'Liquidado/km — 2025 (R$)',font:{size:12},color:'#555'},
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
  // Ordena SRs por criticidade (ruim+pessimo) decrescente (pior no topo)
  const iriSorted = [...iri].sort((a,b)=>(b.ruim+b.pessimo)-(a.ruim+a.pessimo));
  const fwdSorted = [...fwd].sort((a,b)=>(b.ruim+b.pessimo)-(a.ruim+a.pessimo));

  const stackDatasets = (arr) => [
    { label:'Péssimo',  data:arr.map(r=>r.pessimo),  backgroundColor:COND_COLORS.pessimo  },
    { label:'Ruim',     data:arr.map(r=>r.ruim),     backgroundColor:COND_COLORS.ruim     },
    { label:'Regular',  data:arr.map(r=>r.regular),  backgroundColor:COND_COLORS.regular  },
    { label:'Bom',      data:arr.map(r=>r.bom),      backgroundColor:COND_COLORS.bom      },
    { label:'Muito Bom',data:arr.map(r=>r.muito_bom),backgroundColor:COND_COLORS.muito_bom}
  ];

  const stackOpts = {
    indexAxis:'y',
    responsive:true,
    maintainAspectRatio:false,
    plugins:{
      legend:{
        position:'bottom',
        labels:{font:{size:11},padding:12},
        onClick(evt, legendItem, legend){
          // Toggle independente: cada categoria pode ser ocultada/exibida separadamente
          const idx  = legendItem.datasetIndex;
          const meta = legend.chart.getDatasetMeta(idx);
          meta.hidden = !meta.hidden;
          legend.chart.update();
        }
      },
      tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.x,1)}%`}}
    },
    scales:{
      x:{stacked:true,max:100,ticks:{callback:v=>v+'%'},grid:{color:'#F0F0F0'}},
      y:{stacked:true,grid:{display:false}}
    }
  };

  chMalhaIRI = makeChart(document.getElementById('chartIRI'),{
    type:'bar',
    data:{ labels:iriSorted.map(r=>r.sr.replace('SR ','')), datasets:stackDatasets(iriSorted) },
    options:stackOpts
  });
  chMalhaFWD = makeChart(document.getElementById('chartFWD'),{
    type:'bar',
    data:{ labels:fwdSorted.map(r=>r.sr.replace('SR ','')), datasets:stackDatasets(fwdSorted) },
    options:stackOpts
  });

  // Gráfico de extensão absoluta em km
  if(malhaKm.length > 0){
    const kmSorted = [...malhaKm].sort((a,b)=>(a.ruim_km+a.pessimo_km)-(b.ruim_km+b.pessimo_km));
    makeChart(document.getElementById('chartMalhaKm'),{
      type:'bar',
      data:{
        labels: kmSorted.map(r=>r.sr.replace('SR ','')),
        datasets:[
          { label:'Péssimo',   data:kmSorted.map(r=>r.pessimo_km),  backgroundColor:COND_COLORS.pessimo   },
          { label:'Ruim',      data:kmSorted.map(r=>r.ruim_km),     backgroundColor:COND_COLORS.ruim      },
          { label:'Regular',   data:kmSorted.map(r=>r.regular_km),  backgroundColor:COND_COLORS.regular   },
          { label:'Boa',       data:kmSorted.map(r=>r.boa_km),      backgroundColor:COND_COLORS.bom       },
          { label:'Muito Boa', data:kmSorted.map(r=>r.muito_boa_km),backgroundColor:COND_COLORS.muito_bom }
        ]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{position:'bottom',labels:{font:{size:11},padding:12}},
          tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.x,1)} km`}}
        },
        scales:{
          x:{stacked:true,ticks:{callback:v=>fmtNum(v)+' km'},grid:{color:'#F0F0F0'}},
          y:{stacked:true,grid:{display:false}}
        }
      }
    });

    const critSorted = [...malhaKm]
      .map(r=>({sr:r.sr, crit:(r.ruim_km||0)+(r.pessimo_km||0), ruim:r.ruim_km||0, pessimo:r.pessimo_km||0}))
      .sort((a,b)=>b.crit-a.crit);
    makeChart(document.getElementById('chartKmCriticos'),{
      type:'bar',
      data:{
        labels: critSorted.map(r=>r.sr.replace('SR ','')),
        datasets:[
          { label:'Ruim', data:critSorted.map(r=>r.ruim), backgroundColor:'#C00000', borderRadius:3 },
          { label:'Péssimo', data:critSorted.map(r=>r.pessimo), backgroundColor:'#E07B00', borderRadius:3 }
        ]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{position:'bottom',labels:{font:{size:11},padding:12}},
          tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.x,1)} km`}}
        },
        scales:{
          x:{stacked:true,ticks:{callback:v=>fmtNum(v)+' km'},grid:{color:'#F0F0F0'}},
          y:{stacked:true,grid:{display:false}}
        }
      }
    });
  }
  renderWaffleRodovias();
  renderMapaRodovias();
}

function renderWaffleRodovias(){
  const container = document.getElementById('waffleRodovias');
  if(!container || !malhaKm.length) return;
  const SEGS = [
    {key:'pessimo_km',  label:'Péssimo',  color:COND_COLORS.pessimo  },
    {key:'ruim_km',     label:'Ruim',     color:COND_COLORS.ruim     },
    {key:'regular_km',  label:'Regular',  color:COND_COLORS.regular  },
    {key:'boa_km',      label:'Boa',      color:COND_COLORS.bom      },
    {key:'muito_boa_km',label:'Muito Boa',color:COND_COLORS.muito_bom}
  ];
  const data = malhaKm
    .map(r => ({...r, total: SEGS.reduce((s,sg) => s+(r[sg.key]||0), 0)}))
    .sort((a,b) => b.total - a.total);
  const KM_PER_BLOCK = Math.max(1, Math.ceil(data[0].total / 50));
  const rows = data.map(r => {
    const srName = r.sr.replace('SR ','');
    let blocks = '';
    for(const sg of SEGS){
      const km = r[sg.key] || 0;
      if(km <= 0) continue;
      const n = Math.max(1, Math.round(km / KM_PER_BLOCK));
      for(let i=0; i<n; i++){
        const approx = Math.round(i < n-1 ? KM_PER_BLOCK : km - (n-1)*KM_PER_BLOCK);
        blocks += `<div class="waffle-block" style="background:${sg.color}" title="${esc(sg.label)}: ~${fmtNum(approx)} km"></div>`;
      }
    }
    return `<div class="waffle-row"><div class="waffle-label"><strong>${esc(srName)}</strong><span class="waffle-km">${fmtNum(Math.round(r.total))} km</span></div><div class="waffle-blocks">${blocks}</div></div>`;
  }).join('');
  const legend = SEGS.map(sg =>
    `<div class="waffle-legend-item"><div class="waffle-legend-swatch" style="background:${sg.color}"></div><span>${esc(sg.label)}</span></div>`
  ).join('');
  container.innerHTML =
    `<div class="chart-title">Faixa de Condição da Malha por Regional <span class="fn" style="font-style:normal;color:#888;font-weight:400">1 bloco ≈ ${fmtNum(KM_PER_BLOCK)} km</span> <span class="periodo-badge">SAM 2025</span></div>` +
    `<div class="waffle-grid" style="margin-top:16px">${rows}</div>` +
    `<div class="waffle-legend">${legend}</div>` +
    `<p class="chart-source" style="margin-top:8px"><strong>Fonte:</strong> Condição da malha 2025.xlsx (SAM 2025).</p>`;
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
  'SR NORTE':'SR Norte','SR NOROESTE':'SR Noroeste','SR OESTE':'SR Oeste'
};

const TIPO_COLORS = {
  'PROCONSERVA':'#2E75B6','COP':'#70AD47','INTEGRA':'#1F4E79',
  'CREMEP':'#FFC000','EMERGENCIAL':'#C00000'
};

let chContSR = null, chContTipo = null;
let contratoFiltersReady = false;

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
  return {
    busca: normalizeFilterText(document.getElementById('filtroContratoBusca')?.value || ''),
    regiao: document.getElementById('filtroContratoRegiao')?.value || '',
    tipo: document.getElementById('filtroContratoTipo')?.value || '',
    status: document.getElementById('filtroContratoStatus')?.value || ''
  };
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
  const SR_ORDER_UP=['SR LESTE','SR CAMPOS GERAIS','SR NORTE','SR NOROESTE','SR OESTE'];
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

  const srs  = ['SR LESTE','SR CAMPOS GERAIS','SR NORTE','SR NOROESTE','SR OESTE'];
  const tipos = Object.keys(TIPO_COLORS);
  const tipoLabel = {PROCONSERVA:'ProConserva',COP:'COP',INTEGRA:'IntegraParaná',CREMEP:'CREMEP',EMERGENCIAL:'Emergencial'};

  const cnt = {};
  srs.forEach(sr => { cnt[sr] = {}; tipos.forEach(t => { cnt[sr][t] = 0; }); });
  contratos.forEach(c => { if(cnt[c.sr] && cnt[c.sr][c.tipo] !== undefined) cnt[c.sr][c.tipo]++; });

  const tiposAtivos = tipos.filter(t => srs.some(sr => cnt[sr][t] > 0));

  el.innerHTML =
    `<div class="chart-title" style="margin-bottom:8px">Distribuição de Contratos por SR e Tipo <span class="periodo-badge">Dados 2025</span></div>` +
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
    `<p class="chart-source"><strong>Fonte:</strong> Contratos DOPSR1 por Regional.xlsx.</p>`;
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
// ABA 4 — RETORNO E ALINHAMENTO REGIONAL
// =======================================================

function renderAnalitica(){
  // ── Eficiência transversal (via malhaKm) ─────────────────
  if(malhaKm.length > 0){
    const roiData = malhaKm.map(r=>{
      const kmBom = r.boa_km + r.muito_boa_km;
      return {
        sr: r.sr,
        kmBom,
        liquidado: r.liquidado,
        kmPorMilhao: r.liquidado > 0 ? kmBom / r.liquidado * 1e6 : 0,
        custoPorKmBom: kmBom > 0 ? r.liquidado / kmBom : null
      };
    });

    const totalKmBom  = roiData.reduce((a,r)=>a+r.kmBom, 0);
    const totalLiqROI = roiData.reduce((a,r)=>a+r.liquidado, 0);
    const avgKmMi     = totalLiqROI > 0 ? totalKmBom / totalLiqROI * 1e6 : 0;
    const srMaisEfic  = roiData.reduce((a,b)=>b.kmPorMilhao>a.kmPorMilhao?b:a);
    const avgCusto    = totalKmBom > 0 ? totalLiqROI / totalKmBom : null;

    document.getElementById('kpi-roi-km-bom').textContent        = fmtNum(totalKmBom,1)+' km';
    document.getElementById('kpi-roi-km-por-mi').textContent     = fmtNum(avgKmMi,2)+' km';
    document.getElementById('kpi-roi-sr-eficiente').textContent  = srMaisEfic.sr.replace('SR ','');
    document.getElementById('kpi-roi-sr-eficiente-sub').textContent = fmtNum(srMaisEfic.kmPorMilhao,2)+' km / R$ mi';
    document.getElementById('kpi-roi-custo-km').innerHTML        = 'R$&nbsp;'+fmtNum(avgCusto||0);

    // Chart: km bom por R$ milhão liquidado (decrescente = mais eficiente primeiro)
    const sortedROI = [...roiData].sort((a,b)=>b.kmPorMilhao-a.kmPorMilhao);
    makeChart(document.getElementById('chartROIKm'),{
      type:'bar',
      data:{
        labels: sortedROI.map(r=>r.sr.replace('SR ','')),
        datasets:[{
          data: sortedROI.map(r=>r.kmPorMilhao),
          backgroundColor: sortedROI.map(r=>SR_COLORS[r.sr]||'#888'),
          borderRadius:3
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:ctx=>` ${fmtNum(ctx.raw,2)} km / R$ milhão liquidado`}}
        },
        scales:{
          x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>fmtNum(v,1)+' km'}},
          y:{grid:{display:false}}
        }
      }
    });

    // Chart: custo por km em boa condição (crescente = mais eficiente primeiro)
    const sortedCusto = [...roiData].filter(r=>r.custoPorKmBom!=null).sort((a,b)=>a.custoPorKmBom-b.custoPorKmBom);
    makeChart(document.getElementById('chartROICusto'),{
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
          tooltip:{callbacks:{label:ctx=>` R$ ${fmtNum(ctx.raw)} / km em boa cond.`}}
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
  renderEficiencia('');
  renderBenchmarkInterno();
  renderParticipacaoCriticidade();
  renderQuadrantesNecessidade();
  renderIndicePressaoFutura();
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
    if (desvio > LIMIAR_BENCHMARK)       classificacao = 'Custo elevado relativo';
    else if (desvio < -LIMIAR_BENCHMARK) classificacao = 'Custo baixo relativo';
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
    if (c === 'Custo elevado relativo') return 'b-red';
    if (c === 'Custo baixo relativo')   return 'b-green';
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
        ? '<span class="badge b-red">acima da criticidade</span>'
        : r.indice < LIMIAR_ADERENCIA_LOW
          ? '<span class="badge b-green">possível subalocação</span>'
          : '<span class="badge b-yellow">proporcional</span>';
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
    if      ( altaCrit &&  altoInv) quadrante = 'Alta criticidade + Alto investimento';
    else if ( altaCrit && !altoInv) quadrante = 'Alta criticidade + Baixo investimento';
    else if (!altaCrit &&  altoInv) quadrante = 'Baixa criticidade + Alto investimento';
    else                            quadrante = 'Baixa criticidade + Baixo investimento';
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
        { x1: mxPx, x2: right, y1: top,  y2: myPx,   fill: 'rgba(224,123,0,0.07)',   label: ['Alta crit.', 'Alto invest.'],    tx: right-6, ty: top+6,    ta:'right', tb:'top'    },
        { x1: left,  x2: mxPx, y1: top,  y2: myPx,   fill: 'rgba(150,150,150,0.05)', label: ['Baixa crit.', 'Alto invest.'],   tx: left+6,  ty: top+6,    ta:'left',  tb:'top'    },
        { x1: mxPx, x2: right, y1: myPx, y2: bottom, fill: 'rgba(192,0,0,0.09)',     label: ['Alta crit.', '⚠ Baixo invest.'], tx: right-6, ty: bottom-6, ta:'right', tb:'bottom' },
        { x1: left,  x2: mxPx, y1: myPx, y2: bottom, fill: 'rgba(112,173,71,0.06)',  label: ['Baixa crit.', 'Baixo invest.'],  tx: left+6,  ty: bottom-6, ta:'left',  tb:'bottom' }
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
                `% Ruim+Péssimo (SAM 2025): ${fmtNum(d.x, 1)}%`,
                `Liquidado/km: R\$ ${fmtNum(d.y)}`,
                `Quadrante: ${d.quadrante}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: '% Ruim+Péssimo (SAM 2025)', font: { size: 11 } },
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
    const quadBadge = q => {
      if (q === 'Alta criticidade + Baixo investimento')  return 'b-red';
      if (q === 'Baixa criticidade + Baixo investimento') return 'b-green';
      return 'b-yellow';
    };
    const quadOrder = [
      'Alta criticidade + Baixo investimento',
      'Alta criticidade + Alto investimento',
      'Baixa criticidade + Alto investimento',
      'Baixa criticidade + Baixo investimento'
    ];
    const sorted = [...dados].sort((a, b) => quadOrder.indexOf(a.quadrante) - quadOrder.indexOf(b.quadrante));
    resumoDiv.innerHTML = `<div class="table-wrap" style="margin-top:16px">
      <table>
        <thead><tr>
          <th>SR</th>
          <th>% Ruim+Péssimo (SAM 2025)</th>
          <th>Liquidado/km (R$)</th>
          <th>Quadrante</th>
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
// ÍNDICE DE PRESSÃO FUTURA
// =======================================================

function calcularIndicePressaoFutura(dadosPorSR) {
  // Pesos dos componentes (escolha metodológica — iguais por simplicidade, ajustáveis)
  const PESO_REGULAR     = 1 / 3; // sinal de risco de deterioração
  const PESO_RUIM_PESS   = 1 / 3; // pressão crítica atual
  const PESO_EMERGENCIAL = 1 / 3; // pressão corretiva (% contratos emergenciais)
  // Fórmula: IPF = PESO_REGULAR × norm(% Regular)
  //               + PESO_RUIM_PESS × norm(% Ruim+Péssimo)
  //               + PESO_EMERGENCIAL × norm(% Emergenciais)
  // Normalização: valor / máximo observado entre as 5 SRs (min-max com min=0)
  // Liquidado/km exibido como referência de resposta, NÃO entra na fórmula

  const samLookup = Object.fromEntries(malhaLiqKm.map(m => [m.sr, m]));
  const raw = dadosPorSR.map(r => {
    const sam = samLookup[r.sr] || {};
    return {
      sr:           r.sr,
      pctRegular:   +((sam.pct_regular       || 0) * 100).toFixed(2),
      pctRuimPess:  +((sam.pct_ruim_pessimo  || 0) * 100).toFixed(2),
      pctEmg:       r.nc > 0 ? +(r.emg / r.nc * 100).toFixed(2) : 0,
      lkm:          r.lkm
    };
  });

  const maxReg  = Math.max(...raw.map(r => r.pctRegular),  0.001);
  const maxRuim = Math.max(...raw.map(r => r.pctRuimPess), 0.001);
  const maxEmg  = Math.max(...raw.map(r => r.pctEmg),      0.001);

  return raw.map(r => {
    const nReg  = r.pctRegular  / maxReg;
    const nRuim = r.pctRuimPess / maxRuim;
    const nEmg  = r.pctEmg      / maxEmg;
    const ipf   = +(PESO_REGULAR * nReg + PESO_RUIM_PESS * nRuim + PESO_EMERGENCIAL * nEmg).toFixed(3);
    return { ...r, nReg, nRuim, nEmg, ipf };
  });
}

function renderIndicePressaoFutura() {
  const tbody = document.getElementById('tbodyPressaoFutura');
  if (!tbody || !regionais.length || !malhaLiqKm.length) return;
  const dados  = calcularIndicePressaoFutura(regionais);
  const sorted = [...dados].sort((a, b) => b.ipf - a.ipf);
  tbody.innerHTML = sorted.map(r => {
    const cor      = SR_COLORS[r.sr] || '#888';
    const ipfStyle = r.ipf >= LIMIAR_PRESSAO_ALTA
      ? 'color:#C00000;font-weight:700'
      : r.ipf >= LIMIAR_PRESSAO_MEDIA
        ? 'color:#E07B00;font-weight:600'
        : 'color:#1A6B3A;font-weight:600';
    const ipfLabel = r.ipf >= LIMIAR_PRESSAO_ALTA
      ? '<span class="badge b-red">alta</span>'
      : r.ipf >= LIMIAR_PRESSAO_MEDIA
        ? '<span class="badge b-yellow">média</span>'
        : '<span class="badge b-green">baixa</span>';
    return `<tr>
      <td><strong style="color:${cor}">${esc(r.sr)}</strong></td>
      <td>${fmtNum(r.pctRegular, 1)}%</td>
      <td>${fmtNum(r.pctRuimPess, 1)}%</td>
      <td>${fmtNum(r.pctEmg, 1)}%</td>
      <td style="${ipfStyle}">${fmtNum(r.ipf, 3)}&nbsp;${ipfLabel}</td>
      <td>R$&nbsp;${fmtNum(r.lkm)}</td>
    </tr>`;
  }).join('');

  // Popula card KPI na Síntese Executiva
  const srMaiorIPF = sorted[0];
  if (srMaiorIPF) {
    const elVal = document.getElementById('kpi-sint-sr-pressao');
    const elSub = document.getElementById('kpi-sint-sr-pressao-sub');
    if (elVal) elVal.textContent = (srMaiorIPF.sr || '').replace('SR ', '');
    if (elSub) {
      const nivel = srMaiorIPF.ipf >= LIMIAR_PRESSAO_ALTA ? 'alta' : srMaiorIPF.ipf >= LIMIAR_PRESSAO_MEDIA ? 'média' : 'baixa';
      elSub.textContent = 'IPF ' + fmtNum(srMaiorIPF.ipf, 3) + ' — pressão ' + nivel;
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

function _mapaRodColor(pct){
  if(pct < 30) return '#C00000';  // condição crítica
  if(pct < 50) return '#E07B00';  // condição intermediária
  return '#70AD47';                // boa condição
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

  if(STANDALONE_MODE){
    const mapEl = document.getElementById('map-rodovias');
    if(mapEl) mapEl.classList.add('leaflet-offline-map');
    map.attributionControl.addAttribution('Geometria: © OpenStreetMap contributors');
  } else {
    // Dependência externa de mapa-base: manter OSM até haver tile/cache local definido pelo projeto.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 18
    }).addTo(map);
  }

  loadJsonData('rodovias_pr', `${DATA_PATH.DASHBOARD}rodovias_pr.geojson`, 'rodovias_pr.geojson')
    .then(geojson => {
      if(errEl) errEl.innerHTML = '';

      // Mostra aviso de aproximação se algum trecho estiver marcado
      if(alertEl && geojson.features.some(f => f.properties.atribuicao_aproximada)){
        alertEl.classList.remove('is-hidden');
      }

      // Coletar pct_bom por SR (todos os trechos de uma SR têm o mesmo valor)
      const srPct = {};
      geojson.features.forEach(f => {
        const sr = f.properties.sr;
        if(srPct[sr] == null) srPct[sr] = f.properties.pct_bom_muito_bom;
      });

      let geoLayer = L.geoJSON(geojson, {
        style: feature => ({
          color:   _mapaRodColor(feature.properties.pct_bom_muito_bom),
          weight:  2.5,
          opacity: 0.8
        }),
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          layer.bindTooltip(
            `<strong>${esc(p.sr)}</strong><br>` +
            `IRI Bom + Muito Bom: <strong>${fmtNum(p.pct_bom_muito_bom,1)}%</strong>` +
            `<br>Rodovia: ${esc(p.ref)}`,
            {sticky:true, className:''}
          );
          layer.on({
            mouseover: e => e.target.setStyle({weight:5, opacity:1}),
            mouseout:  e => geoLayer.resetStyle(e.target)
          });
        }
      }).addTo(map);

      // Ajusta o zoom para cobrir toda a extensão dos dados
      try { map.fitBounds(geoLayer.getBounds(), {padding:[20,20]}); } catch(_){}

      // Legenda
      const legend = L.control({position:'bottomright'});
      legend.onAdd = () => {
        const div = L.DomUtil.create('div','map-rod-legend');
        const escalas = [
          {cor:'#70AD47', label:'≥ 50% — Boa condição'},
          {cor:'#E07B00', label:'30–50% — Intermediária'},
          {cor:'#C00000', label:'< 30% — Crítica'}
        ];
        const SR_ORDER_MAP = ['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];
        div.innerHTML =
          '<b>% IRI Bom + Muito Bom</b>' +
          escalas.map(it=>
            `<div class="map-rod-leg-item">` +
            `<div class="map-rod-leg-swatch" style="background:${it.cor}"></div>${it.label}` +
            `</div>`
          ).join('') +
          '<hr class="map-rod-separator">' +
          '<b>Por SR (levant. 2021–2022)</b>' +
          SR_ORDER_MAP.map(sr => {
            const pct = srPct[sr];
            return `<div class="map-rod-leg-item">` +
              `<div class="map-rod-leg-swatch" style="background:${_mapaRodColor(pct!=null?pct:0)}"></div>` +
              `${esc(sr.replace('SR ',''))}${pct!=null?' — '+fmtNum(pct,1)+'%':''}` +
              `</div>`;
          }).join('');
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

  if(!rendered[id]){
    rendered[id]=true;
    setTimeout(()=>{
      if(id==='execucao')              renderExecucao();
      else if(id==='malha-retorno')    { renderMalha(); renderAnalitica(); }
      else if(id==='benchmark')        renderBenchmark();
    }, 30);
  } else {
    if(id==='malha-retorno')
      setTimeout(()=>{ if(leafletMapInstance) leafletMapInstance.invalidateSize(); }, 50);
  }
}

document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));

document.getElementById('filtroSR').addEventListener('change', e=>{
  renderEficiencia(e.target.value);
});

// Inicialização via fetch — ver initDashboard() abaixo

// =======================================================
// CARGA DE DADOS — DATA_PATH.ROOT
// =======================================================

function initDashboard(d) {
  const SR_ORDER = ['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];

  // Data de extração no cabeçalho
  const hdrDataRef = document.getElementById('hdr-data-ref');
  if(hdrDataRef && d.generated){
    const gen = new Date(d.generated);
    hdrDataRef.textContent = 'Dados: SAM/SGP ' + gen.toLocaleDateString('pt-BR');
  }

  // ── Regionais ───────────────────────────────────────────
  regionais = SR_ORDER.map(sr => {
    const r = d.regionais[sr];
    return {
      sr,
      liquidado: r.liquidado,
      lkm: Math.round(r.liquidado_por_km),
      iri: Math.round((r.iri.ruim + r.iri.pessimo) * 100) / 100,
      fwd: Math.round((r.fwd.ruim + r.fwd.pessimo) * 100) / 100,
      kmTotal: r.km_total || 0,
      pctBom: r.pct_bom_muito_bom || 0,
      nc:  r.n_contratos,
      emg: r.emergencial
    };
  });

  // ── IRI e FWD (detalhamento por faixa) ──────────────────
  iri = SR_ORDER.map(sr => ({ sr, ...d.regionais[sr].iri }));
  fwd = SR_ORDER.map(sr => ({ sr, ...d.regionais[sr].fwd }));

  const avgLkm      = Math.round(regionais.reduce((a, r) => a + r.lkm, 0) / regionais.length);
  const srsByLkm    = [...regionais].sort((a, b) => b.lkm - a.lkm);

  // KPIs Síntese — SAM 2025
  const srMelhorSAM = malhaLiqKm.reduce((a,b) => b.pct_bom > a.pct_bom ? b : a, malhaLiqKm[0] || {});
  const srPiorSAM   = malhaLiqKm.reduce((a,b) => b.pct_bom < a.pct_bom ? b : a, malhaLiqKm[0] || {});
  document.getElementById('kpi-sint-sr-melhor').textContent     = (srMelhorSAM.sr||'').replace('SR ','');
  document.getElementById('kpi-sint-sr-melhor-sub').textContent = fmtNum((srMelhorSAM.pct_bom||0)*100, 0) + '% Bom+Muito Bom';
  document.getElementById('kpi-sint-sr-pior').textContent       = (srPiorSAM.sr||'').replace('SR ','');
  document.getElementById('kpi-sint-sr-pior-sub').textContent   = fmtNum((srPiorSAM.pct_bom||0)*100, 0) + '% Bom+Muito Bom';
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
      `o cruzamento entre condição SAM 2025 e liquidado DOPSR1 do mesmo ano revela que volume de gasto por km e qualidade da malha não seguem proporção direta. ` +
      `A ${esc(sNorte.sr||'SR Norte')} concentrou o maior investimento proporcional entre as cinco regionais ` +
      `(~R$&nbsp;${fmtNum((sNorte.liq_por_km||0)/1000,1)}&nbsp;mil/km), mas registrou condição intermediária ` +
      `(${fmtNum((sNorte.pct_bom||0)*100,0)}% Bom+Muito Bom). ` +
      `A ${esc(sNoro.sr||'SR Noroeste')}, que administra a maior extensão de malha do estado, ` +
      `alcançou a melhor condição registrada (${fmtNum((sNoro.pct_bom||0)*100,0)}% Bom+Muito Bom) ` +
      `com o menor gasto por km (~R$&nbsp;${fmtNum((sNoro.liq_por_km||0)/1000,1)}&nbsp;mil/km). ` +
      `A ${esc(sLeste.sr||'SR Leste')} apresentou o menor percentual em condição satisfatória ` +
      `(${fmtNum((sLeste.pct_bom||0)*100,0)}% Bom+Muito Bom) e a maior proporção de trechos em estado regular ` +
      `(${fmtNum((sLeste.pct_regular||0)*100,0)}%), indicando pressão de conservação acumulada. ` +
      `${esc(sOeste.sr||'SR Oeste')} e ${esc(sCG.sr||'SR Campos Gerais')} apresentaram comportamento proporcionalmente equilibrado entre investimento e condição. ` +
      `A conclusão do relatório aponta que a condição da malha depende não apenas do volume de recursos aplicados, ` +
      `mas também de fatores estruturais históricos do pavimento e do perfil de tráfego de cada regional.`;
  }

  // -- Alert card Noroeste - CREMEP e EMERGENCIAL ----------
  const noroeste    = regionais.find(r => r.sr === 'SR Noroeste');
  const cremepNoro  = contratos.filter(c => c.sr === 'SR NOROESTE' && c.tipo === 'CREMEP');
  const cremepLiq   = cremepNoro.reduce((a, c) => a + c.liquidado, 0);
  const emergNoro   = contratos.filter(c => c.sr === 'SR NOROESTE' && c.tipo === 'EMERGENCIAL');
  const emergLiq    = emergNoro.reduce((a, c) => a + c.liquidado, 0);
  document.getElementById('alert-noroeste').innerHTML =
    `<strong>${esc(noroeste.sr)} — Contratos Emergenciais e CREMEP (2025):</strong> ` +
    `${emergNoro.length} contrato${emergNoro.length !== 1 ? 's' : ''} EMERGENCIAL (${fmtR(emergLiq)}) ` +
    `e ${cremepNoro.length} CREMEP (${fmtR(cremepLiq)}) identificados na SR Noroeste — ` +
    `sinal de pressão corretiva não planejada, indicativo de deterioração em trecho sem cobertura contratual regular. ` +
    `No gráfico de quadrantes, a ${esc(noroeste.sr)} combina a maior extensão de malha com o menor liquidado/km — ` +
    `ponto que merece investigação antes de concluir subatendimento ou eficiência ` +
    `(R$&nbsp;${fmtNum(noroeste.lkm)}/km, o menor valor entre as ${regionais.length} SRs).`;

  // ── HL cards Aba 3 ──────────────────────────────────────
  const srNorte        = regionais.find(r => r.sr === 'SR Norte');
  const srNoroeste     = regionais.find(r => r.sr === 'SR Noroeste');
  const srCamposGerais = regionais.find(r => r.sr === 'SR Campos Gerais');
  const srMaiorLkm = srsByLkm[0];
  const noroesteKmTotal = Math.round(d.regionais['SR Noroeste'].km_total);
  document.getElementById('hl-grid').innerHTML =
    `<div class="hl-card danger">` +
      `<h4>⚠ ${esc(srNorte.sr)} — Pior IRI do Estado <span class="periodo-badge">Levantamento 2021–2022</span></h4>` +
      `<p>${fmtNum(srNorte.iri, 1)}% da malha com irregularidade superficial crítica (IRI) — mais do que o dobro das demais SRs. ` +
      `Em estrutura de pavimento (FWD), ${esc(srNorte.sr)} (${fmtNum(srNorte.fwd, 1)}%) e ${esc(srCamposGerais.sr)} (${fmtNum(srCamposGerais.fwd, 1)}%) ` +
      `estão tecnicamente empatadas entre as piores — diferença inferior a 1 ponto percentual. ` +
      `Recebe R$ ${fmtNum(srNorte.lkm)}/km (2025), acima da média estadual (R$ ${fmtNum(avgLkm)}/km).</p>` +
    `</div>` +
    `<div class="hl-card warn">` +
      `<h4>${esc(srNoroeste.sr)} — Maior Extensão de Malha <span class="periodo-badge">Dados 2025</span></h4>` +
      `<p>Maior rede gerenciada do estado (${fmtNum(noroesteKmTotal)} km). ` +
      `Pressão estrutural moderada — FWD ${fmtNum(srNoroeste.fwd, 1)}% (levant. 2021–22) — com ${srNoroeste.emg} contratos emergenciais em 2025 ` +
      `— menor gasto/km (R$ ${fmtNum(srNoroeste.lkm)}/km).</p>` +
    `</div>` +
    `<div class="hl-card">` +
      `<h4>${esc(srMaiorLkm.sr)} — Maior Liquidado por km <span class="periodo-badge">Dados 2025</span></h4>` +
      `<p>Maior liquidado absoluto (${fmtR(srMaiorLkm.liquidado)}) e maior gasto por km (R$ ${fmtNum(srMaiorLkm.lkm)}/km), ` +
      `apesar de IRI (${fmtNum(srMaiorLkm.iri, 1)}%) e FWD (${fmtNum(srMaiorLkm.fwd, 1)}%) — levant. 2021–22 — abaixo dos críticos da ${esc(srNorte.sr)}.</p>` +
    `</div>`;

  // ── Inicializa painel ────────────────────────────────────
  activateTab('malha-retorno');
}

if (window.STANDALONE_DATA && window.STANDALONE_DATA.der_precomputed) {
  const d      = window.STANDALONE_DATA.der_precomputed;
  const extras = window.STANDALONE_DATA.dados_extras || {};
  contratos  = extras.contratos_dopsr1 || [];
  malhaKm    = extras.malha_km        || [];
  malhaLiqKm = extras.malha_pct       || [];
  initDashboard(d);
} else {
  Promise.all([
    loadJsonData('der_precomputed', `${DATA_PATH.ROOT}der_precomputed.json`, 'der_precomputed.json'),
    loadJsonData('dados_extras', `${DATA_PATH.ROOT}dados_extras.json`, 'dados_extras.json')
  ]).then(([d, extras])=>{
    contratos  = extras.contratos_dopsr1 || [];
    malhaKm    = extras.malha_km        || [];
    malhaLiqKm = extras.malha_pct       || [];
    initDashboard(d);
  }).catch(err=>{
    document.querySelector('.tab-content').innerHTML =
      `<div class="error-panel"><h2>Erro ao carregar dados</h2><p>Não foi possível carregar os arquivos de dados.</p><p class="error-detail">Detalhe: ${esc(err.message)}</p><p class="error-help">Abra o painel a partir de um servidor local (ex: <code>python -m http.server</code> na raiz do projeto).</p></div>`;
  });
}

// Botões "Limpar filtro" para os gráficos de condição da malha (IRI e FWD)
(function(){
  function resetMalhaChart(ch){
    if(!ch) return;
    ch.data.datasets.forEach((_,i)=>{ ch.getDatasetMeta(i).hidden = false; });
    ch.update();
  }
  const btnIRI = document.getElementById('btnLimparIRI');
  if(btnIRI) btnIRI.addEventListener('click', ()=>resetMalhaChart(chMalhaIRI));
  const btnFWD = document.getElementById('btnLimparFWD');
  if(btnFWD) btnFWD.addEventListener('click', ()=>resetMalhaChart(chMalhaFWD));
})();

// Sincroniza o top do tab-nav com a altura real do header em qualquer breakpoint
(function(){
  const hdr = document.querySelector('.header-gov');
  const setTop = () => {
    if(hdr) document.documentElement.style.setProperty('--tab-nav-top', hdr.offsetHeight+'px');
  };
  setTop();
  window.addEventListener('resize', setTop);
})();

