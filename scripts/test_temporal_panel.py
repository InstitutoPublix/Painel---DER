import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
PANEL = ROOT / "dashboard" / "painel_der.html"


def clean_money(text):
    return re.sub(r"\s+", " ", text or "").strip()


def visible_text(page, selector):
    return clean_money(page.locator(selector).inner_text())


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 950})
        page.goto(PANEL.as_uri(), wait_until="domcontentloaded")
        expect(page.locator("#filtroAnoMalha")).to_have_value("2025")
        state_2025 = page.evaluate("window.DER_TEMPORAL_STATE")
        assert state_2025["selectedSamYear"] == "2025"
        assert state_2025["selectedFinancialYear"] == "2025"

        page.locator('[data-tab="pressao-execucao"]').click()
        expect(page.locator("#kpi-cont-total")).not_to_have_text("—")
        total_2025 = visible_text(page, "#kpi-cont-total")
        liq_2025 = visible_text(page, "#kpi-cont-liq")
        table_2025 = visible_text(page, "#tbodyContratos")
        assert "2025" in visible_text(page, "#tab-pressao-execucao .section-header")

        page.locator("#filtroAnoMalha").select_option("2024")
        expect(page.locator("#filtroAnoMalha")).to_have_value("2024")
        state_2024 = page.evaluate("window.DER_TEMPORAL_STATE")
        assert state_2024["selectedSamYear"] == "2024"
        assert state_2024["selectedFinancialYear"] == "2024"

        total_2024 = visible_text(page, "#kpi-cont-total")
        liq_2024 = visible_text(page, "#kpi-cont-liq")
        table_2024 = visible_text(page, "#tbodyContratos")
        assert liq_2024 != liq_2025, "Liquidado não pode ficar em cache ao mudar para 2024"
        assert table_2024 != table_2025, "Tabela de contratos deve trocar de competência"
        assert "2024" in visible_text(page, "#tab-pressao-execucao .section-header")
        assert "2025" not in visible_text(page, "#tab-pressao-execucao .section-header")
        assert page.locator("#tab-pressao-execucao .periodo-badge[title*='incompat']").count() == 0

        page.locator('[data-tab="leitura-regional"]').click()
        expect(page.locator("#tbodyReg")).not_to_have_text("")
        leitura_2024 = visible_text(page, "#tbodyReg")
        assert "não comparável" not in leitura_2024.lower()
        assert "2024" in visible_text(page, "#tab-leitura-regional .section-header")
        assert "2025" not in visible_text(page, "#tab-leitura-regional .section-header")

        page.locator('[data-tab="malha-diagnostico"]').click()
        assert "2024" in visible_text(page, "#kpi-exec-narrativa")
        assert "2024" in visible_text(page, "#grid-evolucao-malha") or "Evolução indisponível" in visible_text(page, "#evolucao-malha-narrativa")

        page.locator("#filtroAnoMalha").select_option("2025")
        expect(page.locator("#filtroAnoMalha")).to_have_value("2025")
        state_back = page.evaluate("window.DER_TEMPORAL_STATE")
        assert state_back["selectedSamYear"] == "2025"
        assert state_back["selectedFinancialYear"] == "2025"

        page.locator('[data-tab="pressao-execucao"]').click()
        expect(page.locator("#kpi-cont-total")).to_have_text(total_2025)
        expect(page.locator("#kpi-cont-liq")).to_have_text(liq_2025)
        assert visible_text(page, "#kpi-cont-total") == total_2025
        assert visible_text(page, "#kpi-cont-liq") == liq_2025
        assert visible_text(page, "#tbodyContratos") == table_2025
        browser.close()


if __name__ == "__main__":
    main()
