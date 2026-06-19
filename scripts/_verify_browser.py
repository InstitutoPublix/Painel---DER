from playwright.sync_api import sync_playwright
import time, urllib.parse

html_path = r'C:\Users\Luiza Dias\Downloads\Painel - DER\dashboard\painel_der.html'
file_url = 'file:///' + html_path.replace('\\', '/').replace(' ', '%20')
print('Opening:', file_url[:80] + '...')

logs = []
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.on('console', lambda msg: logs.append((msg.type, msg.text)))
    page.on('pageerror', lambda err: errors.append(str(err)))

    page.goto(file_url, wait_until='networkidle', timeout=30000)
    time.sleep(3)

    standalone_log = [t for t in logs if 'DER Painel' in t[1] or 'standalone' in t[1].lower()]
    js_errors = [t for t in logs if t[0] == 'error'] + [('pageerror', e) for e in errors]

    tabs = page.query_selector_all('.tab-btn')
    tab_names = [t.inner_text() for t in tabs]

    results = {}
    for tab_name in tab_names:
        btn = page.get_by_role('tab', name=tab_name)
        btn.click()
        page.wait_for_timeout(1800)
        tab_id = btn.get_attribute('data-tab')
        pane = page.query_selector('#tab-' + tab_id)
        canvases = pane.query_selector_all('canvas') if pane else []
        tbodies = pane.query_selector_all('tbody') if pane else []
        has_content = any(tb.inner_text().strip() for tb in tbodies)
        results[tab_name] = {
            'canvases': len(canvases),
            'tables_filled': has_content
        }

    browser.close()

print()
print('=== STANDALONE LOG ===')
for typ, txt in standalone_log:
    print(f'  [{typ}] {txt[:500]}')

print()
print('=== JS ERRORS (blocking) ===')
if js_errors:
    for typ, txt in js_errors:
        print(f'  [{typ}] {txt[:300]}')
else:
    print('  (none)')

print()
print('=== TABS ===')
for name, r in results.items():
    print(f'  {name}: {r["canvases"]} canvas(es), tables_filled={r["tables_filled"]}')

print()
print('=== ALL CONSOLE MESSAGES ===')
for typ, txt in logs[:70]:
    print(f'  [{typ}] {txt[:180]}')
