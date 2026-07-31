#!/usr/bin/env python3
"""
scripts/build_standalone.py
Gera dashboard/painel_der_standalone.html a partir do template leve
dashboard/painel_der.html (dados carregados via fetch em runtime).

NÃO sobrescreve dashboard/painel_der.html — esse é o arquivo-fonte, editável,
e continua sendo o único que se edita diretamente. Este script só lê os 3
JSONs de dados (data/der_precomputed.json, dashboard/data/benchmark_nacional.json,
dashboard/data/rodovias_pr_condicao.geojson), monta o bloco window.STANDALONE_DATA
com os três embutidos inline, e grava o resultado em painel_der_standalone.html —
uma cópia autossuficiente que abre via duplo clique (file://), sem servidor.

Uso:
    python scripts/build_standalone.py
"""

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH = os.path.join(ROOT, 'dashboard')
DATA = os.path.join(ROOT, 'data')

TEMPLATE_PATH = os.path.join(DASH, 'painel_der.html')
OUTPUT_PATH = os.path.join(DASH, 'painel_der_standalone.html')

F_DER_PRECOMPUTED = os.path.join(DATA, 'der_precomputed.json')
F_BENCHMARK = os.path.join(DASH, 'data', 'benchmark_nacional.json')
F_RODOVIAS_CONDICAO = os.path.join(DASH, 'data', 'rodovias_pr_condicao.geojson')

MARKER = 'window.STANDALONE_DATA = null;'


def read_json_literal(path):
    with open(path, encoding='utf-8-sig') as f:
        data = json.load(f)
    # Compacto (sem espaços) para não inflar o arquivo gerado à toa; escapa
    # </script literal para não fechar a tag prematuramente caso apareça
    # dentro de algum valor de texto.
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</script', '<\\/script')


def main():
    with open(TEMPLATE_PATH, encoding='utf-8', newline='') as f:
        html = f.read()

    idx = html.find(MARKER)
    if idx < 0:
        raise SystemExit(
            f"Marcador '{MARKER}' não encontrado em {TEMPLATE_PATH}.\n"
            "Este script espera o template leve (window.STANDALONE_DATA = null;). "
            "Se painel_der.html já estiver com dados embutidos (versão standalone "
            "antiga), não rode este script sobre ele — edite sempre a versão leve."
        )

    script_start = html.rfind('<script>', 0, idx)
    script_end = html.find('</script>', idx)
    if script_start < 0 or script_end < 0:
        raise SystemExit("Não foi possível localizar o bloco <script> do STANDALONE_DATA.")
    script_end += len('</script>')

    print('[1/3] Lendo data/der_precomputed.json...')
    der_precomputed = read_json_literal(F_DER_PRECOMPUTED)
    print('[2/3] Lendo dashboard/data/benchmark_nacional.json...')
    benchmark_nacional = read_json_literal(F_BENCHMARK)
    print('[3/3] Lendo dashboard/data/rodovias_pr_condicao.geojson...')
    rodovias_pr_condicao = read_json_literal(F_RODOVIAS_CONDICAO)

    data_script = (
        '<script>\r\n'
        'window.STANDALONE_DATA = {\r\n'
        f'  "der_precomputed": {der_precomputed},\r\n'
        f'  "benchmark_nacional": {benchmark_nacional},\r\n'
        f'  "rodovias_pr_condicao": {rodovias_pr_condicao}\r\n'
        '};\r\n'
        '</script>'
    )

    html = html[:script_start] + data_script + html[script_end:]

    with open(OUTPUT_PATH, 'w', encoding='utf-8', newline='') as f:
        f.write(html)

    size_template_kb = os.path.getsize(TEMPLATE_PATH) // 1024
    size_output_kb = os.path.getsize(OUTPUT_PATH) // 1024
    print()
    print('=' * 55)
    print(f'[OK] Gerado: {OUTPUT_PATH}')
    print(f'     Template leve (painel_der.html):        {size_template_kb:>7,} KB')
    print(f'     Standalone gerado (painel_der_standalone.html): {size_output_kb:>7,} KB')
    print('=' * 55)


if __name__ == '__main__':
    main()
