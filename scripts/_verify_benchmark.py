from playwright.sync_api import sync_playwright
import time

html_path = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
file_url = 'file:///' + html_path.replace('\\', '/').replace(' ', '%20')

logs = []
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    page.on('console', lambda msg: logs.append((msg.type, msg.text)))
    page.on('pageerror', lambda err: errors.append(str(err)))

    page.goto(file_url, wait_until='networkidle', timeout=30000)
    time.sleep(2)

    # Já começa na aba malha-retorno — aguarda render
    page.wait_for_timeout(2000)

    # Verifica tbodyBenchmarkInterno
    tbody = page.query_selector('#tbodyBenchmarkInterno')
    rows  = tbody.query_selector_all('tr') if tbody else []
    n_rows = len(rows)

    row_data = []
    for row in rows:
        cells = row.query_selector_all('td')
        row_data.append([c.inner_text() for c in cells])

    # Pega também os valores da tabela de eficiência por regional para comparar
    tbody_reg = page.query_selector('#tbodyReg')
    reg_rows  = tbody_reg.query_selector_all('tr') if tbody_reg else []
    reg_data  = []
    for row in reg_rows:
        cells = row.query_selector_all('td')
        reg_data.append([c.inner_text() for c in cells])

    # Screenshot
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_benchmark_interno.png',
                    full_page=False)

    browser.close()

print()
print('=== JS ERRORS ===')
if errors:
    for e in errors: print(f'  {e[:300]}')
else:
    print('  (none)')

js_errors = [t for t in logs if t[0] == 'error']
if js_errors:
    for typ, txt in js_errors: print(f'  [{typ}] {txt[:300]}')

print()
print(f'=== BENCHMARK INTERNO ({n_rows} linhas) ===')
for r in row_data:
    print(f'  {r}')

print()
print('=== TABELA EFICIÊNCIA POR REGIONAL (col Liquidado/km) ===')
for r in reg_data:
    # col 2 = Liquidado/km
    print(f'  SR={r[0].strip()!r:35s}  liq/km={r[2].strip()!r}')
