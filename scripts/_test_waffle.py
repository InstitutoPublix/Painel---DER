from playwright.sync_api import sync_playwright

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
    print('\n=== 1. CONTAINER ===')
    print(f'  Presente: {"SIM" if container else "NAO"}')

    if container:
        # Contar rows e blocos
        rows = container.query_selector_all('.waffle-row')
        print(f'  Linhas (SRs): {len(rows)}')
        for row in rows:
            label = row.query_selector('.waffle-label strong')
            km_el = row.query_selector('.waffle-km')
            blocks = row.query_selector_all('.waffle-block')
            label_txt = label.inner_text() if label else '?'
            km_txt    = km_el.inner_text() if km_el else '?'
            print(f'    {label_txt:20s}  {km_txt:12s}  {len(blocks):3d} blocos')

        # Verificar titulo e legenda
        title = container.query_selector('.chart-title')
        legend_items = container.query_selector_all('.waffle-legend-item')
        print(f'\n  Titulo: {title.inner_text()[:60] if title else "nao encontrado"}...')
        print(f'  Itens de legenda: {len(legend_items)}')
        for li in legend_items:
            swatch = li.query_selector('.waffle-legend-swatch')
            bg = swatch.evaluate('el => getComputedStyle(el).backgroundColor') if swatch else '?'
            print(f'    {li.inner_text().strip():15s}  bg={bg}')

        # Verificar tooltip do 1o bloco
        first_block = container.query_selector('.waffle-block')
        if first_block:
            tip = first_block.get_attribute('title')
            print(f'\n  Tooltip do 1o bloco: {tip!r}')

        # Verificar blocos ordenados corretamente (Noroeste deve ter mais blocos)
        block_counts = {}
        for row in rows:
            lbl = row.query_selector('.waffle-label strong')
            blks = row.query_selector_all('.waffle-block')
            if lbl:
                block_counts[lbl.inner_text()] = len(blks)
        max_sr = max(block_counts, key=lambda k: block_counts[k])
        min_sr = min(block_counts, key=lambda k: block_counts[k])
        print(f'\n  SR com mais blocos: {max_sr} ({block_counts[max_sr]})')
        print(f'  SR com menos blocos: {min_sr} ({block_counts[min_sr]})')

    # Screenshot
    if container:
        container.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_waffle.png')

    print(f'\n=== 2. ERROS JS ===')
    print('  (nenhum)' if not errors else '\n'.join(f'  {e[:300]}' for e in errors))

    browser.close()
