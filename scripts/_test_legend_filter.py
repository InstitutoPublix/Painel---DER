from playwright.sync_api import sync_playwright

HTML = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
URL  = 'file:///' + HTML.replace('\\', '/').replace(' ', '%20')

def get_dataset_states(page):
    return page.evaluate("""() => {
        const charts = Object.values(Chart.instances);
        const c = charts.find(ch => ch.canvas && ch.canvas.id === 'chartContSR');
        if (!c) return null;
        return c.data.datasets.map((ds, i) => ({
            label: ds.label,
            hidden: c.getDatasetMeta(i).hidden
        }));
    }""")

def click_legend_item(page, idx):
    page.evaluate(f"""() => {{
        const charts = Object.values(Chart.instances);
        const c = charts.find(ch => ch.canvas && ch.canvas.id === 'chartContSR');
        if (!c) return;
        const item = c.legend.legendItems[{idx}];
        c.options.plugins.legend.onClick.call(c, {{}}, item, c.legend);
        c.update();
    }}""")
    page.wait_for_timeout(400)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)

    page.get_by_role('tab', name='Contratos DOPSR1').click()
    page.wait_for_timeout(1500)

    # 1. Estado inicial
    s0 = get_dataset_states(page)
    print('\n=== 1. ESTADO INICIAL ===')
    for d in (s0 or []): print(f'  {d["label"]}: hidden={d["hidden"]}')

    # 2. Botao presente?
    btn = page.query_selector('#btnMostrarTodasContSR')
    print(f'\n=== 2. BOTAO MOSTRAR TODAS ===')
    print(f'  Presente: {"SIM" if btn else "NAO"}')
    if btn: print(f'  Texto: {btn.inner_text()!r}')

    # 3. Ocultar Empenhado (idx 0)
    click_legend_item(page, 0)
    s1 = get_dataset_states(page)
    print('\n=== 3. APOS OCULTAR EMPENHADO ===')
    for d in (s1 or []): print(f'  {d["label"]}: hidden={d["hidden"]}')

    # 4. Ocultar Pago (idx 2) tambem
    click_legend_item(page, 2)
    s2 = get_dataset_states(page)
    print('\n=== 4. APOS OCULTAR PAGO TAMBEM ===')
    for d in (s2 or []): print(f'  {d["label"]}: hidden={d["hidden"]}')

    # 5. Screenshot com 2 series ocultas
    page.query_selector('#chartContSR').scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_legend_2hidden.png')

    # 6. Clicar em "Mostrar todas"
    if btn:
        btn.click()
        page.wait_for_timeout(400)
    s3 = get_dataset_states(page)
    print('\n=== 5. APOS MOSTRAR TODAS ===')
    for d in (s3 or []): print(f'  {d["label"]}: hidden={d["hidden"]}')

    # 7. Screenshot com todas visiveis
    page.wait_for_timeout(300)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_legend_restored.png')

    # 8. Re-ocultar Liquidado e restaurar (toggle)
    click_legend_item(page, 1)
    s4 = get_dataset_states(page)
    click_legend_item(page, 1)
    s5 = get_dataset_states(page)
    print('\n=== 6. TOGGLE LIQUIDADO (ocultar e reexibir) ===')
    print(f'  Apos ocultar: {[d["hidden"] for d in (s4 or [])]}')
    print(f'  Apos reexibir: {[d["hidden"] for d in (s5 or [])]}')

    print(f'\n=== 7. ERROS JS ===')
    print('  (nenhum)' if not errors else '\n'.join(f'  {e[:300]}' for e in errors))

    browser.close()
