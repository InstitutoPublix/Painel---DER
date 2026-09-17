from playwright.sync_api import sync_playwright
import os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html_path = os.path.join(ROOT, 'dashboard', 'painel_der_standalone.html')
file_url = 'file:///' + html_path.replace('\\', '/').replace(' ', '%20')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1500, 'height': 1000})
    page.goto(file_url, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)
    page.click('button.tab-btn[data-tab="pressao-execucao"]')
    page.wait_for_timeout(1000)

    for ano in ['2025', '2024']:
        page.select_option('#filtroAnoMalha', ano)
        page.wait_for_timeout(1200)
        data = page.evaluate("""
            () => {
                const labels = chContSR.data.labels;
                const ds = chContSR.data.datasets;
                const corrente = ds.find(d => d.label === 'Exercício Corrente').data;
                const rp = ds.find(d => d.label === 'RP').data;
                return labels.map((l,i) => ({sr: l, corrente: corrente[i], rp: rp[i], total: corrente[i]+rp[i]}));
            }
        """)
        print('===', ano, '===')
        tot_c = 0; tot_r = 0
        for row in data:
            print(f"  {row['sr']:15s} corrente={row['corrente']:.2f}  rp={row['rp']:.2f}  total={row['total']:.2f}")
            tot_c += row['corrente']; tot_r += row['rp']
        print(f"  TOTAL corrente={tot_c:.2f} rp={tot_r:.2f} total={tot_c+tot_r:.2f}")

    browser.close()
