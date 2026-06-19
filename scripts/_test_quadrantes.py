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

    # 1) canvas chartQuadrantes existe?
    canvas = page.query_selector('#chartQuadrantes')
    print(f'Canvas #chartQuadrantes: {"OK" if canvas else "AUSENTE"}')

    # 2) Chart.js criou instancia?
    chart_ok = page.evaluate("""() => {
        const charts = Object.values(Chart.instances);
        return !!charts.find(ch => ch.canvas && ch.canvas.id === 'chartQuadrantes');
    }""")
    print(f'Instancia Chart.js: {"OK" if chart_ok else "NAO ENCONTRADA"}')

    # 3) Dados dos pontos
    pts = page.evaluate("""() => {
        const charts = Object.values(Chart.instances);
        const ch = charts.find(c => c.canvas && c.canvas.id === 'chartQuadrantes');
        if (!ch) return null;
        return ch.data.datasets[0].data.map(d => ({sr: d.sr, x: d.x, y: d.y, quadrante: d.quadrante}));
    }""")

    if pts:
        print(f'\nPontos no grafico ({len(pts)}):\n')
        print(f'{"SR":<22} {"X (% Ruim+Pess)":>18} {"Y (Liq/km)":>14} {"Quadrante"}')
        print('-' * 85)
        for pt in pts:
            print(f'{pt["sr"]:<22} {pt["x"]:>18.1f} {pt["y"]:>14,.0f}  {pt["quadrante"]}')
    else:
        print('ERRO: nao foi possivel ler dados do grafico')

    # 4) Tabela-resumo #quadrantesResumo
    resumo = page.query_selector('#quadrantesResumo')
    rows = resumo.query_selector_all('tbody tr') if resumo else []
    print(f'\nTabela-resumo: {len(rows)} linhas (esperado 5)')
    for row in rows:
        cells = row.query_selector_all('td')
        if len(cells) >= 4:
            badge = cells[3].query_selector('.badge')
            print(f'  {cells[0].inner_text().strip():<22}  {cells[3].inner_text().strip()}')

    # 5) Medianas calculadas de forma dinamica
    med = page.evaluate("""() => {
        const charts = Object.values(Chart.instances);
        const ch = charts.find(c => c.canvas && c.canvas.id === 'chartQuadrantes');
        if (!ch) return null;
        const data = ch.data.datasets[0].data;
        const xs = data.map(d=>d.x).sort((a,b)=>a-b);
        const ys = data.map(d=>d.y).sort((a,b)=>a-b);
        const med = arr => arr.length%2 ? arr[Math.floor(arr.length/2)] : (arr[arr.length/2-1]+arr[arr.length/2])/2;
        return {medX: med(xs), medY: med(ys)};
    }""")
    if med:
        print(f'\nMediana X (% Ruim+Pess): {med["medX"]:.2f}%')
        print(f'Mediana Y (Liquidado/km): R$ {med["medY"]:,.0f}')

    # Screenshot
    if canvas:
        canvas.scroll_into_view_if_needed()
    page.wait_for_timeout(600)
    page.screenshot(path=r'C:\Users\Luiza Dias\Downloads\Painel - DER\scripts\ss_quadrantes.png')
    print('\nScreenshot salvo.')

    print(f'\nErros JS: {errors if errors else "(nenhum)"}')
    browser.close()
