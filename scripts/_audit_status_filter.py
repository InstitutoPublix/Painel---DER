"""
Audita o filtro de Status na aba Contratos DOPSR1:
- Opções são geradas dinamicamente?
- Cada opção filtra corretamente a tabela?
- Combinação Status + Região funciona (AND)?
- Contagem bate com linhas visíveis?
- "Limpar filtros" reseta tudo?
"""
from playwright.sync_api import sync_playwright
import time

HTML = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
URL  = 'file:///' + HTML.replace('\\', '/').replace(' ', '%20')

def count_rows(page):
    tbody = page.query_selector('#tbodyContratos')
    return len(tbody.query_selector_all('tr')) if tbody else 0

def get_count_label(page):
    el = page.query_selector('#contratoFilterCount')
    return el.inner_text() if el else ''

def get_status_options(page):
    sel = page.query_selector('#filtroContratoStatus')
    if not sel:
        return []
    opts = sel.query_selector_all('option')
    return [(o.get_attribute('value'), o.inner_text()) for o in opts]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    logs, errors = [], []
    page.on('console', lambda m: logs.append((m.type, m.text)))
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2000)

    # ── Vai para aba Contratos ──────────────────────────────────────────────
    page.get_by_role('tab', name='Contratos DOPSR1').click()
    page.wait_for_timeout(1800)

    # ── 1. Opções do select Status ──────────────────────────────────────────
    opts = get_status_options(page)
    print('\n=== 1. OPÇÕES DE STATUS ===')
    for v, t in opts:
        print(f'  value={v!r:30s}  label={t!r}')
    has_dynamic = len(opts) > 1  # mais que só o "Todos os status"
    print(f'  Geradas dinamicamente: {"SIM" if has_dynamic else "NÃO — apenas default!"}')

    # ── 2. Baseline sem filtro ──────────────────────────────────────────────
    total_rows = count_rows(page)
    count_label = get_count_label(page)
    print(f'\n=== 2. BASELINE (sem filtro) ===')
    print(f'  Linhas na tabela: {total_rows}')
    print(f'  Contador: {count_label!r}')

    # ── 3. Filtra cada status individualmente ──────────────────────────────
    print('\n=== 3. FILTRO POR STATUS (individualmente) ===')
    status_values = [v for v, _ in opts if v]  # exclui o "" (todos)
    for status_val in status_values:
        page.select_option('#filtroContratoStatus', status_val)
        page.wait_for_timeout(600)
        rows = count_rows(page)
        label = get_count_label(page)
        # Verifica se a coluna Status de cada linha bate com o filtro
        tbody = page.query_selector('#tbodyContratos')
        row_els = tbody.query_selector_all('tr') if tbody else []
        mismatches = 0
        for row in row_els:
            cells = row.query_selector_all('td')
            if len(cells) >= 7:
                badge = cells[6].inner_text().strip()
                if badge != status_val:
                    mismatches += 1
        print(f'  Status={status_val!r}: {rows} linhas, contador={label!r}, '
              f'mismatches={mismatches} {"OK" if mismatches==0 else "ERRO"}')

    # ── 4. Combinação Status + Região (AND) ────────────────────────────────
    print('\n=== 4. COMBINAÇÃO Status + Região (AND) ===')
    # Pega as opções de região disponíveis
    regiao_opts = page.query_selector('#filtroContratoRegiao').query_selector_all('option')
    regioes = [(o.get_attribute('value'), o.inner_text()) for o in regiao_opts if o.get_attribute('value')]

    if status_values and regioes:
        st = status_values[0]
        rg = regioes[0][0]
        # Reset status first
        page.select_option('#filtroContratoStatus', st)
        page.wait_for_timeout(400)
        rows_status_only = count_rows(page)
        page.select_option('#filtroContratoRegiao', rg)
        page.wait_for_timeout(600)
        rows_combined = count_rows(page)
        print(f'  Só status={st!r}: {rows_status_only} linhas')
        print(f'  + regiao={rg!r}: {rows_combined} linhas  '
              f'(deve ser <= {rows_status_only}) '
              f'{"OK" if rows_combined <= rows_status_only else "ERRO — aumentou!"}')
        count_lbl = get_count_label(page)
        print(f'  Contador combinado: {count_lbl!r}')

    # ── 5. Limpar filtros ──────────────────────────────────────────────────
    print('\n=== 5. LIMPAR FILTROS ===')
    page.click('#limparFiltrosContrato')
    page.wait_for_timeout(600)
    rows_after = count_rows(page)
    status_after = page.query_selector('#filtroContratoStatus').evaluate('el => el.value')
    regiao_after = page.query_selector('#filtroContratoRegiao').evaluate('el => el.value')
    print(f'  Linhas após limpar: {rows_after} (esperado: {total_rows})'
          f' {"OK" if rows_after == total_rows else "ERRO"}')
    print(f'  Status reset: {status_after!r}  {"OK" if status_after == "" else "ERRO"}')
    print(f'  Região reset: {regiao_after!r}  {"OK" if regiao_after == "" else "ERRO"}')

    # ── 6. Erros JS ───────────────────────────────────────────────────────
    print('\n=== 6. ERROS JS ===')
    js_errs = [t for t in logs if t[0] == 'error'] + [('pageerror', e) for e in errors]
    if js_errs:
        for tp, txt in js_errs: print(f'  [{tp}] {txt[:300]}')
    else:
        print('  (nenhum)')

    # ── Screenshot com filtro Alta execução ────────────────────────────────
    page.select_option('#filtroContratoStatus', 'Alta execução')
    page.wait_for_timeout(600)
    page.query_selector('#contratoFilterCount').scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_status_filter.png')

    browser.close()
