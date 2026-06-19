#!/usr/bin/env python3
"""
Monta painel_der.html autossuficiente:
- Embute CSS, JS, bibliotecas, imagens (base64) e dados JSON.
- Saída: dashboard/painel_der.html (sobrescreve in-place).
"""

import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH = os.path.join(ROOT, 'dashboard')
DATA = os.path.join(ROOT, 'data')

def read_text(path, enc='utf-8'):
    with open(path, encoding=enc, errors='replace') as f:
        return f.read()

def read_bytes(path):
    with open(path, 'rb') as f:
        return f.read()

def to_b64(path, mime):
    raw = read_bytes(path)
    b64 = base64.b64encode(raw).decode('ascii')
    return f'data:{mime};base64,{b64}'

# ── 1. CSS: painel.css com fallback de fonte ──────────────────────────────────
print('[1] Lendo painel.css e substituindo fonte...')
css_raw = read_text(os.path.join(DASH, 'css', 'painel.css'))
# Substitui referência à fonte Inter por stack de sistema
css_raw = css_raw.replace(
    "font-family:'Inter',sans-serif",
    "font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif"
).replace(
    'font-family:"Inter",sans-serif',
    'font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
)

# ── 2. CSS Leaflet (de vendor/) ───────────────────────────────────────────────
print('[2] Lendo leaflet.css...')
leaflet_css = read_text(os.path.join(DASH, 'vendor', 'leaflet.css'))

# ── 3. Bibliotecas JS (vendor/) ───────────────────────────────────────────────
print('[3] Lendo Chart.js e datalabels...')
chartjs      = read_text(os.path.join(DASH, 'vendor', 'chart.umd.min.js'))
datalabels   = read_text(os.path.join(DASH, 'vendor', 'chartjs-plugin-datalabels.min.js'))
leaflet_js   = read_text(os.path.join(DASH, 'vendor', 'leaflet.js'))

# ── 4. JS principal (painel.js) ───────────────────────────────────────────────
print('[4] Lendo painel.js...')
js_raw = read_text(os.path.join(DASH, 'js', 'painel.js'))

# Tarefa 7 — verificação de regex de escape
# O padrão errado seria /<\/g  (escaped slash que torna a regex inválida ou errada)
# Verifica e corrige caso exista
bad_regex = re.search(r'\.replace\s*\(\s*/\s*<\\\/', js_raw)
if bad_regex:
    print('  [7] CORRIGINDO regex de escape: encontrado /<\\/ → correto /< /')
    js_raw = re.sub(r'(\.replace\s*\(\s*)/\s*<\\/', r'\1/<', js_raw)
else:
    print('  [7] Regex de escape: nenhum erro encontrado (ok).')

# Tarefa 8 — adiciona console.log de validação após a inicialização de dados
# Injeta no início do bloco que processa STANDALONE_DATA (dentro do if/else da carga inicial)
VALIDATION_LOG = """
// ── Validação de modo standalone ──────────────────────────────────────────────
(function _standaloneCheck(){
  const isStandalone = !!(window.STANDALONE_DATA);
  const nContratos  = (window.STANDALONE_DATA && window.STANDALONE_DATA.dados_extras)
    ? (window.STANDALONE_DATA.dados_extras.contratos_dopsr1 || []).length : '(fetch)';
  const nMalha      = (window.STANDALONE_DATA && window.STANDALONE_DATA.dados_extras)
    ? (window.STANDALONE_DATA.dados_extras.malha_pct || []).length : '(fetch)';
  const hasBench    = !!(window.STANDALONE_DATA && window.STANDALONE_DATA.benchmark_nacional);
  console.log(
    '%c[DER Painel] Modo standalone: ' + (isStandalone ? 'SIM' : 'NÃO') + '\\n' +
    '  Contratos carregados: ' + nContratos + '\\n' +
    '  Registros de malha (SAM 2025): ' + nMalha + '\\n' +
    '  Benchmark nacional: ' + (hasBench ? 'SIM' : 'NÃO'),
    'background:#0D2B5E;color:#fff;padding:4px 8px;border-radius:4px'
  );
})();
"""
# Insere o log no início do bloco if(window.STANDALONE_DATA ...) — antes de qualquer código
standalone_block_marker = 'if (window.STANDALONE_DATA && window.STANDALONE_DATA.der_precomputed)'
if standalone_block_marker in js_raw:
    js_raw = js_raw.replace(standalone_block_marker, VALIDATION_LOG + standalone_block_marker)
    print('  [8] console.log de validação inserido.')
else:
    # Fallback: insere no topo do script
    js_raw = VALIDATION_LOG + '\n' + js_raw
    print('  [8] console.log de validação inserido no topo (marcador não encontrado).')

# ── 5. Imagens → base64 ───────────────────────────────────────────────────────
print('[5] Convertendo imagens para base64...')
img_map = {
    'assets/logo OpR.jpeg': {
        'path': os.path.join(DASH, 'assets', 'logo OpR.jpeg'),
        'mime': 'image/jpeg'
    },
    'assets/logo governo do paraná.png': {
        'path': os.path.join(DASH, 'assets', 'logo governo do paraná.png'),
        'mime': 'image/png'
    },
    'assets/logo der.png': {
        'path': os.path.join(DASH, 'assets', 'logo der.png'),
        'mime': 'image/png'
    },
}
img_b64 = {}
for key, info in img_map.items():
    if os.path.exists(info['path']):
        img_b64[key] = to_b64(info['path'], info['mime'])
        kb = len(img_b64[key]) * 3 // 4 // 1024
        print(f'  OK: {key} (~{kb}KB base64)')
    else:
        img_b64[key] = None
        print(f'  AVISO: não encontrado — {info["path"]}')

# ── 6. Dados JSON → STANDALONE_DATA ──────────────────────────────────────────
print('[6] Lendo JSONs de dados...')
json_files = {
    'der_precomputed': {
        'path': os.path.join(DATA, 'der_precomputed.json'),
        'label': 'der_precomputed.json'
    },
    'dados_extras': {
        'path': os.path.join(DATA, 'dados_extras.json'),
        'label': 'dados_extras.json'
    },
    'benchmark_nacional': {
        'path': os.path.join(DASH, 'data', 'benchmark_nacional.json'),
        'label': 'benchmark_nacional.json (dashboard/data/)'
    },
    'rodovias_pr': {
        'path': os.path.join(DASH, 'data', 'rodovias_pr.geojson'),
        'label': 'rodovias_pr.geojson (dashboard/data/)'
    },
}
standalone_data = {}
for key, info in json_files.items():
    if os.path.exists(info['path']):
        with open(info['path'], encoding='utf-8-sig') as f:
            standalone_data[key] = json.load(f)
        kb = os.path.getsize(info['path']) // 1024
        print(f'  OK: {info["label"]} ({kb}KB)')
    else:
        standalone_data[key] = None
        print(f'  AVISO: não encontrado — {info["path"]}')

# Serializa compact (sem espaços extras)
standalone_json = json.dumps(standalone_data, ensure_ascii=False, separators=(',', ':'))

# ── 7. Lê o HTML original ─────────────────────────────────────────────────────
print('[HTML] Lendo painel_der.html...')
html_src = read_text(os.path.join(DASH, 'painel_der.html'))

# ── 8. Monta o HTML final ─────────────────────────────────────────────────────
print('[HTML] Montando HTML autossuficiente...')

# Remove link Google Fonts
html_src = re.sub(
    r'\s*<link\s[^>]*fonts\.googleapis\.com[^>]*>\s*',
    '\n',
    html_src
)

# Remove <link rel="stylesheet" href="css/painel.css">
html_src = re.sub(
    r'\s*<link\s[^>]*href=["\']css/painel\.css["\'][^>]*>\s*',
    '\n',
    html_src
)

# Remove scripts CDN chart.js e datalabels
html_src = re.sub(
    r'\s*<script\s[^>]*cdn\.jsdelivr\.net[^>]*></script>\s*',
    '\n',
    html_src
)

# Remove <script src="js/painel.js"></script>
html_src = re.sub(
    r'\s*<script\s[^>]*src=["\']js/painel\.js["\'][^>]*></script>\s*',
    '\n',
    html_src
)

# Substitui src das imagens por base64
for src_attr, b64 in img_b64.items():
    if b64:
        # Escapa caracteres especiais do src para uso em regex
        src_escaped = re.escape(src_attr)
        html_src = re.sub(
            r'(<img\b[^>]*\bsrc=")' + src_escaped + r'"',
            r'\g<1>' + b64 + '"',
            html_src
        )

# Bloco CSS consolidado (leaflet + painel, Inter → sistema)
css_block = f'''<style>
/* ── Leaflet CSS ─────────────────────────────────── */
{leaflet_css}

/* ── Painel DER CSS ──────────────────────────────── */
{css_raw}
</style>'''

# Bloco de bibliotecas JS (antes do standalone_data)
libs_block = f'''<script>
/* Chart.js 4.4.4 — embutido de vendor/chart.umd.min.js */
{chartjs}
</script>
<script>
/* chartjs-plugin-datalabels 2.2.0 — embutido de vendor/chartjs-plugin-datalabels.min.js */
{datalabels}
</script>
<script>
/* Leaflet 1.9.x — embutido de vendor/leaflet.js */
{leaflet_js}
</script>'''

# Bloco de dados
data_block = f'''<script>
/* ── Dados autossuficientes ── gerado por scripts/build_standalone.py ── */
window.STANDALONE_DATA = {standalone_json};
</script>'''

# Insere CSS e bibliotecas antes de </head>
combined_head = css_block + '\n' + libs_block + '\n' + data_block
html_src = html_src.replace('</head>', combined_head + '\n</head>')

# Insere JS principal antes de </body>
js_block = f'''<script>
/* ── painel.js — embutido de js/painel.js ── */
{js_raw}
</script>'''
html_src = html_src.replace('</body>', js_block + '\n</body>')

# ── 9. Escreve o resultado ────────────────────────────────────────────────────
out_path = os.path.join(DASH, 'painel_der.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html_src)

size_kb = os.path.getsize(out_path) // 1024
print(f'\n[OK] painel_der.html gerado com sucesso — {size_kb} KB')
print(f'     Caminho: {out_path}')

# Sumário
print('\n─── Dependências externas remanescentes ───────────────────────────')
print('  1. OpenStreetMap tiles (https://{s}.tile.openstreetmap.org) — mapa de fundo Leaflet')
print('     Motivo: tiles rasterizados sob demanda; sem fallback estático offline.')
print('     Impacto: mapa de rodovias mostra fundo cinza (leaflet-offline-map) quando offline.')
print('     Linhas de traçado das rodovias (GeoJSON) continuam funcionando offline.')
print('  2. OpenStreetMap copyright link (href) no tooltip Leaflet — puramente informativo.')
print('─────────────────────────────────────────────────────────────────────')
