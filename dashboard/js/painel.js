// =======================================================
// DADOS — AÇÃO 8398 DER-PR
// =======================================================

const DATA_PATH = Object.freeze({
  ROOT: '../data/',
  DASHBOARD: 'data/'
});

// Dados carregados dinamicamente de DATA_PATH.ROOT via initDashboard()
let subprogramas = [];
let regionais    = [];
let iri          = [];
let fwd          = [];

// Dados de DATA_PATH.ROOT + dados_extras.json
let contratos  = [];
let malhaKm    = [];
let malhaLiqKm = [];

// Municípios do piloto (Seção Liquidado por Município)
let municipios     = [];
let munDisplayData = [];
let munSortDir     = {};

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
// ABA 1 — EXECUÇÃO FINANCEIRA
// =======================================================

function renderExecucao(){
  // Ordena decrescente por liquidado
  const sorted = [...subprogramas].sort((a,b)=>b.liquidado-a.liquidado);
  const totalLiqSub = subprogramas.reduce((a, s) => a + s.liquidado, 0);

  // Tabela
  const tbody = document.getElementById('tbodySub');
  tbody.innerHTML = sorted.map(s=>{
    const ncPct = totalLiqSub > 0 ? Math.round(s.liquidado / totalLiqSub * 1000) / 10 : 0;
    const nota = s.nome==='NÃO CLASSIFICADO'
      ? `<br><span class="fn">Gasto sem classificação por subprograma no PPA — ${fmtNum(ncPct,1)}% do total liquidado</span>`
      : '';
    return `<tr>
      <td>${esc(s.nome)}${nota}</td>
      <td>${fmtR(s.liquidado)}</td>
      <td>${fmtR(s.empenhado)}</td>
      <td>${fmtP(s.taxa)}</td>
      <td>${execBadge(s.taxa)}</td>
    </tr>`;
  }).join('');

  // Cores das barras conforme taxa de execução
  const cores = sorted.map(s=>{
    if(s.taxa==null) return '#BDD7EE';
    if(s.taxa>=90) return '#70AD47';
    if(s.taxa>=70) return '#FFC000';
    return '#C00000';
  });

  new Chart(document.getElementById('chartSub'),{
    type:'bar',
    data:{
      labels: sorted.map(s=>s.nome),
      datasets:[{
        data: sorted.map(s=>s.liquidado),
        backgroundColor: cores,
        borderRadius:3,
        borderSkipped:false
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            title: ctx=>sorted[ctx[0].dataIndex].nome,
            label: ctx=>{
              const s=sorted[ctx.dataIndex];
              const lines=['Liquidado: '+fmtR(s.liquidado).replace(/&nbsp;/g,' ')];
              lines.push('Empenhado: '+fmtR(s.empenhado).replace(/&nbsp;/g,' '));
              if(s.taxa!=null) lines.push('Taxa de execução: '+fmtP(s.taxa).replace(/&nbsp;/g,' '));
              return lines;
            }
          }
        }
      },
      scales:{
        x:{
          grid:{color:'#F0F0F0'},
          ticks:{callback:v=>v>=1e9?fmtNum(v/1e9,1)+' bi':v>=1e6?fmtNum(v/1e6,0)+' M':v}
        },
        y:{grid:{display:false}}
      }
    }
  });

  // Renderiza seção de contratos na mesma aba
  renderContratos();
}

// =======================================================
// ABA 2 — EFICIÊNCIA POR REGIONAL
// =======================================================

function renderEficiencia(sr=''){
  srFiltro = sr;
  const tbody = document.getElementById('tbodyReg');
  tbody.innerHTML = regionais.map(r=>{
    const isNorte = r.sr==='SR Norte';
    const isSelected = !sr || r.sr===sr;
    const rowCls = isNorte ? 'tr-norte' : '';
    const dimCls = sr && !isSelected ? 'row-dimmed' : '';
    const emgHtml = r.emg>0
      ? `<span class="emg-count">${r.emg} ⚠️</span>`
      : r.emg;
    return `<tr class="${rowCls} ${dimCls}">
      <td><strong>${esc(r.sr)}</strong></td>
      <td>${fmtRF(r.liquidado)}</td>
      <td>R$&nbsp;${r.lkm.toLocaleString('pt-BR')}</td>
      <td>${pb(r.iri)}</td>
      <td>${pb(r.fwd,45)}</td>
      <td>${r.nc}</td>
      <td>${emgHtml}</td>
    </tr>`;
  }).join('');

  renderScatter(sr);
}

function renderScatter(sr=''){
  const svg = document.getElementById('scatter');
  const W=720, H=400;
  const pad={l:80,r:30,t:30,b:60};
  const pw=W-pad.l-pad.r, ph=H-pad.t-pad.b;

  const xMin=0, xMax=45, yMin=0, yMax=100000;
  const sx = v => pad.l + (v-xMin)/(xMax-xMin)*pw;
  const sy = v => pad.t + ph - (v-yMin)/(yMax-yMin)*ph;

  // Regressão linear para linha de tendência
  const n=regionais.length;
  const mx=regionais.reduce((a,r)=>a+r.iri,0)/n;
  const my=regionais.reduce((a,r)=>a+r.lkm,0)/n;
  const slope=regionais.reduce((a,r)=>a+(r.iri-mx)*(r.lkm-my),0)/
               regionais.reduce((a,r)=>a+(r.iri-mx)**2,0);
  const intercept=my-slope*mx;

  const x1t=xMin, y1t=slope*x1t+intercept;
  const x2t=xMax, y2t=slope*x2t+intercept;

  const srCores={'SR Leste':'#2E75B6','SR Campos Gerais':'#70AD47','SR Norte':'#C00000','SR Noroeste':'#E07B00','SR Oeste':'#1F4E79'};

  // Grade e eixos
  let g = '';

  // Grade X
  for(let v=0;v<=45;v+=10){
    const x=sx(v);
    g+=`<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t+ph}" stroke="#EBEBEB" stroke-width="1"/>`;
    g+=`<text x="${x}" y="${pad.t+ph+18}" text-anchor="middle" font-size="11" fill="#888">${v}%</text>`;
  }
  // Grade Y
  for(let v=0;v<=100000;v+=20000){
    const y=sy(v);
    g+=`<line x1="${pad.l}" y1="${y}" x2="${pad.l+pw}" y2="${y}" stroke="#EBEBEB" stroke-width="1"/>`;
    g+=`<text x="${pad.l-8}" y="${y+4}" text-anchor="end" font-size="11" fill="#888">${v>=1000?(v/1000)+'k':v}</text>`;
  }

  // Área do plot
  g=`<rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="#FAFBFC" stroke="#E0E0E0" rx="3"/>`+g;

  // Linha de tendência
  g+=`<line x1="${sx(x1t).toFixed(1)}" y1="${sy(Math.max(0,y1t)).toFixed(1)}" x2="${sx(x2t).toFixed(1)}" y2="${sy(Math.max(0,y2t)).toFixed(1)}" stroke="#BDD7EE" stroke-width="2" stroke-dasharray="6,4"/>`;

  // Labels eixos — com anos explícitos (períodos distintos)
  g+=`<text x="${pad.l+pw/2}" y="${H-8}" text-anchor="middle" font-size="12" fill="#555" font-weight="500">% Malha Crítica IRI (levantamento 2021–2022)</text>`;
  g+=`<text transform="rotate(-90,18,${pad.t+ph/2})" x="18" y="${pad.t+ph/2+4}" text-anchor="middle" font-size="12" fill="#555" font-weight="500">Liquidado/km — 2025 (R$)</text>`;

  // Pontos
  const offsets={
    'SR Leste':[10,-12],
    'SR Campos Gerais':[-10,-14],
    'SR Norte':[0,-16],
    'SR Noroeste':[12,4],
    'SR Oeste':[10,-12]
  };
  regionais.forEach(r=>{
    const cx=sx(r.iri), cy=sy(r.lkm);
    const cor=srCores[r.sr]||'#888';
    const [ox,oy]=offsets[r.sr]||[10,-12];
    const lbl=r.sr.replace('SR ','');
    const isNoroeste=r.sr==='SR Noroeste';
    const isSelected = !sr || r.sr===sr;
    const fillOp = isSelected ? '.82' : '.20';
    const lblOp  = isSelected ? '1'   : '.25';
    const radius  = sr && r.sr===sr ? 18 : 13;
    if(r.emg > 0){
      const haloOp = isSelected ? '1' : '.25';
      g+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="22" fill="none" stroke="#C00000" stroke-width="1.8" stroke-dasharray="5,4" opacity="${haloOp}"/>`;
    }
    g+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius}" fill="${cor}" fill-opacity="${fillOp}" stroke="white" stroke-width="2"
        class="sdot" data-sr="${esc(r.sr)}" data-iri="${r.iri}" data-lkm="${r.lkm.toLocaleString('pt-BR')}" data-emg="${r.emg}"/>`;
    g+=`<text x="${(cx+ox).toFixed(1)}" y="${(cy+oy).toFixed(1)}" font-size="11" fill="${cor}" font-weight="600" opacity="${lblOp}">${esc(lbl)}</text>`;
  });

  svg.innerHTML=g;

  svg.querySelectorAll('.sdot').forEach(el=>{
    el.style.cursor='pointer';
    el.addEventListener('mousemove',e=>{
      const emgN=+el.dataset.emg;
      const extra=emgN>0?`<br>⚠️ ${emgN} contratos emergenciais em 2025 — abaixo da linha de tendência`:'';
      showTT(e,`<strong>${esc(el.dataset.sr)}</strong><br>IRI crítico: ${esc(el.dataset.iri)}% <em class="tt-period">(levantamento 2021–2022)</em><br>Liquidado/km: R$ ${esc(el.dataset.lkm)} <em class="tt-period">(2025)</em>${extra}`);
    });
    el.addEventListener('mouseleave',hideTT);
  });
}

// =======================================================
// ABA 3 — CONDIÇÃO DA MALHA
// =======================================================

function renderMalha(){
  // Ordena SRs por criticidade (ruim+pessimo) crescente (melhor no topo)
  const iriSorted = [...iri].sort((a,b)=>(a.ruim+a.pessimo)-(b.ruim+b.pessimo));
  const fwdSorted = [...fwd].sort((a,b)=>(a.ruim+a.pessimo)-(b.ruim+b.pessimo));

  const stackDatasets = (arr) => [
    { label:'Ruim',     data:arr.map(r=>r.ruim),     backgroundColor:'#C00000' },
    { label:'Péssimo',  data:arr.map(r=>r.pessimo),  backgroundColor:'#E07B00' },
    { label:'Regular',  data:arr.map(r=>r.regular),  backgroundColor:'#FFC000' },
    { label:'Bom',      data:arr.map(r=>r.bom),      backgroundColor:'#70AD47' },
    { label:'Muito Bom',data:arr.map(r=>r.muito_bom),backgroundColor:'#1F4E79' }
  ];

  const stackOpts = {
    indexAxis:'y',
    responsive:true,
    maintainAspectRatio:false,
    plugins:{
      legend:{position:'bottom',labels:{font:{size:11},padding:12}},
      tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.x,1)}%`}}
    },
    scales:{
      x:{stacked:true,max:100,ticks:{callback:v=>v+'%'},grid:{color:'#F0F0F0'}},
      y:{stacked:true,grid:{display:false}}
    }
  };

  new Chart(document.getElementById('chartIRI'),{
    type:'bar',
    data:{ labels:iriSorted.map(r=>r.sr.replace('SR ','')), datasets:stackDatasets(iriSorted) },
    options:stackOpts
  });
  new Chart(document.getElementById('chartFWD'),{
    type:'bar',
    data:{ labels:fwdSorted.map(r=>r.sr.replace('SR ','')), datasets:stackDatasets(fwdSorted) },
    options:stackOpts
  });

  // Gráfico de extensão absoluta em km
  if(malhaKm.length > 0){
    const kmSorted = [...malhaKm].sort((a,b)=>(a.ruim_km+a.pessimo_km)-(b.ruim_km+b.pessimo_km));
    new Chart(document.getElementById('chartMalhaKm'),{
      type:'bar',
      data:{
        labels: kmSorted.map(r=>r.sr.replace('SR ','')),
        datasets:[
          { label:'Ruim',      data:kmSorted.map(r=>r.ruim_km),     backgroundColor:'#C00000' },
          { label:'Péssimo',   data:kmSorted.map(r=>r.pessimo_km),  backgroundColor:'#E07B00' },
          { label:'Regular',   data:kmSorted.map(r=>r.regular_km),  backgroundColor:'#FFC000' },
          { label:'Boa',       data:kmSorted.map(r=>r.boa_km),      backgroundColor:'#70AD47' },
          { label:'Muito Boa', data:kmSorted.map(r=>r.muito_boa_km),backgroundColor:'#1F4E79' }
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

  // Gráfico: custo por km da malha total (liquidado / km_total), ordenado decrescente
  {
    const srCores={'SR Leste':'#2E75B6','SR Campos Gerais':'#70AD47','SR Norte':'#C00000','SR Noroeste':'#E07B00','SR Oeste':'#1F4E79'};
    const custoSorted = [...regionais].sort((a,b)=>b.lkm-a.lkm);
    new Chart(document.getElementById('chartCustoKm'),{
      type:'bar',
      data:{
        labels: custoSorted.map(r=>r.sr.replace('SR ','')),
        datasets:[{
          data: custoSorted.map(r=>r.lkm),
          backgroundColor: custoSorted.map(r=>srCores[r.sr]||'#888'),
          borderRadius:3
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:ctx=>` R$ ${fmtNum(ctx.raw)}/km`}}
        },
        scales:{
          x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>v>=1000?fmtNum(v/1000,0)+'k':v},title:{display:true,text:'R$/km',font:{size:11}}},
          y:{grid:{display:false}}
        }
      }
    });
  }

  // Índice de eficiência transversal: pct_bom / (lkm / 1000)
  if(malhaKm.length > 0){
    const srCoresEfic={'SR Leste':'#2E75B6','SR Campos Gerais':'#70AD47','SR Norte':'#C00000','SR Noroeste':'#E07B00','SR Oeste':'#1F4E79'};
    const eficData = malhaKm.map(r=>{
      const reg = regionais.find(x=>x.sr===r.sr);
      const kmTotal = r.ruim_km + r.pessimo_km + r.regular_km + r.boa_km + r.muito_boa_km;
      const kmBom   = r.boa_km + r.muito_boa_km;
      const pctBom  = kmTotal > 0 ? kmBom / kmTotal * 100 : 0;
      const lkm     = reg ? reg.lkm : 0;
      const custoMil = lkm / 1000;
      const indice  = custoMil > 0 ? pctBom / custoMil : 0;
      return { sr: r.sr, pctBom, lkm, indice };
    }).sort((a,b)=>b.indice-a.indice);

    new Chart(document.getElementById('chartEficTransversal'),{
      type:'bar',
      data:{
        labels: eficData.map(r=>r.sr.replace('SR ','') + ' — ' + fmtNum(r.indice,2) + ' pts/R$1k·km'),
        datasets:[{
          data: eficData.map(r=>r.indice),
          backgroundColor: eficData.map(r=>srCoresEfic[r.sr]||'#888'),
          borderRadius:3
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{
            callbacks:{
              title: ctx => eficData[ctx[0].dataIndex].sr,
              label: ctx => {
                const r = eficData[ctx[0].dataIndex];
                return [
                  ` Índice: ${fmtNum(r.indice,3)} pts / R$1.000·km`,
                  ` % Malha Boa + Muito Boa: ${fmtNum(r.pctBom,1)}%`,
                  ` Custo por km: R$ ${fmtNum(r.lkm)}/km`
                ];
              }
            }
          }
        },
        scales:{
          x:{
            grid:{color:'#F0F0F0'},
            ticks:{callback:v=>fmtNum(v,2)},
            title:{display:true,text:'pts percentuais de malha boa / R$ 1.000·km',font:{size:11},color:'#666'}
          },
          y:{grid:{display:false}}
        }
      }
    });
  }

  // Gráfico: liquidado/km por SR vs % crítico IRI
  if(malhaKm.length > 0){
    const SR_ORDER=['SR Leste','SR Campos Gerais','SR Norte','SR Noroeste','SR Oeste'];
    const srLabels = SR_ORDER.map(s=>s.replace('SR ',''));
    const liqKmData = SR_ORDER.map(sr=>{
      const r = regionais.find(x=>x.sr===sr);
      return r ? r.lkm : 0;
    });
    const pctCriticoData = SR_ORDER.map(sr=>{
      const r = regionais.find(x=>x.sr===sr);
      return r ? r.iri : 0;
    });
    new Chart(document.getElementById('chartLiqKmSR'),{
      type:'bar',
      data:{
        labels: srLabels,
        datasets:[
          {
            label:'Liquidado/km — 2025 (R$)',
            data: liqKmData,
            backgroundColor:'#2E75B6',
            yAxisID:'y',
            borderRadius:3
          },
          {
            label:'% Malha Crítica IRI (2021–2022)',
            data: pctCriticoData,
            type:'line',
            borderColor:'#C00000',
            backgroundColor:'rgba(192,0,0,.15)',
            fill:true,
            tension:.3,
            yAxisID:'y2',
            pointRadius:5,
            pointBackgroundColor:'#C00000'
          }
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{position:'bottom',labels:{font:{size:11},padding:12}},
          tooltip:{callbacks:{label:ctx=>{
            if(ctx.dataset.yAxisID==='y2') return ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y,1)}%`;
            return ` ${ctx.dataset.label}: R$ ${fmtNum(ctx.parsed.y)}`;
          }}}
        },
        scales:{
          x:{grid:{display:false}},
          y:{
            position:'left',
            grid:{color:'#F0F0F0'},
            ticks:{callback:v=>v>=1000?fmtNum(v/1000,0)+'k':v}
          },
          y2:{
            position:'right',
            grid:{display:false},
            ticks:{callback:v=>v+'%'},
            max:50
          }
        }
      }
    });
  }
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

  chContSR = new Chart(document.getElementById('chartContSR'),{
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
        legend:{position:'bottom',labels:{font:{size:11},padding:12}},
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

  chContTipo = new Chart(document.getElementById('chartContTipo'),{
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
  updateContratoFilterCount(data.length);
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
// ABA 3 — ANÁLISE DE RETORNO
// =======================================================

function renderAnalitica(){
  // ── Retorno sobre a Despesa (via malhaKm) ────────────────
  if(malhaKm.length > 0){
    const srColors={'SR Leste':'#2E75B6','SR Campos Gerais':'#70AD47','SR Norte':'#C00000','SR Noroeste':'#E07B00','SR Oeste':'#1F4E79'};

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

    // Chart: km bom por R$ milhão (decrescente = mais eficiente primeiro)
    const sortedROI = [...roiData].sort((a,b)=>b.kmPorMilhao-a.kmPorMilhao);
    new Chart(document.getElementById('chartROIKm'),{
      type:'bar',
      data:{
        labels: sortedROI.map(r=>r.sr.replace('SR ','')),
        datasets:[{
          data: sortedROI.map(r=>r.kmPorMilhao),
          backgroundColor: sortedROI.map(r=>srColors[r.sr]||'#888'),
          borderRadius:3
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:ctx=>` ${fmtNum(ctx.raw,2)} km / R$ milhão`}}
        },
        scales:{
          x:{grid:{color:'#F0F0F0'},ticks:{callback:v=>fmtNum(v,1)+' km'}},
          y:{grid:{display:false}}
        }
      }
    });

    // Chart: custo por km em boa condição (crescente = mais eficiente primeiro)
    const sortedCusto = [...roiData].filter(r=>r.custoPorKmBom!=null).sort((a,b)=>a.custoPorKmBom-b.custoPorKmBom);
    new Chart(document.getElementById('chartROICusto'),{
      type:'bar',
      data:{
        labels: sortedCusto.map(r=>r.sr.replace('SR ','')),
        datasets:[{
          data: sortedCusto.map(r=>r.custoPorKmBom),
          backgroundColor: sortedCusto.map(r=>srColors[r.sr]||'#888'),
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

  // ── Eficiência por Regional ──────────────────────────────
  renderEficiencia('');

  // ── Liquidado por Município ──────────────────────────────
  renderMapa();
  renderTblMun(munDisplayData);
  document.querySelectorAll('#tblMun thead th').forEach(th=>{
    th.style.cursor='pointer';
    th.addEventListener('click',()=>sortMun(+th.dataset.col));
  });

}

// =======================================================
// SEÇÃO 4 (ABA ANALITICA) — LIQUIDADO POR MUNICÍPIO
// =======================================================

function renderMapa(){
  const svg = document.getElementById('mapa');
  if(!svg) return;

  const latMin=-26.75, latMax=-22.40;
  const lngMin=-54.65, lngMax=-47.95;
  const W=720, H=400;
  const pad={l:18,r:18,t:18,b:18};
  const pw=W-pad.l-pad.r, ph=H-pad.t-pad.b;

  const tx = lng => pad.l+(lng-lngMin)/(lngMax-lngMin)*pw;
  const ty = lat => pad.t+(lat-latMax)/(latMin-latMax)*ph;

  const border = [
    [-22.50,-53.20],[-22.50,-52.00],[-22.50,-50.70],[-22.90,-49.30],
    [-23.40,-48.05],[-24.60,-48.00],[-25.70,-48.20],[-26.10,-48.55],
    [-26.70,-49.20],[-26.70,-51.30],[-26.45,-53.40],[-25.60,-54.55],
    [-24.10,-54.65],[-22.85,-54.55],[-22.50,-53.80],[-22.50,-53.20]
  ].map(([lat,lng])=>`${tx(lng).toFixed(1)},${ty(lat).toFixed(1)}`).join(' ');

  const maxPop = Math.max(...municipios.map(m=>m.pop||1));

  let g = `<polygon points="${border}" fill="#E8F2FA" stroke="#2E75B6" stroke-width="1.5" stroke-linejoin="round"/>`;
  g += `<text x="${W/2}" y="34" text-anchor="middle" font-size="13" fill="#1F4E79" font-weight="600">Paraná</text>`;

  municipios.forEach(m=>{
    if(!m.lat || !m.lng) return;
    const cx=tx(m.lng), cy=ty(m.lat);
    const r=4+Math.sqrt((m.pop||1)/maxPop)*20;
    const cor = m.liq > 0 ? '#0D2B5E' : '#BDD7EE';
    const liqHtml = m.lh == null ? 'Sem dados'
      : m.lh === 0 ? 'Liquidado identificado: R$ 0'
      : 'Liquidado/hab: R$ '+fmtNum(m.lh,2);
    g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
        fill="${cor}" fill-opacity=".75" stroke="white" stroke-width="1.5"
        class="mdot"
        data-nome="${esc(m.nome)}"
        data-sr="${esc(m.sr)}"
        data-pop="${(m.pop||0).toLocaleString('pt-BR')}"
        data-liq="${esc(liqHtml)}"/>`;
  });

  svg.innerHTML = g;

  svg.querySelectorAll('.mdot').forEach(el=>{
    el.style.cursor='pointer';
    el.addEventListener('mousemove', e=>showTT(e,
      `<strong>${el.dataset.nome}</strong><br>SR: ${el.dataset.sr}<br>Pop.: ${el.dataset.pop}<br>${el.dataset.liq}`));
    el.addEventListener('mouseleave', hideTT);
  });
}

function sortMun(col){
  const dir = munSortDir[col]==='asc' ? 'desc' : 'asc';
  munSortDir = {[col]: dir};
  const keys = ['nome','sr','pop','lh'];
  const k = keys[col];
  munDisplayData = [...municipios].sort((a,b)=>{
    let va=a[k], vb=b[k];
    if(va==null) va = dir==='asc' ? Infinity : -Infinity;
    if(vb==null) vb = dir==='asc' ? Infinity : -Infinity;
    if(typeof va==='string') return dir==='asc' ? va.localeCompare(vb,'pt') : vb.localeCompare(va,'pt');
    return dir==='asc' ? va-vb : vb-va;
  });
  renderTblMun(munDisplayData);
}

function renderTblMun(data){
  const lhHtml = m => {
    if(m.lh==null) return '<span class="badge b-gray">Sem dados</span>';
    if(m.lh===0)   return '<span class="badge b-gray">R$ 0</span>';
    return 'R$ '+fmtNum(m.lh,2)+'/hab';
  };
  const tbody = document.getElementById('tbodyMun');
  if(!tbody) return;
  tbody.innerHTML = data.map(m=>
    `<tr>
      <td><strong>${esc(m.nome)}</strong></td>
      <td>${esc(m.sr)}</td>
      <td>${(m.pop||0).toLocaleString('pt-BR')}</td>
      <td>${lhHtml(m)}</td>
    </tr>`
  ).join('');
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
    chBenchRanking.data.labels = ranking.map(e => e.nome);
    chBenchRanking.data.datasets[0].data            = ranking.map(e => e.val);
    chBenchRanking.data.datasets[0].backgroundColor = ranking.map(e => e.uf==='PR' ? '#E07B00' : '#BDD7EE');
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
  fetch(`${DATA_PATH.DASHBOARD}benchmark_nacional.json`)
    .then(r => { if(!r.ok) throw new Error('HTTP '+r.status+' ao carregar benchmark_nacional.json'); return r.json(); })
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

  chBenchLine = new Chart(document.getElementById('chartBenchLine'),{
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

  chBenchRanking = new Chart(document.getElementById('chartBenchRanking'),{
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

  // Dependência externa de mapa-base: manter OSM até haver tile/cache local definido pelo projeto.
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxZoom: 18
  }).addTo(map);

  fetch(`${DATA_PATH.DASHBOARD}rodovias_pr.geojson`)
    .then(r => { if(!r.ok) throw new Error('HTTP '+r.status+' ao carregar rodovias_pr.geojson'); return r.json(); })
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
  pane.style.display='block';
  // forçar reflow antes da animação
  void pane.offsetHeight;
  pane.classList.add('active');

  if(!rendered[id]){
    rendered[id]=true;
    setTimeout(()=>{
      if(id==='execucao')     renderExecucao();
      else if(id==='malha')   renderMalha();
      else if(id==='analitica') renderAnalitica();
      else if(id==='benchmark') renderBenchmark();
      else if(id==='maparodovias') renderMapaRodovias();
    }, 30);
  } else if(id==='maparodovias'){
    // Já inicializado — apenas corrige tamanho após re-exibição
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

  // ── Subprogramas ────────────────────────────────────────
  subprogramas = Object.entries(d.subprogramas).map(([nome, s]) => ({
    nome,
    liquidado: s.liquidado,
    empenhado: s.empenhado,
    taxa: s.orcamento > 0 ? Math.round(s.liquidado / s.orcamento * 1000) / 10 : null,
    custo_km: null
  }));

  // ── Regionais ───────────────────────────────────────────
  regionais = SR_ORDER.map(sr => {
    const r = d.regionais[sr];
    return {
      sr,
      liquidado: r.liquidado,
      lkm: Math.round(r.liquidado_por_km),
      iri: Math.round((r.iri.ruim + r.iri.pessimo) * 100) / 100,
      fwd: Math.round((r.fwd.ruim + r.fwd.pessimo) * 100) / 100,
      nc:  r.n_contratos,
      emg: r.emergencial
    };
  });

  // ── IRI e FWD (detalhamento por faixa) ──────────────────
  iri = SR_ORDER.map(sr => ({ sr, ...d.regionais[sr].iri }));
  fwd = SR_ORDER.map(sr => ({ sr, ...d.regionais[sr].fwd }));

  // ── Municípios ──────────────────────────────────────────
  municipios = d.municipios.map(m => ({
    nome: m.nome,
    lat:  m.lat,
    lng:  m.lng,
    sr:   m.sr,
    pop:  m.populacao,
    lh:   m.liquidado_por_hab,
    liq:  m.liquidado_8398
  }));
  munDisplayData = [...municipios];

  // ── KPI cards ───────────────────────────────────────────
  const k = d.kpis;
  const semRastrAbs = k.liquidado_total * k.sem_rastreabilidade_pct / 100;
  document.getElementById('kpi-total').innerHTML       = fmtR(k.liquidado_total);
  document.getElementById('kpi-taxa').textContent      = fmtNum(k.taxa_execucao_pct, 1) + '%';
  document.getElementById('kpi-class').textContent     = fmtNum(k.classificado_subprograma_pct, 1) + '%';
  document.getElementById('kpi-semrastr').textContent  = fmtNum(k.sem_rastreabilidade_pct, 1) + '%';
  document.getElementById('kpi-semrastr-sub').innerHTML = fmtR(semRastrAbs) + ' sem meta física vinculada';

  // ── Nota metodológica (Aba 1) ───────────────────────────
  document.getElementById('nota-metodologica').innerHTML =
    `<strong>Nota metodológica:</strong> ${fmtNum(k.classificado_subprograma_pct,1)}% do liquidado está classificado por subprograma. ` +
    `Os ${fmtNum(k.sem_rastreabilidade_pct,1)}% restantes (${fmtR(semRastrAbs)}) não possuem meta física vinculada no PPA e foram mantidos no agregado da ação. ` +
    `Ver <em>"Resposta à Pergunta Central do Piloto"</em> acima para o impacto dessa lacuna na avaliação de eficiência alocativa.`;

  // ── Valores derivados para narrativas ───────────────────
  const rastreavel  = regionais.reduce((a, r) => a + r.liquidado, 0);
  const rastrPct    = Math.round(rastreavel / k.liquidado_total * 100);
  const avgLkm      = Math.round(regionais.reduce((a, r) => a + r.lkm, 0) / regionais.length);
  const srPiorIRI   = regionais.reduce((a, b) => b.iri > a.iri ? b : a);
  const srMenorLkm  = regionais.reduce((a, b) => b.lkm < a.lkm ? b : a);
  const srsByLkm    = [...regionais].sort((a, b) => b.lkm - a.lkm);

  const munNonNull  = municipios.filter(m => m.lh > 0);
  const munNonNullRaw = d.municipios.filter(m => m.liquidado_8398 > 0);
  const munTotal    = municipios.length;
  const semMunId    = '9999999';
  const semMunVal   = d.liquidado_por_municipio[semMunId] || 0;
  const semMunPct   = Math.round(semMunVal / k.liquidado_total * 10000) / 100;

  // ── Arg-block Aba 1 ─────────────────────────────────────
  let munTerritorialTxt;
  if (munNonNull.length === 1) {
    const m0 = munNonNull[0];
    const liq0 = munNonNullRaw.find(m => m.nome === m0.nome);
    const liqFmt = liq0 ? fmtR(liq0.liquidado_8398) : '';
    munTerritorialTxt =
      `apenas 1 dos ${munTotal} municípios do piloto tem liquidado não-nulo identificado na base do DER ` +
      `(${esc(m0.nome)} — ${liqFmt}, R$ ${fmtNum(m0.lh, 2)}/hab, subprograma PRORESTAURA). ` +
      `Os demais ${munTotal - 1} apresentam R$ 0 registrado`;
  } else if (munNonNull.length === 0) {
    munTerritorialTxt = `nenhum dos ${munTotal} municípios do piloto tem liquidado não-nulo identificado`;
  } else {
    munTerritorialTxt = `${munNonNull.length} dos ${munTotal} municípios do piloto têm liquidado não-nulo identificado`;
  }

  document.getElementById('argblock1').innerHTML =
    `<h3>Resposta à Pergunta Central do Piloto</h3>` +
    `<p>Para os ~${fmtR(rastreavel)} rastreáveis por regional (~${rastrPct}% do liquidado da Ação 8398), ` +
    `existe uma tendência positiva entre criticidade da malha e gasto por km: ` +
    `a ${esc(srPiorIRI.sr)} (pior IRI do estado, ${fmtNum(srPiorIRI.iri, 1)}% crítico) recebe R$ ${fmtNum(srPiorIRI.lkm)}/km, ` +
    `acima da média das cinco SRs (R$ ${fmtNum(avgLkm)}/km). ` +
    `Contudo, SRs com malha em melhor condição também recebem valores altos — ` +
    `${esc(srsByLkm[0].sr)} (IRI ${fmtNum(srsByLkm[0].iri, 1)}%) e ${esc(srsByLkm[1].sr)} (IRI ${fmtNum(srsByLkm[1].iri, 1)}%) ` +
    `lideram com R$ ${fmtNum(srsByLkm[0].lkm)}/km e R$ ${fmtNum(srsByLkm[1].lkm)}/km respectivamente. ` +
    `A relação entre necessidade e intensidade de gasto existe, mas não é linear nem exclusiva: ` +
    `a ${esc(srMenorLkm.sr)} é o principal contraponto, recebendo o menor gasto/km (R$ ${fmtNum(srMenorLkm.lkm)}/km) ` +
    `apesar de manter ${srMenorLkm.emg} contratos emergenciais em 2025.</p>` +
    `<p>Essa análise cobre apenas ${rastrPct}% do orçamento da ação. ` +
    `Os ${fmtNum(k.sem_rastreabilidade_pct, 1)}% do liquidado sem rastreabilidade regional (${fmtR(semRastrAbs)}) não passam pelo mesmo teste. ` +
    `A ausência de rastreabilidade não é confirmação positiva nem negativa — ` +
    `é uma lacuna de evidência que impede avaliar se o restante do gasto seguiu a mesma lógica ou não.</p>` +
    `<p>Na dimensão territorial, a rastreabilidade é ainda mais limitada: ${munTerritorialTxt}, ` +
    `e ${fmtR(semMunVal)} (${fmtNum(semMunPct, 2)}% do total) estão vinculados a um código genérico sem identificação municipal. ` +
    `Essa lacuna reduz a capacidade de auditar a distribuição territorial do gasto.</p>`;

  // ── Seção Liquidado por Município ───────────────────────
  const elNonnull  = document.getElementById('cnt-nonnull');
  const elTotalMun = document.getElementById('cnt-total-mun');
  if(elNonnull)  elNonnull.textContent  = munNonNull.length;
  if(elTotalMun) elTotalMun.textContent = munTotal;

  const notaCob = document.getElementById('nota-cobertura');
  if(notaCob){
    const naoId = munTotal - munNonNull.length;
    notaCob.innerHTML =
      `<strong>Cobertura do piloto:</strong> ${munTotal} municípios acompanhados. ` +
      `${munNonNull.length} ${munNonNull.length === 1 ? 'tem' : 'têm'} liquidado não-nulo identificado na base do DER-PR; ` +
      `${naoId} ${naoId === 1 ? 'aparece' : 'aparecem'} com R$&nbsp;0 registrado. ` +
      `A ausência de valor não indica que o município não foi atendido — indica que o gasto ` +
      `não foi individualizado com código municipal na base orçamentária.`;
  }

  const abP = document.getElementById('argblock-paradoxo');
  if(abP){
    const naoId = munTotal - munNonNull.length;
    abP.innerHTML =
      `<h3>Rastreabilidade Orçamentária por Município <span class="periodo-badge">Dados 2025</span></h3>` +
      `<p><strong>Para o gestor público:</strong> ` +
      `${munNonNull.length > 0
        ? `${munNonNull.length} dos ${munTotal} municípios do piloto têm gasto da Ação 8398 identificado com código municipal na base orçamentária.`
        : `Nenhum dos ${munTotal} municípios do piloto tem gasto da Ação 8398 identificado com código municipal.`
      } ` +
      `Os ${naoId} ${naoId === 1 ? 'restante aparece' : 'restantes aparecem'} com R$&nbsp;0 registrado — ` +
      `não necessariamente porque não foram atendidos, mas porque contratos de conservação (PROCONSERVA, COP) ` +
      `são registrados tendo como unidade de execução a Superintendência Regional, não o município. ` +
      `${fmtR(semMunVal)} (${fmtNum(semMunPct, 2)}% do liquidado total) estão vinculados a um código genérico sem identificação municipal.</p>` +
      `<p><strong>Para o Tribunal de Contas (TCE-PR):</strong> ` +
      `A combinação de ${fmtNum(k.sem_rastreabilidade_pct, 1)}% do liquidado sem classificação por subprograma ` +
      `com ${fmtNum(semMunPct, 2)}% sem identificação municipal reduz a capacidade de controle por resultados. ` +
      `Sem o vínculo entre gasto e território, não é possível verificar, por município, ` +
      `se o investimento de conservação chegou onde a malha exigia e quais trechos foram efetivamente atendidos. ` +
      `Isso limita a auditoria ao nível de Superintendência Regional — que é o máximo de granularidade que a base atual permite.</p>` +
      `<p><strong>Para a política pública:</strong> ` +
      `A rastreabilidade territorial do gasto é condição necessária para o planejamento baseado em evidências. ` +
      `Indicadores como liquidado por km de malha por SR ou condição da superfície por corredor ` +
      `são o primeiro passo para transformar o orçamento de manutenção em instrumento de desenvolvimento regional auditável. ` +
      `Enquanto o gasto não for rastreável até o nível municipal ou de segmento de rodovia, ` +
      `qualquer análise de equidade na distribuição dos recursos fica limitada ao nível regional.</p>`;
  }

  // ── Alert card Noroeste (Aba 2) ─────────────────────────
  const noroeste = regionais.find(r => r.sr === 'SR Noroeste');
  document.getElementById('alert-noroeste').innerHTML =
    `<strong>${esc(noroeste.sr)} — Contratos Emergenciais 2025:</strong> ` +
    `${noroeste.emg} contratos emergenciais identificados na base de contratos do DER — ` +
    `sinal de pressão corretiva não planejada, indicativo de deterioração em trecho sem cobertura contratual regular. ` +
    `No gráfico de dispersão abaixo, a ${esc(noroeste.sr)} aparece destacada por estar abaixo da linha de tendência — ` +
    `recebendo menos por km do que regionais com malha em condição comparável ` +
    `(R$ ${fmtNum(noroeste.lkm)}/km, o menor valor entre as ${regionais.length} SRs).`;

  // ── HL cards Aba 3 ──────────────────────────────────────
  const srNorte    = regionais.find(r => r.sr === 'SR Norte');
  const srNoroeste = regionais.find(r => r.sr === 'SR Noroeste');
  const srMaiorLkm = srsByLkm[0];
  const noroesteKmTotal = Math.round(d.regionais['SR Noroeste'].km_total);
  document.getElementById('hl-grid').innerHTML =
    `<div class="hl-card danger">` +
      `<h4>⚠ ${esc(srNorte.sr)} — Pior IRI e FWD do Estado <span class="periodo-badge">Levantamento 2021–2022</span></h4>` +
      `<p>${fmtNum(srNorte.iri, 1)}% da malha em condição crítica (IRI) e ${fmtNum(srNorte.fwd, 1)}% com estrutura crítica (FWD) — ` +
      `indicadores mais elevados entre as ${regionais.length} SRs. ` +
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
  activateTab('execucao');
}

Promise.all([
  fetch(`${DATA_PATH.ROOT}der_precomputed.json`).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status+' ao carregar der_precomputed.json'); return r.json(); }),
  fetch(`${DATA_PATH.ROOT}dados_extras.json`).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status+' ao carregar dados_extras.json'); return r.json(); })
]).then(([d, extras])=>{
  contratos  = extras.contratos_dopsr1 || [];
  malhaKm    = extras.malha_km        || [];
  malhaLiqKm = extras.malha_pct       || [];
  initDashboard(d);
}).catch(err=>{
  document.querySelector('.tab-content').innerHTML =
    `<div class="error-panel">` +
    `<h2>Erro ao carregar dados</h2>` +
    `<p>Não foi possível carregar os arquivos de dados.</p>` +
    `<p class="error-detail">Detalhe: ${esc(err.message)}</p>` +
    `<p class="error-help">` +
    `Abra o painel a partir de um servidor local (ex: <code>python -m http.server</code> na raiz do projeto).</p>` +
    `</div>`;
});

