from playwright.sync_api import sync_playwright
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HTML = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
URL  = 'file:///' + HTML.replace('\\', '/').replace(' ', '%20')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2500)

    container = page.query_selector('#waffleRodovias')
    rows = container.query_selector_all('.waffle-row') if container else []
    print(f'Linhas: {len(rows)}, Blocos no Noroeste: {len(rows[0].query_selector_all(".waffle-block")) if rows else 0}')

    block_counts = {}
    for row in rows:
        lbl = row.query_selector('.waffle-label strong')
        blks = row.query_selector_all('.waffle-block')
        if lbl:
            block_counts[lbl.inner_text()] = len(blks)
    print('Blocos por SR:', block_counts)

    first_block = container.query_selector('.waffle-block') if container else None
    if first_block:
        print('Tooltip 1o bloco:', first_block.get_attribute('title'))

    legend_items = container.query_selector_all('.waffle-legend-item') if container else []
    print(f'Itens de legenda: {len(legend_items)}')

    print('Erros JS:', errors if errors else '(nenhum)')

    container.scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_waffle.png')
    print('Screenshot salvo.')
    browser.close()
