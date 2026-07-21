const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  calcularRelacaoCondicaoLiquidado,
  calcularSinalizadorPressaoConservacao,
  analisarSensibilidadePressao
} = require('../dashboard/src/malha-analytics.js');

const relacao = calcularRelacaoCondicaoLiquidado([
  { sr: 'SR A', kmFavoravel: 100, liquidado: 50_000_000 },
  { sr: 'SR B', kmFavoravel: 20, liquidado: 0 }
]);

assert.equal(relacao[0].kmFavoravelPorMilhaoLiquidado, 2);
assert.equal(relacao[0].kmPorMilhao, 2);
assert.equal(relacao[0].liquidadoPorKmFavoravel, 500_000);
assert.equal(relacao[1].kmFavoravelPorMilhaoLiquidado, 0);
assert.equal(relacao[1].liquidadoPorKmFavoravel, 0);

const sinal = calcularSinalizadorPressaoConservacao([
  { sr: 'SR A', pctRegular: 10, pctRuimPess: 20, pctEmg: 30, lkm: 1000 },
  { sr: 'SR B', pctRegular: 20, pctRuimPess: 40, pctEmg: 60, lkm: 2000 }
]);

assert.equal(sinal[0].score, 0.5);
assert.equal(sinal[1].score, 1);
assert.equal(sinal[1].faixa, 'sinal alto');

const ausente = calcularSinalizadorPressaoConservacao([
  { sr: 'SR Ausente', pctRegular: null, pctRuimPess: 10, lkm: 1 }
]);
assert.deepEqual(ausente[0].missing, ['pctRegular', 'pctEmg']);
assert.equal(ausente[0].pctRegular, 0);
assert.equal(ausente[0].pctEmg, 0);

const sensibilidade = analisarSensibilidadePressao([
  { sr: 'SR A', pctRegular: 100, pctRuimPess: 0, pctEmg: 0 },
  { sr: 'SR B', pctRegular: 0, pctRuimPess: 100, pctEmg: 0 },
  { sr: 'SR C', pctRegular: 0, pctRuimPess: 0, pctEmg: 100 }
], { srOrder: ['SR A', 'SR B', 'SR C'] });

assert.equal(sensibilidade.scenarios.length, 3);
assert.equal(sensibilidade.rankingMudou, true);
assert.equal(sensibilidade.scenarios[0].ranking[0], 'SR A');
assert.equal(sensibilidade.scenarios[1].ranking[0], 'SR B');

const derPath = path.join(__dirname, '..', 'data', 'der_precomputed.json');
if (fs.existsSync(derPath)) {
  const data = JSON.parse(fs.readFileSync(derPath, 'utf8'));
  for (const [sr, regional] of Object.entries(data.regionais || {})) {
    for (const [year, entry] of Object.entries(regional.malha_por_ano || {})) {
      const metadata = entry.metadata || {};
      const conditionYear = metadata.conditionYear ?? metadata.condition_year;
      assert.equal(String(conditionYear), String(year), `${sr} ${year}: conditionYear deve seguir SAM`);
      if (entry.financial && entry.financial.year != null) {
        assert.equal(String(entry.financial.year), String(year), `${sr} ${year}: financeiro deve seguir ano selecionado`);
      }
      if (entry.contracts && entry.contracts.year != null) {
        assert.equal(String(entry.contracts.year), String(year), `${sr} ${year}: contratos devem seguir ano selecionado`);
      }
      if (entry.emergencyContracts && entry.emergencyContracts.year != null) {
        assert.equal(String(entry.emergencyContracts.year), String(year), `${sr} ${year}: emergenciais devem seguir ano selecionado`);
      }
    }
  }
}

const painelSource = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'src', 'painel-app.js'), 'utf8');
assert.doesNotMatch(painelSource, /Press[aã]o Futura/i);
assert.doesNotMatch(painelSource, /ROI|srMaisEfic|renderEficiencia|calcularIndicePressao|renderIndicePressao/i);
assert.doesNotMatch(painelSource, /mais eficiente|desempenho causado pelo gasto/i);

console.log('OK metricas DER');
