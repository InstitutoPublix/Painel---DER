from playwright.sync_api import sync_playwright
import time, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html_path = os.path.join(ROOT, 'dashboard', 'painel_der_standalone.html')
file_url = 'file:///' + html_path.replace('\\', '/').replace(' ', '%20')
OUT = os.path.join(ROOT, 'scripts')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1500, 'height': 1000})
    page.goto(file_url, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)

    page.click('button.tab-btn[data-tab="pressao-execucao"]')
    page.wait_for_timeout(1000)

    results = {}
    for ano in ['2025', '2024']:
        page.select_option('#filtroAnoMalha', ano)
        page.wait_for_timeout(1200)
        liq = page.inner_text('#kpi-cont-liq')
        exec_ = page.inner_text('#kpi-cont-exec')
        emp = page.inner_text('#kpi-cont-emp')
        results[ano] = {'liquidado': liq, 'exec': exec_, 'empenhado': emp}
        print(ano, results[ano])

    # Volta pra 2025, aplica filtro de SR, screenshot modo "Ano selecionado"
    page.select_option('#filtroAnoMalha', '2025')
    page.wait_for_timeout(1000)
    page.select_option('#filtroContratoRegiao', 'SR Oeste')
    page.wait_for_timeout(1000)
    page.locator('#chartContSR').scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(OUT, 'ss_rp_fix_ano_2025_oeste.png'), full_page=False)

    # Modo comparar 2024x2025
    page.click('#execModeToggle button[data-mode="comparar"]')
    page.wait_for_timeout(1000)
    page.locator('#chartContSR').scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(OUT, 'ss_rp_fix_comparar_oeste.png'), full_page=False)

    browser.close()
    print('OK - screenshots salvos em scripts/ss_rp_fix_*.png')
    print(results)
