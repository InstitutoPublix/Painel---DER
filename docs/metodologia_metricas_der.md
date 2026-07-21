# Metodologia das métricas derivadas do Painel DER-PR

Este documento descreve as métricas derivadas exibidas no painel e suas limitações metodológicas. Nenhuma métrica combinada deve ser calculada sem verificação prévia de compatibilidade temporal entre condição SAM, financeiro e contratos.

## Regra temporal

- Condição da malha: ano SAM selecionado.
- Financeiro: ano financeiro selecionado, preferencialmente o mesmo ano SAM.
- Contratos e emergenciais: ano dos contratos selecionado, preferencialmente o mesmo ano SAM.
- Se os períodos divergirem, a métrica combinada deve ser marcada como não comparável ou declarar explicitamente a incompatibilidade.
- Contratos emergenciais de 2025 não podem entrar em score referente a SAM 2024 sem indicação explícita.

## Relação observada entre condição favorável e liquidado

Fórmula por SR:

```text
km_favoravel_por_milhao_liquidado =
  (km_Bom + km_Muito_Bom) / liquidado_anual * 1.000.000

liquidado_por_km_favoravel =
  liquidado_anual / (km_Bom + km_Muito_Bom)
```

Competências:

- `km_Bom` e `km_Muito_Bom`: estoque de condição SAM do ano selecionado.
- `liquidado_anual`: fluxo financeiro DOPSR1 do mesmo ano.

Regra de interpretação:

- É uma relação descritiva entre estoque acumulado e fluxo anual.
- Não mede desempenho, produtividade, efeito do gasto ou qualidade da alocação.
- Uma SR com mais km favoráveis por R$ milhão liquidado não deve ser classificada como melhor, produtiva ou responsável por resultado.

## Sinalizador de Pressão de Conservação (SPC)

O SPC é um sinalizador composto e relativo às cinco SRs exibidas. Ele não possui validação preditiva formal e não antecipa resultado futuro.

Componentes por SR:

- `% Regular`: participação da malha SAM em condição Regular.
- `% Ruim+Péssimo`: participação da malha SAM em condição Ruim ou Péssimo.
- `% Emergenciais`: contratos emergenciais / total de contratos da SR.

Escala e normalização:

```text
norm(x_sr) = x_sr / max(x entre as 5 SRs)
```

O denominador mínimo usado em cálculo é `0,001` para evitar divisão por zero. A escala final fica entre 0 e 1, relativa ao conjunto de cinco SRs.

Pesos padrão:

```text
SPC =
  1/3 * norm(% Regular) +
  1/3 * norm(% Ruim+Péssimo) +
  1/3 * norm(% Emergenciais)
```

Limiar de leitura:

- `SPC >= 0,67`: sinal alto.
- `0,33 <= SPC < 0,67`: sinal intermediário.
- `SPC < 0,33`: sinal baixo.

Tratamento de dados ausentes:

- Componentes ausentes ou inválidos entram como zero.
- A ausência deve ser preservada no resultado da função e exibida em tooltip quando aplicável.

Dependência do conjunto:

- Como a normalização usa o máximo observado entre as cinco SRs, o SPC é comparativo dentro desse conjunto.
- O ranking pode mudar se o conjunto de SRs mudar ou se os pesos forem alterados.

## Análise de sensibilidade

A análise é reproduzível pela função `analisarSensibilidadePressao` em `dashboard/src/malha-analytics.js`.

Cenários mínimos:

- Pesos iguais: `Regular=1/3`, `Ruim+Péssimo=1/3`, `Emergenciais=1/3`.
- Maior peso para Ruim+Péssimo: `Regular=0,25`, `Ruim+Péssimo=0,50`, `Emergenciais=0,25`.
- Maior peso para Regular/contratual: `Regular=0,40`, `Ruim+Péssimo=0,20`, `Emergenciais=0,40`.

Regra de instabilidade:

- O painel registra instabilidade quando a SR no topo muda ou quando alguma SR varia duas ou mais posições entre cenários.
- Quando há instabilidade, a interface deve exibir limitação metodológica e evitar categorias rígidas.

## Funções testáveis

- `calcularRelacaoCondicaoLiquidado(rows)`
- `calcularSinalizadorPressaoConservacao(rows, options)`
- `analisarSensibilidadePressao(rows, options)`

Essas funções são puras: não acessam DOM, estado global do painel nem arquivos externos.
