import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

HTML = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
URL  = 'file:///' + HTML.replace('\\', '/').replace(' ', '%20')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2000)

    # Ativa aba "Malha e Retorno do Investimento" (tab index 0)
    tabs = page.query_selector_all('.tab-btn')
    print(f'Abas encontradas: {len(tabs)}')
    for i, t in enumerate(tabs):
        print(f'  [{i}] {t.inner_text().strip()[:40]}')

    # Clica na aba correta
    malha_tab = next((t for t in tabs if 'Malha' in t.inner_text()), None)
    if malha_tab:
        malha_tab.click()
        page.wait_for_timeout(1500)
        print('\nAba "Malha" ativada.')

    # Verifica tbody
    tbody = page.query_selector('#tbodyParticipacaoCriticidade')
    if not tbody:
        print('ERRO: #tbodyParticipacaoCriticidade nao encontrado!')
        browser.close()
        sys.exit(1)

    rows = tbody.query_selector_all('tr')
    print(f'\nLinhas na tabela: {len(rows)}')

    total_gasto = 0.0
    total_crit  = 0.0
    print('\n{:<22} {:>12} {:>14} {:>12}'.format('SR', '% Gasto', '% km Criticos', 'Diferenca'))
    print('-' * 64)
    for row in rows:
        cells = row.query_selector_all('td')
        if len(cells) < 4:
            continue
        sr    = cells[0].inner_text().strip()
        pg    = cells[1].inner_text().strip()
        pc    = cells[2].inner_text().strip()
        diff  = cells[3].inner_text().strip()
        print(f'{sr:<22} {pg:>12} {pc:>14} {diff:>12}')
        try:
            total_gasto += float(pg.replace('%','').replace(',','.').strip())
            total_crit  += float(pc.replace('%','').replace(',','.').strip())
        except ValueError:
            pass

    print(f'\nSoma % Gasto   : {total_gasto:.1f}% (esperado ~100%)')
    print(f'Soma % Criticos: {total_crit:.1f}% (esperado ~100%)')

    ok_gasto = abs(total_gasto - 100) < 0.5
    ok_crit  = abs(total_crit  - 100) < 0.5
    print(f'\nVerificacao: % Gasto OK = {ok_gasto}, % Criticos OK = {ok_crit}')

    # Screenshot
    if tbody:
        tbody.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_participacao.png')
    print('Screenshot salvo.')

    print(f'\nErros JS: {errors if errors else "(nenhum)"}')
    browser.close()
