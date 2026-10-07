# -*- coding: utf-8 -*-
import json, sys
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, ".")
URL = "http://localhost:5173/"; CELL = 22; KEY = "madori-simulator-project-v1"
def origin(page):
    b = page.locator("svg.canvas").bounding_box(); return b["x"], b["y"]
def pt(page, cx, cy):
    ox, oy = origin(page); return ox + (cx + .5) * CELL, oy + (cy + .5) * CELL
def drag(page, a, b, steps=6):
    page.mouse.move(*a); page.mouse.down(); page.mouse.move(*b, steps=steps); page.mouse.up()
def doc(page):
    p = json.loads(page.evaluate(f"localStorage.getItem('{KEY}')"))
    return next(pl for pl in p["plans"] if pl["id"] == p["activePlanId"])["doc"]
def undo_count(page):
    n = 0; btn = page.locator("button", has_text="Undo")
    while btn.is_enabled() and n < 300: btn.click(); n += 1
    return n
with sync_playwright() as pw:
    br = pw.chromium.launch(headless=True, channel="chrome")
    page = br.new_context(viewport={"width":1280,"height":900}).new_page()
    page.goto(URL); page.wait_for_selector("svg.canvas")
    page.locator("button", has_text="家具を作成").click()
    drag(page, pt(page, 10, 10), pt(page, 13, 12))
    print("after create:", doc(page)["floors"]["1"]["furniture"])
    drag(page, pt(page, 11, 11), pt(page, 15, 11))
    print("after move  :", doc(page)["floors"]["1"]["furniture"])
    # resize via corner handle (bottom-right)
    f = doc(page)["floors"]["1"]["furniture"][0]
    ox, oy = origin(page); k = CELL / 455
    drag(page, (ox + (f["x"] + f["w"]) * k, oy + (f["y"] + f["h"]) * k), (ox + (f["x"] + f["w"]) * k + 44, oy + (f["y"] + f["h"]) * k + 22))
    print("after resize:", doc(page)["floors"]["1"]["furniture"])
    print("undo presses:", undo_count(page), "(expect 3)")

    # opening: add via context menu, then drag it, count undo
    page2 = br.new_context(viewport={"width":1280,"height":900}).new_page()
    page2.goto(URL); page2.wait_for_selector("svg.canvas")
    drag(page2, pt(page2, 2, 2), pt(page2, 7, 6))
    page2.locator("button", has_text="部屋を作成").first.click(); page2.locator(".modal button.primary").click()
    page2.mouse.click(*pt(page2, 3, 3), button="right")
    page2.locator(".context-menu button", has_text="ドア").click()
    page2.locator(".size-grid button").first.click()
    ox, oy = origin(page2)
    page2.mouse.move(ox + 4.5 * CELL, oy + 2 * CELL + 2); page2.mouse.click(ox + 4.5 * CELL, oy + 2 * CELL + 2)
    print("openings:", doc(page2)["floors"]["1"]["openings"])
    drag(page2, (ox + 4.5 * CELL, oy + 2 * CELL), (ox + 6.5 * CELL, oy + 2 * CELL))
    print("openings after drag:", doc(page2)["floors"]["1"]["openings"])
    print("undo presses:", undo_count(page2), "(expect 3 = room + door + drag)")
    # move mode: drag room beyond left edge, preview + result
    page3 = br.new_context(viewport={"width":1280,"height":900}).new_page()
    page3.goto(URL); page3.wait_for_selector("svg.canvas")
    drag(page3, pt(page3, 1, 1), pt(page3, 4, 3))
    page3.locator("button", has_text="部屋を作成").first.click(); page3.locator(".modal button.primary").click()
    page3.locator("button.mode-btn", has_text="移動").click()
    drag(page3, pt(page3, 3, 2), pt(page3, 0, 2))
    print("cells after move toward edge:", len(doc(page3)["floors"]["1"]["rooms"][0]["cells"]), "(expect 12)")
    br.close()
