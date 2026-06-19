from playwright.sync_api import sync_playwright
import time

html_path = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
file_url = 'file:///' + html_path.replace('\\', '/').replace(' ', '%20')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    page.goto(file_url, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2000)

    # Scroll to benchmark section
    el = page.query_selector('#tbodyBenchmarkInterno')
    if el:
        el.scroll_into_view_if_needed()
        page.wait_for_timeout(500)

    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_bench_interno_view.png')
    browser.close()
    print('Screenshot saved.')
