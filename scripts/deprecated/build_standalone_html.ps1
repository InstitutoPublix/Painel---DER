# Descontinuado em 2026-07-22 — dashboard/painel_der.html deixou de ser o
# arquivo autossuficiente (a arquitetura migrou para "HTML leve + fetch em
# runtime", com data/der_precomputed.json e os demais JSONs carregados via
# loadJsonData()). Este script sobrescreve dashboard\painel_der.html IN-PLACE
# por padrão ($OutputPath) — se rodado sobre o template leve atual, reembute
# os 3 datasets nele e destrói a versão leve (o mesmo tipo de acidente que já
# descontinuou scripts/deprecated/build_standalone.py em 2026-07-17). O
# substituto ativo é scripts/build_standalone.py, que nunca escreve em
# painel_der.html — só gera dashboard/painel_der_standalone.html. Não rode
# este script sem antes ajustar $OutputPath e revalidar a lógica de
# substituição de blocos contra o HTML atual.

param(
  [string]$OutputPath = "dashboard\painel_der.html"
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Read-Text([string]$RelativePath) {
  $path = Join-Path $Root $RelativePath
  if(-not (Test-Path $path)){ throw "Arquivo não encontrado: $RelativePath" }
  [System.IO.File]::ReadAllText($path, $Utf8NoBom)
}

function Read-JsonLiteral([string]$RelativePath) {
  (Read-Text $RelativePath).Trim() -replace '</script', '<\/script'
}

$templatePath = Join-Path $Root 'dashboard\painel_der.html'
$html = [System.IO.File]::ReadAllText($templatePath, $Utf8NoBom)

$eAgudo = [char]0x00E9
$labelRuimPessimo = "SR com Maior Ruim+P$($eAgudo)ssimo (SAM)"
$subRuimPessimo = "% Ruim+P$($eAgudo)ssimo"
$html = [regex]::Replace($html, 'SR com Pior Condi..o \(SAM\)', $labelRuimPessimo, 1)
$html = [regex]::Replace($html, '<div class="kpi-sub" id="kpi-sint-sr-pior-sub">.*?</div>', '<div class="kpi-sub" id="kpi-sint-sr-pior-sub">' + $subRuimPessimo + '</div>', 1)

$dataScript = @"
<script>
window.STANDALONE_DATA = {
  "der_precomputed": $(Read-JsonLiteral 'data\der_precomputed.json'),
  "benchmark_nacional": $(Read-JsonLiteral 'dashboard\data\benchmark_nacional.json'),
  "rodovias_pr": $(Read-JsonLiteral 'dashboard\data\rodovias_pr.geojson')
};
</script>
"@

$dataIdx = $html.IndexOf('window.STANDALONE_DATA')
if($dataIdx -lt 0){ throw 'Bloco window.STANDALONE_DATA não encontrado.' }
$dataStart = $html.LastIndexOf('<script', $dataIdx)
$dataEnd = $html.IndexOf('</script>', $dataIdx)
if($dataStart -lt 0 -or $dataEnd -lt 0){ throw 'Tag <script> do STANDALONE_DATA não encontrada.' }
$dataEnd += '</script>'.Length
$html = $html.Substring(0, $dataStart) + $dataScript + $html.Substring($dataEnd)

$analytics = (Read-Text 'dashboard\src\malha-analytics.js').Trim()
$app = (Read-Text 'dashboard\src\painel-app.js').Trim()
$appScripts = @"
<script>
/* malha-analytics.js - embutido de dashboard/src/malha-analytics.js */
$analytics
</script>
<script>
/* painel.js - embutido de dashboard/src/painel-app.js */
$app
</script>
</body>
"@

$appIdx = $html.LastIndexOf('painel.js')
if($appIdx -lt 0){ throw 'Marcador painel.js não encontrado.' }
$appStart = $html.LastIndexOf('<script', $appIdx)
$analyticsIdx = $html.IndexOf('malha-analytics.js')
if($analyticsIdx -ge 0 -and $analyticsIdx -lt $appIdx){
  $analyticsStart = $html.LastIndexOf('<script', $analyticsIdx)
  if($analyticsStart -ge 0){ $appStart = $analyticsStart }
}
$bodyIdx = $html.IndexOf('</body>', $appIdx)
if($appStart -lt 0 -or $bodyIdx -lt 0){ throw 'Bloco de scripts do painel não encontrado.' }
$html = $html.Substring(0, $appStart) + $appScripts + $html.Substring($bodyIdx + '</body>'.Length)

$out = Join-Path $Root $OutputPath
[System.IO.File]::WriteAllText($out, $html, $Utf8NoBom)
Write-Host "Standalone regenerado: $OutputPath"