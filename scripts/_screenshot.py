from playwright.sync_api import sync_playwright
import time

html_path = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
file_url = 'file:///' + html_path.replace('\\', '/').replace(' ', '%20')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    page.goto(file_url, wait_until='networkidle', timeout=30000)
    time.sleep(2)

    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_malha.png', full_page=False)

    page.get_by_role('tab', name='Contratos DOPSR1').click()
    page.wait_for_timeout(1500)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_contratos.png', full_page=False)

    page.get_by_role('tab', name='Benchmark Nacional').click()
    page.wait_for_timeout(2000)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_benchmark.png', full_page=False)

    browser.close()
    print('Screenshots saved.')
