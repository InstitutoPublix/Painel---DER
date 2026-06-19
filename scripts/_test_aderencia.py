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

    # Ativa aba Malha
    tabs = page.query_selector_all('.tab-btn')
    malha_tab = next((t for t in tabs if 'Malha' in t.inner_text()), None)
    if malha_tab:
        malha_tab.click()
        page.wait_for_timeout(1500)

    tbody = page.query_selector('#tbodyParticipacaoCriticidade')
    if not tbody:
        print('ERRO: tbody nao encontrado')
        browser.close()
        sys.exit(1)

    rows = tbody.query_selector_all('tr')
    print(f'Linhas: {len(rows)} (esperado 5)\n')

    print(f'{"SR":<22} {"% Gasto":>9} {"% Crit":>9} {"Diff":>8} {"Indice":>8}  Badge')
    print('-' * 75)

    sum_gasto = 0.0
    sum_crit  = 0.0
    for row in rows:
        cells = row.query_selector_all('td')
        if len(cells) < 5:
            print(f'AVISO: linha com {len(cells)} colunas (esperado 5)')
            continue
        sr     = cells[0].inner_text().strip()
        pg     = cells[1].inner_text().strip()
        pc     = cells[2].inner_text().strip()
        diff   = cells[3].inner_text().strip()
        idx_td = cells[4].inner_text().strip()
        badge  = cells[4].query_selector('.badge')
        badge_txt = badge.inner_text().strip() if badge else '(sem badge)'
        print(f'{sr:<22} {pg:>9} {pc:>9} {diff:>8} {idx_td[:8]:>8}  {badge_txt}')
        try:
            sum_gasto += float(pg.replace('%','').replace(',','.').strip())
            sum_crit  += float(pc.replace('%','').replace(',','.').strip())
        except ValueError:
            pass

    print(f'\nSoma % Gasto   : {sum_gasto:.1f}% (esperado ~100%)')
    print(f'Soma % Criticos: {sum_crit:.1f}% (esperado ~100%)')

    # Verifica legenda
    legenda = page.query_selector('.fn')
    print(f'\nLegenda presente: {"SIM" if legenda else "NAO"}')
    if legenda:
        txt = legenda.inner_text().strip()
        print(f'  Inicio: {txt[:80]}...')

    # Screenshot
    tbody.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_aderencia.png')
    print('\nScreenshot salvo.')

    print(f'\nErros JS: {errors if errors else "(nenhum)"}')
    browser.close()
