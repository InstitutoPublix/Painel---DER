from playwright.sync_api import sync_playwright

HTML = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
URL  = 'file:///' + HTML.replace('\\', '/').replace(' ', '%20')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)
    page.get_by_role('tab', name='Contratos DOPSR1').click()
    page.wait_for_timeout(1500)

    # 1. Verificar ordem DOM (posicao Y)
    order = page.evaluate("""() => {
        const kpis   = document.querySelector('.kpi-grid');
        const filter = document.getElementById('contratoFilterPanel');
        const charts = document.querySelector('#chartContSR')?.closest('.grid-2');
        const table  = document.getElementById('tbodyContratos')?.closest('.table-wrap');
        if (!kpis || !filter || !charts || !table) return null;
        const r = el => el.getBoundingClientRect();
        return {
            kpi_bottom:    Math.round(r(kpis).bottom),
            filter_top:    Math.round(r(filter).top),
            filter_bottom: Math.round(r(filter).bottom),
            charts_top:    Math.round(r(charts).top),
            table_top:     Math.round(r(table).top)
        };
    }""")
    print('\n=== 1. ORDEM VISUAL (Y em px) ===')
    if order:
        print(f'  kpi-grid bottom:        {order["kpi_bottom"]}')
        print(f'  filtros top:            {order["filter_top"]}')
        print(f'  filtros bottom:         {order["filter_bottom"]}')
        print(f'  graficos top:           {order["charts_top"]}')
        print(f'  tabela top:             {order["table_top"]}')
        print(f'  Filtros apos KPIs:      {"OK" if order["filter_top"] >= order["kpi_bottom"] else "ERRO"}')
        print(f'  Graficos apos filtros:  {"OK" if order["charts_top"] >= order["filter_bottom"] else "ERRO"}')
        print(f'  Tabela apos graficos:   {"OK" if order["table_top"] >= order["charts_top"] else "ERRO"}')

    # 2. Opcoes disponiveis no select regiao
    opts = page.evaluate("""() => {
        const sel = document.getElementById('filtroContratoRegiao');
        return Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
    }""")
    print(f'\n=== 2. OPCOES DE REGIAO ({len(opts)} total) ===')
    for o in opts:
        print(f'  value={o["value"]!r:30s}  text={o["text"]!r}')

    # 3. Filtrar pela 1a regiao nao-vazia
    regioes_disponiveis = [o for o in opts if o["value"]]
    if regioes_disponiveis:
        v = regioes_disponiveis[0]["value"]
        page.evaluate(f"""() => {{
            const sel = document.getElementById('filtroContratoRegiao');
            sel.value = {repr(v)};
            sel.dispatchEvent(new Event('change'));
        }}""")
        page.wait_for_timeout(500)
        count_label = page.query_selector('#contratoFilterCount').inner_text()
        rows = len(page.query_selector('#tbodyContratos').query_selector_all('tr'))
        total_rows = page.evaluate("() => window._totalContratos || document.querySelectorAll('#tbodyContratos tr').length")
        print(f'\n=== 3. FILTRO REGIAO ({v!r}) ===')
        print(f'  Contador: {count_label!r}')
        print(f'  Linhas na tabela: {rows}')
        print(f'  Resultado OK: {"SIM" if rows < 46 else "Verificar"}')

    # 4. Limpar filtros
    page.click('#limparFiltrosContrato')
    page.wait_for_timeout(400)
    count_after = page.query_selector('#contratoFilterCount').inner_text()
    rows_after = len(page.query_selector('#tbodyContratos').query_selector_all('tr'))
    print(f'\n=== 4. APOS LIMPAR FILTROS ===')
    print(f'  Contador: {count_after!r}')
    print(f'  Linhas tabela: {rows_after}')
    print(f'  Reset OK: {"SIM" if rows_after > 0 else "ERRO"}')

    # 5. Screenshot: topo da aba (KPIs + filtros + inicio dos graficos)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(300)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_filter_position.png')

    print(f'\n=== 5. ERROS JS ===')
    print('  (nenhum)' if not errors else '\n'.join(f'  {e[:300]}' for e in errors))

    browser.close()
