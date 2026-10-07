#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ui_lib.py -- 画面E2E（ui_check.py）の部品。
@owns 画面E2Eの共通部品: 検査関数・ブラウザ操作ヘルパー Ui・Env・固定データ・ドア配置の操作

シナリオ本体は ui_scn_*.py（概念ごと）、サーバー起動・実行・結果表示と SCENARIOS の一覧は ui_check.py。
"""


import copy
import json
import re
import subprocess
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import List


ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "shots"

CELL = 22  # px of one grid cell at zoom 100% (BASE_CELL_PX in src/constants.ts)
CELL_MM = 455  # default mm per cell
PROJECT_KEY = "madori-simulator-project-v1"
OLD_DOC_KEY = "madori-simulator-doc-v1"
BACKUP_KEY = PROJECT_KEY + ".backup-prev"
CORRUPT_PREFIX = PROJECT_KEY + ".corrupt-"


class InfraError(Exception):
    """Server / browser could not be started: exit code 2 (not a scenario failure)."""


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def check_infra(cond, msg):
    if not cond:
        raise InfraError(msg)


def public_app_url():
    """PUBLIC_APP_URL of src/constants.ts: the one line that holds the published address (and so the production base path)."""
    m = re.search(r"PUBLIC_APP_URL\s*=\s*'([^']+)'", (ROOT / "src" / "constants.ts").read_text(encoding="utf-8"))
    check_infra(m is not None, "src/constants.ts に PUBLIC_APP_URL が見つかりません")
    return m.group(1)


def app_base_path():
    """The base path the production build is served under ('/MadoriSimulator/'): vite.config.ts takes it from the same line."""
    return urllib.parse.urlparse(public_app_url()).path


# --------------------------------------------------------------------------- browser helpers
class Ui:
    """One browser page (own context = own empty localStorage) with the helpers the scenarios share."""

    def __init__(self, env, width, height, touch=False):
        self.env = env
        self.ctx = env.browser.new_context(
            viewport={"width": width, "height": height},
            has_touch=touch,  # a touch screen: real finger input is sent with touch_start/move/end below
            is_mobile=touch,
            device_scale_factor=1,
            color_scheme="light",
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            reduced_motion="reduce",
        )
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(15000)
        self.errors: List[str] = []  # page errors + console errors: any of them fails the scenario
        self.notes: List[str] = []  # console warnings etc. (reported, not failing)
        self.dialogs: List[str] = []  # messages of every alert / confirm / prompt that appeared
        self.prompt_answers: List[str] = []  # answers for the next window.prompt() calls (empty: accept its default text)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        self.page.on("console", self._on_console)
        self.page.on("dialog", self._on_dialog)

    def _on_console(self, m):
        url = (m.location or {}).get("url", "") if hasattr(m, "location") else ""
        if m.type == "error":
            if "favicon" in url or "favicon" in m.text:
                return  # the app has no favicon; the browser asks for it anyway
            self.errors.append(f"console.error: {m.text[:300]}")
        elif m.type == "warning":
            self.notes.append(f"console.warning: {m.text[:200]}")

    def _on_dialog(self, d):
        self.dialogs.append(d.message)
        try:
            if d.type == "prompt" and self.prompt_answers:
                d.accept(self.prompt_answers.pop(0))
            else:
                d.accept()
        except Exception:
            pass  # the page was closed while the dialog was open

    def touch(self, kind, fingers):
        """Raw touch input through CDP (Playwright's own touchscreen can only tap with one finger).
        kind: touchStart / touchMove / touchEnd. fingers: {id: (x, y)} of the fingers that are down AFTER this event."""
        if getattr(self, "_cdp", None) is None:
            self._cdp = self.ctx.new_cdp_session(self.page)
        points = [{"x": x, "y": y, "id": i} for i, (x, y) in fingers.items()]
        self._cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

    def another_tab(self):
        """A second page in the SAME browser context (same origin, same localStorage): what a second tab of the app is.
        It has its own page; errors / notes / dialogs go to the same lists as this one's."""
        page = self.ctx.new_page()
        page.set_default_timeout(15000)
        page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        page.on("console", self._on_console)
        page.on("dialog", self._on_dialog)
        other = copy.copy(self)
        other.page = page
        return other

    # ---- navigation
    def open(self, suffix=""):
        self.page.goto(self.env.url + suffix, wait_until="load")
        self.wait_canvas()

    def reload(self):
        self.page.reload(wait_until="load")
        self.wait_canvas()

    def wait_canvas(self):
        self.page.wait_for_selector("svg.canvas", state="visible")

    # ---- geometry (zoom 100%): cell (cx,cy) centre / grid line (gx,gy) in page pixels
    def origin(self):
        b = self.page.locator("svg.canvas").bounding_box()
        return b["x"], b["y"]

    def pt(self, cx, cy, fx=0.5, fy=0.5):
        ox, oy = self.origin()
        return ox + (cx + fx) * CELL, oy + (cy + fy) * CELL

    def grid(self, gx, gy):
        ox, oy = self.origin()
        return ox + gx * CELL, oy + gy * CELL

    def drag(self, a, b, steps=6):
        m = self.page.mouse
        m.move(*a)
        m.down()
        m.move(*b, steps=steps)
        m.up()

    # ---- storage / document
    def storage(self, key):
        return self.page.evaluate("k => localStorage.getItem(k)", key)

    def set_storage(self, key, value):
        self.page.evaluate("([k, v]) => localStorage.setItem(k, v)", [key, value])

    def storage_keys(self):
        return self.page.evaluate("() => Object.keys(localStorage)")

    def project(self):
        return json.loads(self.storage(PROJECT_KEY))

    def doc(self):
        p = self.project()
        return next(pl for pl in p["plans"] if pl["id"] == p["activePlanId"])["doc"]

    def floor(self, n=1):
        return self.doc()["floors"][str(n)]

    def room(self, name, n=1):
        return next(r for r in self.floor(n)["rooms"] if r["name"] == name)

    def wait_until(self, fn, what, timeout=4.0):
        """Poll until fn() is truthy (autosave runs in an effect, a little after the event)."""
        end = time.time() + timeout
        last = None
        while time.time() < end:
            try:
                last = fn()
                if last:
                    return last
            except Exception as e:  # storage still empty, etc.
                last = f"{type(e).__name__}: {e}"
            self.page.wait_for_timeout(50)  # not time.sleep: only Playwright calls let page events (dialogs) be handled
        raise AssertionError(f"待っても成立しませんでした: {what}（最後の値: {last}）")

    # ---- UI parts
    def canvas_text(self):
        return self.page.locator("svg.canvas").text_content() or ""

    def tab_names(self):
        return [t.strip() for t in self.page.locator(".plan-tab .plan-tab-name").all_text_contents()]

    def active_tab(self):
        return (self.page.locator(".plan-tab.active .plan-tab-name").text_content() or "").strip()

    def undo_all(self):
        """Press Undo until it is disabled; returns how many presses it took."""
        btn = self.page.locator("button", has_text="Undo")
        n = 0
        while btn.is_enabled() and n < 300:
            btn.click()
            n += 1
        return n

    def make_room(self, x0, y0, x1, y1, name="R", wait_saved=True, type_name=None):
        self.drag(self.pt(x0, y0), self.pt(x1, y1))
        self.page.locator("button", has_text="部屋を作成").first.click()
        self.page.locator(".modal textarea").fill(name)
        if type_name:
            self.page.locator(".modal select").select_option(label=type_name)
        self.page.locator(".modal button.primary").click()
        if wait_saved:
            self.wait_until(lambda: any(r["name"] == name for r in self.floor()["rooms"]), f"部屋 {name} の保存")

    def select_room_at(self, cx, cy):
        self.page.mouse.click(*self.pt(cx, cy))

    def key(self, name):
        self.page.keyboard.press(name)

    def settle(self, ms=300):
        """Give React and the autosave effect time to act, for checks that something did NOT happen."""
        self.page.wait_for_timeout(ms)

    def zoom_pct(self):
        """The zoom shown in the header (100 at the start)."""
        return int((self.page.locator(".zoom span").text_content() or "0").strip().rstrip("%"))

    def center_box(self):
        """Bounding box (page pixels) of the scrolled area that holds the canvas."""
        return self.page.locator(".center").bounding_box()

    def scroll_pos(self):
        return self.page.evaluate("() => { const c = document.querySelector('.center'); return [c.scrollLeft, c.scrollTop]; }")

    def room_px_box(self, x0, y0, x1, y1):
        """Page-pixel box of the cells x0..x1 / y0..y1 (inclusive) at the zoom that is on screen now."""
        ox, oy = self.origin()
        cell = CELL * self.zoom_pct() / 100
        return ox + x0 * cell, oy + y0 * cell, ox + (x1 + 1) * cell, oy + (y1 + 1) * cell

    def scroll_body_to(self, top):
        """Scroll the page body (the single column of a phone: canvas, toolbar, panels) to `top`; 'end' for the bottom."""
        self.page.evaluate("t => { const b = document.querySelector('.body'); b.scrollTop = t === 'end' ? b.scrollHeight : t; }", top)

    def scroll_canvas_to_end(self):
        self.page.evaluate("() => { const c = document.querySelector('.center'); c.scrollLeft = c.scrollWidth; c.scrollTop = c.scrollHeight; }")

    def import_file(self, filename, text):
        self.page.locator("input[type=file]").set_input_files(
            files=[{"name": filename, "mimeType": "application/json", "buffer": text.encode("utf-8")}]
        )

    def shot(self, name):
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(SHOTS / f"{self.env.target}_{name}.png"))

    def shot_named(self, name, full_page=False):
        """A screenshot kept under exactly `name` (no target prefix: dev and prod write the same picture, the later one stays)."""
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full_page)


@dataclass
class Env:
    browser: object
    url: str
    target: str
    uis: list = None

    def ui(self, width=1280, height=900, touch=False):
        ui = Ui(self, width, height, touch)
        self.uis.append(ui)
        return ui


# --------------------------------------------------------------------------- fixtures
# Old-format documents: no openings / furniture arrays. The first also lacks the 2nd floor, types and settings.
LEGACY_DOC_NO_FLOOR2 = {
    "version": 1,
    "floors": {"1": {"rooms": [{"id": "r", "name": "旧部屋", "typeId": "living", "cells": ["2,2", "3,2"], "z": 1}]}},
}
LEGACY_DOC = {
    "version": 1,
    "floors": {
        "1": {"rooms": [{"id": "r", "name": "旧部屋", "typeId": "living", "cells": ["2,2", "3,2"], "z": 1}]},
        "2": {"rooms": []},
    },
    "roomTypes": [{"id": "living", "name": "居室", "color": "#7FB3D5"}],
    "settings": {"cellMm": 455, "wallMm": 120},
}
EMPTY_DOC = {
    "version": 1,
    "floors": {"1": {"rooms": [], "openings": [], "furniture": []}, "2": {"rooms": [], "openings": [], "furniture": []}},
    "roomTypes": [],
    "settings": {"cellMm": 455, "wallMm": 120},
}


def legacy_project(doc):
    return {"version": 1, "activePlanId": "p1", "plans": [{"id": "p1", "name": "旧", "doc": doc}]}


def lz_compress(text):
    """lz-string compressToEncodedURIComponent, computed by the copy of the library installed in this project (node)."""
    code = "const LZ=require('lz-string');process.stdout.write(LZ.compressToEncodedURIComponent(require('fs').readFileSync(0,'utf8')))"
    r = subprocess.run(["node", "-e", code], input=text.encode("utf-8"), cwd=ROOT, capture_output=True)
    check_infra(r.returncode == 0, "node で lz-string を呼べません: " + r.stderr.decode("utf-8", "replace")[:200])
    return r.stdout.decode("utf-8")


def count_color(png, rgb, tol=4):
    """How many pixels of a PNG (path or bytes) are within `tol` of `rgb` in every channel."""
    try:
        import io

        import numpy
        from PIL import Image
    except ImportError as e:
        raise InfraError("画面の色の検査には pillow と numpy が要ります: " + str(e))
    im = Image.open(io.BytesIO(png) if isinstance(png, (bytes, bytearray)) else png).convert("RGB")
    arr = numpy.asarray(im).astype(int)
    return int((abs(arr - numpy.array(rgb)).max(axis=2) <= tol).sum())


def pdf_pages(pdf_bytes, dpi=110):
    """(page texts, page PNGs as bytes) of a PDF, rendered by PyMuPDF."""
    try:
        import fitz
    except ImportError as e:
        raise InfraError("PDF の検査には pymupdf が要ります: " + str(e))
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    return [p.get_text() for p in doc], [p.get_pixmap(dpi=dpi).tobytes("png") for p in doc]


def cell_xy(c):
    x, y = c.split(",")
    return int(x), int(y)


def no_overlap(doc):
    cells = [c for r in doc["floors"]["1"]["rooms"] for c in r["cells"]]
    return len(cells) == len(set(cells))


def two_rooms(ui):
    ui.make_room(2, 2, 4, 4, "A")
    ui.make_room(6, 2, 8, 4, "B")


def move_a_over_b(ui):
    """In move mode drag A two cells to the right so it covers a column of B: the document holds overlapping rooms until move mode is left."""
    ui.page.locator("button.mode-btn", has_text="移動").click()
    ui.drag(ui.pt(3, 3), ui.pt(5, 3))
    ui.wait_until(lambda: not no_overlap(ui.doc()), "A を B に重ねる")


def add_door_at(ui, room_cell, gx, gy, total):
    """Add a door (first width) through the context menu of the room covering room_cell; it snaps to the wall edge nearest grid point (gx, gy)."""
    ui.page.mouse.click(*ui.pt(*room_cell), button="right")
    ui.page.locator(".context-menu button", has_text="ドア").click()
    ui.page.locator(".size-grid button").first.click()
    x, y = ui.grid(gx, gy)
    ui.page.mouse.move(x, y + 2)
    ui.page.mouse.click(x, y + 2)
    ui.wait_until(lambda: len(ui.floor()["openings"]) == total, "ドアの追加")
    return ui.floor()["openings"][-1]


def place_door(ui):
    """Add a door on the top wall of cell (4,2) from the context menu of the room that covers cell (3,3)."""
    ui.page.mouse.click(*ui.pt(3, 3), button="right")
    ui.page.locator(".context-menu button", has_text="ドア").click()
    ui.page.locator(".size-grid button").first.click()
    x, y = ui.grid(4.5, 2)
    ui.page.mouse.move(x, y + 2)
    ui.page.mouse.click(x, y + 2)
    ui.wait_until(lambda: len(ui.floor()["openings"]) == 1, "ドアの追加")
    return ui.floor()["openings"][0]
