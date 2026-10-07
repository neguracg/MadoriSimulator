# -*- coding: utf-8 -*-
import json, sys
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
URL = "http://localhost:5173/"
CELL = 22
KEY = "madori-simulator-project-v1"

def ctx(browser, w=1280, h=900):
    return browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1,
                               color_scheme="light", locale="ja-JP", timezone_id="Asia/Tokyo", reduced_motion="reduce")

def svg_origin(page):
    b = page.locator("svg.canvas").bounding_box()
    return b["x"], b["y"]

def cell_pt(page, cx, cy, fx=0.5, fy=0.5):
    ox, oy = svg_origin(page)
    return ox + (cx + fx) * CELL, oy + (cy + fy) * CELL

def drag(page, a, b, steps=6):
    page.mouse.move(*a); page.mouse.down(); page.mouse.move(*b, steps=steps); page.mouse.up()

def doc(page):
    p = json.loads(page.evaluate(f"localStorage.getItem('{KEY}')"))
    return next(pl for pl in p["plans"] if pl["id"] == p["activePlanId"])["doc"], p

def undo_count(page):
    n = 0
    btn = page.locator("button", has_text="Undo")
    while btn.is_enabled() and n < 300:
        btn.click(); n += 1
    return n

def make_room(page, x0, y0, x1, y1, name="R"):
    drag(page, cell_pt(page, x0, y0), cell_pt(page, x1, y1))
    page.locator("button", has_text="部屋を作成").first.click()
    page.locator(".modal textarea").fill(name)
    page.locator(".modal button.primary").click()

errors = []
with sync_playwright() as pw:
    br = pw.chromium.launch(headless=True, channel="chrome")

    # ---- U1/U2/U3: history entries per drag gesture
    c = ctx(br); page = c.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console:" + m.text) if m.type in ("error", "warning") else None)
    page.goto(URL); page.wait_for_selector("svg.canvas")
    make_room(page, 2, 2, 5, 4, "A")          # 4x3 = 12 cells
    page.mouse.click(*cell_pt(page, 3, 3))     # select
    # east edge handle at x=6 (gridline), y mid (2..5 -> 3.5)
    ox, oy = svg_origin(page)
    drag(page, (ox + 6 * CELL, oy + 3.5 * CELL), (ox + 8 * CELL, oy + 3.5 * CELL))
    d, _ = doc(page)
    print("U1 cells after edge drag +2:", len(d["floors"]["1"]["rooms"][0]["cells"]), "(expect 18)")
    n = undo_count(page)
    print("U1 undo presses until disabled:", n, "(expect 2 = create + reshape)")
    c.close()

    c = ctx(br); page = c.new_page(); page.goto(URL); page.wait_for_selector("svg.canvas")
    page.locator("button", has_text="家具を作成").click()
    drag(page, cell_pt(page, 10, 10), cell_pt(page, 13, 12))
    drag(page, cell_pt(page, 11, 11), cell_pt(page, 15, 11))   # move furniture
    print("U2 furniture create+move, undo presses:", undo_count(page), "(expect 2)")
    c.close()

    # ---- U4: typing a name / U5 settings number input
    c = ctx(br); page = c.new_page(); page.goto(URL); page.wait_for_selector("svg.canvas")
    make_room(page, 2, 2, 5, 4, "A")
    page.mouse.click(*cell_pt(page, 3, 3))
    ta = page.locator(".panel textarea"); ta.click(); ta.press("End"); page.keyboard.type("bcdefghij")
    print("U4 create + type 9 chars, undo presses:", undo_count(page), "(ideal 2)")
    page.locator("button", has_text="設定").click()
    inp = page.locator(".settings-row input").nth(1)
    inp.fill("")
    print("U5 cellMm field after clearing:", repr(inp.input_value()), "doc cellMm:", doc(page)[0]["settings"]["cellMm"])
    inp.fill("9")
    print("U5 typed 9 -> doc cellMm:", doc(page)[0]["settings"]["cellMm"], "(min=100 not enforced?)")
    c.close()

    # ---- U8: Delete key with modal open
    c = ctx(br); page = c.new_page(); page.goto(URL); page.wait_for_selector("svg.canvas")
    make_room(page, 2, 2, 5, 4, "A")
    page.mouse.click(*cell_pt(page, 3, 3))
    page.locator("button", has_text="共有").click()
    page.locator(".modal h3").click()
    page.keyboard.press("Delete")
    print("U8 rooms after Delete while share modal open:", len(doc(page)[0]["floors"]["1"]["rooms"]), "(expect 1)")
    print("U9 share url:", page.locator(".share-url input").input_value()[:40])
    c.close()

    # ---- U6: legacy doc without openings/furniture in localStorage
    c = ctx(br); page = c.new_page()
    errs6 = []
    page.on("pageerror", lambda e: errs6.append(str(e)))
    legacy = {"version": 1, "activePlanId": "p1", "plans": [{"id": "p1", "name": "旧", "doc": {
        "version": 1, "floors": {"1": {"rooms": [{"id": "r", "name": "旧部屋", "typeId": "living", "cells": ["2,2", "3,2"], "z": 1}]}, "2": {"rooms": []}},
        "roomTypes": [{"id": "living", "name": "居室", "color": "#7FB3D5"}], "settings": {"cellMm": 455, "wallMm": 120}}}]}
    page.add_init_script(f"localStorage.setItem('{KEY}', {json.dumps(json.dumps(legacy))})")
    page.goto(URL); page.wait_for_timeout(800)
    print("U6 legacy doc: canvas present =", page.locator("svg.canvas").count(), "root html len =", len(page.inner_html("#root")), "errors:", errs6[:1])
    c.close()

    # ---- U7: import overwrites current plan
    c = ctx(br); page = c.new_page(); page.goto(URL); page.wait_for_selector("svg.canvas")
    make_room(page, 2, 2, 5, 4, "消えたら困る部屋")
    empty = {"version": 1, "floors": {"1": {"rooms": [], "openings": [], "furniture": []}, "2": {"rooms": [], "openings": [], "furniture": []}}, "roomTypes": [], "settings": {"cellMm": 455, "wallMm": 120}}
    page.locator("input[type=file]").set_input_files(files=[{"name": "x.json", "mimeType": "application/json", "buffer": json.dumps(empty).encode()}])
    page.wait_for_timeout(300)
    d, p = doc(page)
    print("U7 after import: plans =", len(p["plans"]), "rooms in active plan =", len(d["floors"]["1"]["rooms"]), "undo enabled =", page.locator("button", has_text="Undo").is_enabled())
    c.close()

    # ---- U10: phone width
    c = ctx(br, 390, 844); page = c.new_page(); page.goto(URL); page.wait_for_selector("svg.canvas")
    cb = page.locator(".center").bounding_box()
    print("U10 390px: .center box =", cb, " header scrollWidth =", page.evaluate("document.querySelector('.app-header').scrollWidth"))
    page.screenshot(path="sp_before.png")
    c.close()
    br.close()
print("console/page errors (U1):", errors[:5])
