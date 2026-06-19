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

    # Extrai labels e dados brutos de cada grafico
    result = page.evaluate("""() => {
        const charts = Object.values(Chart.instances);
        const get = id => {
            const c = charts.find(ch => ch.canvas && ch.canvas.id === id);
            if (!c) return null;
            const labels = c.data.labels;
            const ds = c.data.datasets;
            // ds[0]=Pessimo, ds[1]=Ruim
            return labels.map((sr, i) => ({
                sr,
                pessimo: ds[0].data[i],
                ruim:    ds[1].data[i],
                soma:    +(ds[0].data[i] + ds[1].data[i]).toFixed(2)
            }));
        };
        return { iri: get('chartIRI'), fwd: get('chartFWD') };
    }""")

    for nome, dados in [('IRI', result['iri']), ('FWD', result['fwd'])]:
        print(f'\n=== {nome} (topo para base) ===')
        if not dados:
            print('  ERRO: grafico nao encontrado')
            continue
        for i, d in enumerate(dados):
            ok = ''
            if i > 0:
                ant = dados[i-1]['soma']
                ok = 'OK' if d['soma'] <= ant else 'ERRO (ordem invertida)'
            print(f'  {i+1}. {d["sr"]:20s}  Ruim+Pessimo={d["soma"]:5.1f}%  {ok}')
        ordens_ok = all(dados[i]['soma'] <= dados[i-1]['soma'] for i in range(1, len(dados)))
        print(f'  Ordem decrescente: {"OK" if ordens_ok else "ERRO"}')

    print(f'\n=== ERROS JS ===')
    print('  (nenhum)' if not errors else '\n'.join(f'  {e[:300]}' for e in errors))

    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_malha_order.png')
    browser.close()
