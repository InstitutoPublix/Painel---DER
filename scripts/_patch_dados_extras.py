"""
Garante que dados_extras esta embutido no STANDALONE_DATA
do arquivo painel_der_autossuficiente.html.

Se ja existir a chave dados_extras, nao faz nada (evita duplicata).
"""
import json
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH    = os.path.join(ROOT, 'dashboard', 'painel_der_autossuficiente.html')
EXTRAS_PATH  = os.path.join(ROOT, 'data', 'dados_extras.json')

# Valida dados_extras.json
with open(EXTRAS_PATH, 'r', encoding='utf-8-sig') as f:
    extras_raw = f.read().strip()
extras_obj = json.loads(extras_raw)
print(f"dados_extras: {list(extras_obj.keys())}")
print(f"  contratos_dopsr1: {len(extras_obj.get('contratos_dopsr1', []))} itens")
print(f"  malha_km:         {len(extras_obj.get('malha_km', []))} itens")
print(f"  malha_pct:        {len(extras_obj.get('malha_pct', []))} itens")

# Lê o HTML
with open(HTML_PATH, 'r', encoding='utf-8') as f:
    html = f.read()

print(f"\nArquivo: {HTML_PATH}")
print(f"Tamanho: {len(html):,} chars")

# Verifica se dados_extras ja e uma propriedade JS no STANDALONE_DATA
# (nao apenas string dentro de JSON embutido)
sd_start = html.find('window.STANDALONE_DATA')
if sd_start < 0:
    print("ERRO: window.STANDALONE_DATA nao encontrado")
    sys.exit(1)

# Extrai o bloco ate o fechamento }; </script>
sd_end = html.find('</script>', sd_start)
sd_block = html[sd_start:sd_end]

if 'dados_extras:' in sd_block:
    print("\ndados_extras JA ESTA no STANDALONE_DATA — nenhuma alteracao necessaria.")
    # Conta contratos no bloco
    count = sd_block.count('"contrato"')
    print(f"Contratos detectados no bloco: {count}")
    sys.exit(0)

# Se nao esta: aplica o patch
print("\ndados_extras AUSENTE — aplicando patch...")
old = '};\n</script>'
new = f',\n  dados_extras: {extras_raw}\n}};\n</script>'
if old not in html:
    print("AVISO: padrao de fechamento nao encontrado com \\n; tentando \\r\\n...")
    old = '};\r\n</script>'
    new = f',\r\n  dados_extras: {extras_raw}\r\n}};\r\n</script>'

if old not in html:
    print("ERRO: nao foi possivel localizar o fechamento do STANDALONE_DATA")
    sys.exit(1)

html_novo = html.replace(old, new, 1)
with open(HTML_PATH, 'w', encoding='utf-8') as f:
    f.write(html_novo)

print(f"Patch aplicado. Novo tamanho: {len(html_novo):,} chars")
