"""
@author Codex
@description Exercises real browser SSE reconnection, cross-tab invalidation and idle request suppression.
"""
import json
import os
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def run(url):
    """Drive the rendered product while fixture mutations represent another client or background producer."""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(url + "/schedules", wait_until="domcontentloaded")
        expect(page.get_by_role("button", name=re.compile(r"^Initial session\b"))).to_be_visible(timeout=60000)
        expect(page.get_by_role("region", name="任务列表")).to_be_visible(timeout=60000)
        assert "/schedules" in page.url
        assert page.title()
        assert page.locator("vite-error-overlay").count() == 0

        second = context.new_page()
        second.goto(url + "/schedules", wait_until="domcontentloaded")
        expect(second.get_by_role("button", name=re.compile(r"^Initial session\b"))).to_be_visible(timeout=30000)
        page.request.post(url + "/e2e/rename", data={"title": "Cross-page session"})
        for target in [page, second]:
            expect(target.get_by_role("button", name=re.compile(r"^Cross-page session\b"))).to_be_visible()

        notice = page.request.post(url + "/e2e/notice").json()
        for target in [page, second]:
            expect(target.get_by_role("button", name="通知，1 条未读", exact=True)).to_be_visible()
        page.get_by_role("button", name="通知，1 条未读", exact=True).click()
        expect(page.get_by_text("Pushed notice", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        page.request.post(url + "/api/workspaces/w/sessions/seed/read", data={"version": notice["version"]})
        for target in [page, second]:
            expect(target.get_by_role("button", name="通知，0 条未读", exact=True)).to_be_visible()

        page.request.post(url + "/e2e/task")
        for target in [page, second]:
            expect(target.get_by_role("article", name="Pushed scheduler task", exact=True)).to_be_visible(timeout=15000)
        page.request.post(url + "/api/scheduler/service/stop")
        for target in [page, second]:
            expect(target.get_by_text("定时任务服务已停止。请在 Settings 的“定时任务”中启动服务。", exact=True)).to_be_visible(timeout=15000)
        page.request.post(url + "/api/scheduler/service/start")
        for target in [page, second]:
            expect(target.get_by_role("article", name="Pushed scheduler task", exact=True)).to_be_visible(timeout=15000)
        second.close()
        page.request.post(url + "/e2e/disconnect")
        expect(page.get_by_role("button", name=re.compile(r"^Recovered session\b"))).to_be_visible(timeout=65000)
        page.wait_for_timeout(1500)
        stats = page.request.get(url + "/e2e/stats").json()
        assert stats["streams"] == 1, stats["streams"]

        def queries(snapshot):
            """Count business HTTP reads, excluding persistent SSE and fixture administration."""
            return [item for item in snapshot["requests"] if item["method"] == "GET" and item["url"] != "/api/data/events"]

        before = len(queries(stats))
        page.wait_for_timeout(11000)
        after = len(queries(page.request.get(url + "/e2e/stats").json()))
        assert before == after, f"Idle HTTP queries increased: {before} -> {after}"
        artifact = Path(os.environ.get("SSE_E2E_ARTIFACT_DIR", str(Path(__file__).resolve().parents[4] / ".tmp-sse" / "sse-e2e")))
        artifact.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(artifact / "business-data-sse.png"), full_page=False)
        assert not errors, json.dumps(errors, ensure_ascii=False)
        print("SSE_BROWSER_OK " + json.dumps({"idleQueries": 0, "streams": 1, "screenshot": str(artifact / "business-data-sse.png")}))
        context.close()
        browser.close()


if __name__ == "__main__":
    run(sys.argv[1])
