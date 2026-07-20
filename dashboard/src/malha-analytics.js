(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MalhaAnalytics = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const DEFAULT_SR_ORDER = ['SR Leste', 'SR Campos Gerais', 'SR Norte', 'SR Noroeste', 'SR Oeste'];

  function normalizePctFraction(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const fraction = Math.abs(n) > 1 ? n / 100 : n;
    return Math.min(1, Math.max(0, fraction));
  }

  function pctToDisplay(value) {
    return normalizePctFraction(value) * 100;
  }

  function srTieRank(sr, order) {
    const idx = order.indexOf(sr);
    return idx >= 0 ? idx : order.length;
  }

  function compareSrTie(a, b, order) {
    const rankA = srTieRank(a.sr, order);
    const rankB = srTieRank(b.sr, order);
    if (rankA !== rankB) return rankA - rankB;
    return String(a.sr || '').localeCompare(String(b.sr || ''), 'pt-BR');
  }

  function asNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback || 0);
  }

  function findSrMaiorPctRuimPessimo(rows, options) {
    const order = (options && options.srOrder) || DEFAULT_SR_ORDER;
    let winner = null;
    for (const row of rows || []) {
      if (!row) continue;
      const candidate = Object.assign({}, row, {
        pct_ruim_pessimo: normalizePctFraction(row.pct_ruim_pessimo)
      });
      if (!winner ||
          candidate.pct_ruim_pessimo > winner.pct_ruim_pessimo ||
          (candidate.pct_ruim_pessimo === winner.pct_ruim_pessimo && compareSrTie(candidate, winner, order) < 0)) {
        winner = candidate;
      }
    }
    return winner;
  }

  function calcularRelacaoCondicaoLiquidado(rows) {
    return (rows || []).map(row => {
      const kmFavoravel = asNumber(row && (row.kmFavoravel ?? row.kmBom));
      const liquidado = asNumber(row && row.liquidado);
      return {
        sr: row && row.sr,
        kmFavoravel,
        kmBom: kmFavoravel,
        liquidado,
        kmFavoravelPorMilhaoLiquidado: liquidado > 0 ? kmFavoravel / liquidado * 1e6 : 0,
        kmPorMilhao: liquidado > 0 ? kmFavoravel / liquidado * 1e6 : 0,
        liquidadoPorKmFavoravel: kmFavoravel > 0 ? liquidado / kmFavoravel : null,
        custoPorKmBom: kmFavoravel > 0 ? liquidado / kmFavoravel : null
      };
    });
  }

  const PRESSAO_DEFAULT_WEIGHTS = Object.freeze({
    regular: 1 / 3,
    ruimPessimo: 1 / 3,
    emergencial: 1 / 3
  });

  const PRESSAO_DEFAULT_THRESHOLDS = Object.freeze({
    alta: 0.67,
    media: 0.33
  });

  const PRESSAO_SENSITIVITY_SCENARIOS = Object.freeze([
    {
      id: 'pesos_iguais',
      label: 'Pesos iguais',
      weights: { regular: 1 / 3, ruimPessimo: 1 / 3, emergencial: 1 / 3 }
    },
    {
      id: 'critico_prioritario',
      label: 'Maior peso para Ruim+Pessimo',
      weights: { regular: 0.25, ruimPessimo: 0.50, emergencial: 0.25 }
    },
    {
      id: 'regular_contratual',
      label: 'Maior peso para Regular/contratual',
      weights: { regular: 0.40, ruimPessimo: 0.20, emergencial: 0.40 }
    }
  ]);

  function normalizeWeights(weights) {
    const raw = Object.assign({}, PRESSAO_DEFAULT_WEIGHTS, weights || {});
    const regular = Math.max(0, asNumber(raw.regular));
    const ruimPessimo = Math.max(0, asNumber(raw.ruimPessimo));
    const emergencial = Math.max(0, asNumber(raw.emergencial));
    const total = regular + ruimPessimo + emergencial;
    if (total <= 0) return Object.assign({}, PRESSAO_DEFAULT_WEIGHTS);
    return {
      regular: regular / total,
      ruimPessimo: ruimPessimo / total,
      emergencial: emergencial / total
    };
  }

  function normalizePctDisplay(value) {
    const n = asNumber(value);
    return Math.abs(n) <= 1 ? n * 100 : n;
  }

  function calcularSinalizadorPressaoConservacao(rows, options) {
    const thresholds = Object.assign({}, PRESSAO_DEFAULT_THRESHOLDS, (options && options.thresholds) || {});
    const weights = normalizeWeights(options && options.weights);
    const raw = (rows || []).map(row => {
      const missing = [];
      const has = key => row && row[key] !== undefined && row[key] !== null && Number.isFinite(Number(row[key]));
      if (!has('pctRegular')) missing.push('pctRegular');
      if (!has('pctRuimPess')) missing.push('pctRuimPess');
      if (!has('pctEmg')) missing.push('pctEmg');
      return {
        sr: row && row.sr,
        pctRegular: normalizePctDisplay(row && row.pctRegular),
        pctRuimPess: normalizePctDisplay(row && row.pctRuimPess),
        pctEmg: normalizePctDisplay(row && row.pctEmg),
        lkm: asNumber(row && row.lkm),
        periodos: row && row.periodos ? Object.assign({}, row.periodos) : {},
        missing
      };
    });

    const maxReg = Math.max.apply(null, raw.map(r => r.pctRegular).concat([0.001]));
    const maxRuim = Math.max.apply(null, raw.map(r => r.pctRuimPess).concat([0.001]));
    const maxEmg = Math.max.apply(null, raw.map(r => r.pctEmg).concat([0.001]));

    return raw.map(r => {
      const nReg = r.pctRegular / maxReg;
      const nRuim = r.pctRuimPess / maxRuim;
      const nEmg = r.pctEmg / maxEmg;
      const score = +(weights.regular * nReg + weights.ruimPessimo * nRuim + weights.emergencial * nEmg).toFixed(3);
      const faixa = score >= thresholds.alta ? 'sinal alto' : score >= thresholds.media ? 'sinal intermediario' : 'sinal baixo';
      return Object.assign({}, r, { nReg, nRuim, nEmg, score, spc: score, faixa, weights });
    });
  }

  function rankingFor(rows, order) {
    return rows
      .slice()
      .sort((a, b) => (b.score - a.score) || compareSrTie(a, b, order))
      .map((row, idx) => Object.assign({}, row, { rank: idx + 1 }));
  }

  function analisarSensibilidadePressao(rows, options) {
    const order = (options && options.srOrder) || DEFAULT_SR_ORDER;
    const scenarios = ((options && options.scenarios) || PRESSAO_SENSITIVITY_SCENARIOS).map(scenario => {
      const resultados = rankingFor(
        calcularSinalizadorPressaoConservacao(rows, {
          weights: scenario.weights,
          thresholds: options && options.thresholds
        }),
        order
      );
      return Object.assign({}, scenario, {
        resultados,
        ranking: resultados.map(r => r.sr)
      });
    });

    const base = scenarios[0] || { ranking: [] };
    const mudancas = [];
    scenarios.slice(1).forEach(scenario => {
      const basePos = Object.fromEntries(base.ranking.map((sr, idx) => [sr, idx]));
      scenario.ranking.forEach((sr, idx) => {
        const delta = Math.abs((basePos[sr] ?? idx) - idx);
        if (delta >= 2) mudancas.push({ scenario: scenario.id, sr, delta });
      });
      if (scenario.ranking[0] && scenario.ranking[0] !== base.ranking[0]) {
        mudancas.push({ scenario: scenario.id, sr: scenario.ranking[0], delta: 'topo' });
      }
    });

    return {
      scenarios,
      rankingMudou: mudancas.length > 0,
      mudancas
    };
  }

  return {
    DEFAULT_SR_ORDER,
    normalizePctFraction,
    pctToDisplay,
    findSrMaiorPctRuimPessimo,
    calcularRelacaoCondicaoLiquidado,
    calcularSinalizadorPressaoConservacao,
    analisarSensibilidadePressao,
    PRESSAO_SENSITIVITY_SCENARIOS
  };
});
