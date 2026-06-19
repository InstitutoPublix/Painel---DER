from playwright.sync_api import sync_playwright

HTML = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
URL  = 'file:///' + HTML.replace('\\', '/').replace(' ', '%20')

def get_dataset_states(page, canvas_id):
    return page.evaluate(f"""() => {{
        const charts = Object.values(Chart.instances);
        const c = charts.find(ch => ch.canvas && ch.canvas.id === '{canvas_id}');
        if (!c) return null;
        return c.data.datasets.map((ds, i) => ({{
            label: ds.label,
            hidden: c.getDatasetMeta(i).hidden
        }}));
    }}""")

def click_legend(page, canvas_id, idx):
    page.evaluate(f"""() => {{
        const charts = Object.values(Chart.instances);
        const c = charts.find(ch => ch.canvas && ch.canvas.id === '{canvas_id}');
        if (!c) return;
        const item = c.legend.legendItems[{idx}];
        c.options.plugins.legend.onClick.call(c, {{}}, item, c.legend);
        c.update();
    }}""")
    page.wait_for_timeout(300)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)

    # A aba Malha e Retorno é a default - espera renderizar
    page.wait_for_timeout(2000)

    # 1. Botoes presentes
    btnIRI = page.query_selector('#btnLimparIRI')
    btnFWD = page.query_selector('#btnLimparFWD')
    print('\n=== 1. BOTOES ===')
    print(f'  btnLimparIRI: {"SIM - " + repr(btnIRI.inner_text()) if btnIRI else "NAO"}')
    print(f'  btnLimparFWD: {"SIM - " + repr(btnFWD.inner_text()) if btnFWD else "NAO"}')

    # 2. Estado inicial IRI
    s0_iri = get_dataset_states(page, 'chartIRI')
    s0_fwd = get_dataset_states(page, 'chartFWD')
    print('\n=== 2. ESTADO INICIAL ===')
    print('  IRI:', [(d['label'], d['hidden']) for d in (s0_iri or [])])
    print('  FWD:', [(d['label'], d['hidden']) for d in (s0_fwd or [])])

    # 3. Ocultar "Ruim" (idx 1) e "Muito Bom" (idx 4) no IRI
    click_legend(page, 'chartIRI', 1)
    click_legend(page, 'chartIRI', 4)
    s1_iri = get_dataset_states(page, 'chartIRI')
    s1_fwd = get_dataset_states(page, 'chartFWD')
    print('\n=== 3. APOS OCULTAR "RUIM" e "MUITO BOM" no IRI ===')
    print('  IRI:', [(d['label'], d['hidden']) for d in (s1_iri or [])])
    print('  FWD (nao afetado):', [(d['label'], d['hidden']) for d in (s1_fwd or [])])
    iri_changed = any(d['hidden'] for d in (s1_iri or []))
    fwd_unchanged = not any(d['hidden'] for d in (s1_fwd or []))
    print(f'  IRI tem series ocultas: {"OK" if iri_changed else "ERRO"}')
    print(f'  FWD nao afetado:        {"OK" if fwd_unchanged else "ERRO"}')

    # 4. Screenshot com IRI filtrado
    page.query_selector('#chartIRI').scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_iri_filtered.png')

    # 5. Clicar Limpar IRI — nao deve afetar FWD
    if btnIRI:
        btnIRI.click()
        page.wait_for_timeout(400)
    s2_iri = get_dataset_states(page, 'chartIRI')
    s2_fwd = get_dataset_states(page, 'chartFWD')
    print('\n=== 4. APOS LIMPAR IRI ===')
    print('  IRI:', [(d['label'], d['hidden']) for d in (s2_iri or [])])
    print('  FWD (deve seguir inalterado):', [(d['label'], d['hidden']) for d in (s2_fwd or [])])
    iri_reset = not any(d['hidden'] for d in (s2_iri or []))
    print(f'  IRI resetado: {"OK" if iri_reset else "ERRO"}')

    # 6. Ocultar "Pessimo" (idx 0) no FWD e limpar
    click_legend(page, 'chartFWD', 0)
    click_legend(page, 'chartFWD', 2)  # Regular
    s3_fwd = get_dataset_states(page, 'chartFWD')
    print('\n=== 5. APOS OCULTAR "PESSIMO" e "REGULAR" no FWD ===')
    print('  FWD:', [(d['label'], d['hidden']) for d in (s3_fwd or [])])

    if btnFWD:
        btnFWD.click()
        page.wait_for_timeout(400)
    s4_iri = get_dataset_states(page, 'chartIRI')
    s4_fwd = get_dataset_states(page, 'chartFWD')
    print('\n=== 6. APOS LIMPAR FWD ===')
    print('  IRI (deve seguir inalterado):', [(d['label'], d['hidden']) for d in (s4_iri or [])])
    print('  FWD:', [(d['label'], d['hidden']) for d in (s4_fwd or [])])
    fwd_reset = not any(d['hidden'] for d in (s4_fwd or []))
    iri_not_affected = not any(d['hidden'] for d in (s4_iri or []))
    print(f'  FWD resetado: {"OK" if fwd_reset else "ERRO"}')
    print(f'  IRI nao afetado: {"OK" if iri_not_affected else "ERRO"}')

    # 7. Screenshot final com tudo visivel
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_malha_restored.png')

    print(f'\n=== 7. ERROS JS ===')
    print('  (nenhum)' if not errors else '\n'.join(f'  {e[:300]}' for e in errors))

    browser.close()
