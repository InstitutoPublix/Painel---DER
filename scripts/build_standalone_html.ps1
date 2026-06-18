param(
  [string]$Output = "dashboard\painel_der_autossuficiente.html"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Join-Root([string]$RelativePath) {
  Join-Path $Root $RelativePath
}

function Read-Text([string]$RelativePath) {
  [System.IO.File]::ReadAllText((Join-Root $RelativePath), [System.Text.Encoding]::UTF8)
}

function Write-Text([string]$RelativePath, [string]$Content) {
  $path = Join-Root $RelativePath
  $dir = Split-Path -Parent $path
  if($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  [System.IO.File]::WriteAllText($path, $Content, $Utf8NoBom)
}

function Escape-Script-End([string]$Text) {
  $Text -replace "</", "<\/"
}

function Data-Uri([string]$RelativePath, [string]$MimeType) {
  $bytes = [System.IO.File]::ReadAllBytes((Join-Root $RelativePath))
  "data:$MimeType;base64," + [System.Convert]::ToBase64String($bytes)
}

function Data-Uri-Path([string]$Path, [string]$MimeType) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  "data:$MimeType;base64," + [System.Convert]::ToBase64String($bytes)
}

$assetsDir = Join-Root "dashboard\assets"
$logoGoverno = Get-ChildItem -LiteralPath $assetsDir -Filter "logo governo do par*.png" |
  Select-Object -First 1
if(-not $logoGoverno) {
  throw "Logo do Governo do Parana nao encontrada em dashboard\assets."
}

$required = @(
  "dashboard\painel_der.html",
  "dashboard\css\painel.css",
  "dashboard\js\painel.js",
  "dashboard\vendor\chart.umd.min.js",
  "dashboard\vendor\chartjs-plugin-datalabels.min.js",
  "dashboard\vendor\leaflet.js",
  "dashboard\vendor\leaflet.css",
  "data\der_precomputed.json",
  "data\dados_extras.json",
  "dashboard\data\benchmark_nacional.json",
  "dashboard\data\rodovias_pr.geojson",
  "dashboard\assets\logo OpR.jpeg",
  "dashboard\assets\logo der.png"
)

$missing = $required | Where-Object { -not (Test-Path -LiteralPath (Join-Root $_)) }
if($missing.Count -gt 0) {
  throw "Arquivos ausentes para gerar o HTML autossuficiente: $($missing -join ', ')"
}

$html = Read-Text "dashboard\painel_der.html"
$painelCss = Read-Text "dashboard\css\painel.css"
$leafletCss = Read-Text "dashboard\vendor\leaflet.css"
$chartJs = Escape-Script-End (Read-Text "dashboard\vendor\chart.umd.min.js")
$datalabelsJs = Escape-Script-End (Read-Text "dashboard\vendor\chartjs-plugin-datalabels.min.js")
$leafletJs = Escape-Script-End (Read-Text "dashboard\vendor\leaflet.js")
$painelJs = Escape-Script-End (Read-Text "dashboard\js\painel.js")

$derJson = Escape-Script-End (Read-Text "data\der_precomputed.json")
$extrasJson = Escape-Script-End (Read-Text "data\dados_extras.json")
$benchmarkJson = Escape-Script-End (Read-Text "dashboard\data\benchmark_nacional.json")
$rodoviasJson = Escape-Script-End (Read-Text "dashboard\data\rodovias_pr.geojson")

$headBlock = @"
<!-- Arquivo autossuficiente: CSS e bibliotecas embutidos pelo script scripts/build_standalone_html.ps1. -->
<style>
$leafletCss
$painelCss
</style>
<script>
$chartJs
</script>
<script>
$datalabelsJs
</script>
<script>
$leafletJs
</script>
"@

$dataBlock = @"
<script>
window.PAINEL_STANDALONE = true;
window.STANDALONE_DATA = {
  der_precomputed: $derJson,
  dados_extras: $extrasJson,
  benchmark_nacional: $benchmarkJson,
  rodovias_pr: $rodoviasJson
};
</script>
<script>
$painelJs
</script>
"@

$html = [regex]::Replace(
  $html,
  '(?s)(<!--.*?-->\s*)?<link href="https://fonts\.googleapis\.com.*?<link rel="stylesheet" href="css/painel\.css">\s*',
  $headBlock + "`r`n"
)

$html = $html.Replace('src="assets/logo OpR.jpeg"', 'src="' + (Data-Uri "dashboard\assets\logo OpR.jpeg" "image/jpeg") + '"')
$html = [regex]::Replace($html, 'src="assets/logo governo do par.*?\.png"', 'src="' + (Data-Uri-Path $logoGoverno.FullName "image/png") + '"', 1)
$html = $html.Replace('src="assets/logo der.png"', 'src="' + (Data-Uri "dashboard\assets\logo der.png" "image/png") + '"')
$html = $html.Replace('<script src="js/painel.js"></script>', $dataBlock)

Write-Text $Output $html

$outPath = Join-Root $Output
$sizeMb = [math]::Round((Get-Item -LiteralPath $outPath).Length / 1MB, 2)
Write-Host "HTML autossuficiente gerado em: $outPath"
Write-Host "Tamanho: $sizeMb MB"
