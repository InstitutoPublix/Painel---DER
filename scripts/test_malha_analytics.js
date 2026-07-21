const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const analytics = require('../dashboard/src/malha-analytics.js');

const { DEFAULT_SR_ORDER, normalizePctFraction, findSrMaiorPctRuimPessimo } = analytics;

function oldWrongLogic(rows) {
  return rows.reduce((a, b) => (b.pct_bom < a.pct_bom ? b : a), rows[0]);
}

function buildRowsFromDer(data) {
  const regionais = data.regionais || {};
  const years = new Set();
  Object.values(regionais).forEach(r => Object.keys(r.malha_por_ano || {}).forEach(y => years.add(y)));
  const latestYear = [...years].sort().at(-1);
  return {
    latestYear,
    rows: Object.entries(regionais).map(([sr, r]) => {
      const pct = (((r.malha_por_ano || {})[latestYear] || {}).pct) || {};
      return { sr, pct_ruim_pessimo: pct.ruim_pessimo, pct_regular: pct.regular, pct_bom: pct.bom_muito_bom };
    })
  };
}

const synthetic = [
  { sr: 'SR Regular Alta', pct_bom: 0.20, pct_regular: 0.75, pct_ruim_pessimo: 0.05 },
  { sr: 'SR Crítica', pct_bom: 0.80, pct_regular: 0.05, pct_ruim_pessimo: 0.15 },
  { sr: 'SR Neutra', pct_bom: 0.70, pct_regular: 0.20, pct_ruim_pessimo: 0.10 }
];
assert.equal(oldWrongLogic(synthetic).sr, 'SR Regular Alta', 'a fixture precisa detectar a regra antiga incorreta');
assert.equal(findSrMaiorPctRuimPessimo(synthetic).sr, 'SR Crítica', 'deve selecionar diretamente o maior Ruim+Péssimo');

const highRegular = [
  { sr: 'SR A', pct_bom: 0.05, pct_regular: 0.95, pct_ruim_pessimo: 0 },
  { sr: 'SR B', pct_bom: 0.60, pct_regular: 0.30, pct_ruim_pessimo: 0.10 }
];
assert.equal(findSrMaiorPctRuimPessimo(highRegular).sr, 'SR B', 'Regular elevado não pode ser classificado como Ruim+Péssimo');

const boundaries = [
  { sr: 'SR Zero', pct_ruim_pessimo: 0 },
  { sr: 'SR Cem', pct_ruim_pessimo: 100 }
];
assert.equal(normalizePctFraction(100), 1);
assert.equal(normalizePctFraction(0), 0);
assert.equal(findSrMaiorPctRuimPessimo(boundaries).sr, 'SR Cem', 'limite 100% deve vencer limite 0%');

const tie = [
  { sr: 'SR Oeste', pct_ruim_pessimo: 0.12 },
  { sr: 'SR Campos Gerais', pct_ruim_pessimo: 0.12 },
  { sr: 'SR Noroeste', pct_ruim_pessimo: 0.12 }
];
assert.equal(findSrMaiorPctRuimPessimo(tie, { srOrder: DEFAULT_SR_ORDER }).sr, 'SR Campos Gerais', 'empate segue a ordem canônica das SRs');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'src', 'painel-app.js'), 'utf8');
assert.doesNotMatch(source, /Ruim\+P[eé]ssimo[\s\S]{0,160}1\s*-\s*\(?[^;\n]*pct_bom/i, 'Ruim+Péssimo não pode ser calculado como complemento de pct_bom');
assert.doesNotMatch(source, /1\s*-\s*\(?[^;\n]*pct_bom[\s\S]{0,160}Ruim\+P[eé]ssimo/i, 'complemento de pct_bom não pode ser rotulado como Ruim+Péssimo');

const derPath = path.join(__dirname, '..', 'data', 'der_precomputed.json');
if (fs.existsSync(derPath)) {
  const sourceDer = JSON.parse(fs.readFileSync(derPath, 'utf8'));
  const { rows: sourceRows } = buildRowsFromDer(sourceDer);
  const sourceWinner = findSrMaiorPctRuimPessimo(sourceRows);

  const htmlPath = path.join(__dirname, '..', 'dashboard', 'painel_der.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/window\.STANDALONE_DATA\s*=\s*([\s\S]*?);\s*<\/script>/);
  if (match) {
    const embedded = JSON.parse(match[1]);
    const { rows: embeddedRows } = buildRowsFromDer(embedded.der_precomputed);
    const embeddedWinner = findSrMaiorPctRuimPessimo(embeddedRows);
    assert.deepEqual(
      { sr: embeddedWinner.sr, pct: embeddedWinner.pct_ruim_pessimo },
      { sr: sourceWinner.sr, pct: sourceWinner.pct_ruim_pessimo },
      'dados embutidos no standalone devem produzir a mesma SR crítica do JSON fonte'
    );
  }
}

console.log('OK malha analytics');