#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ui_check.py -- 間取りシミュレーターの画面E2E（ヘッドレス Playwright）。

  python scripts/ui_check.py                 # dev と prod の両方（既定）
  python scripts/ui_check.py --target dev    # vite の開発サーバーだけ（StrictMode が効く）
  python scripts/ui_check.py --target prod   # npm run build 済みの dist を vite preview で（先にビルドしておく）
  python scripts/ui_check.py --only edge     # 名前に edge を含むシナリオだけ
  python scripts/ui_check.py --list          # シナリオ一覧

サーバーはこのスクリプトが自分で起動し、終了時（失敗・Ctrl+C でも）必ず止める。手で起動した物は使わない。
  dev : npx vite --port 4178 --strictPort（env PORT=4178 で自動オープンを抑止）  -> http://localhost:4178/
  prod: npx vite preview --port 4179 --strictPort --base /MadoriSimulator/       -> http://localhost:4179/MadoriSimulator/
ブラウザの起動条件は C:/Claude/101_KaihatsuHyoujun/shiken/tools/browser_check.py と同じ
（headless・channel="chrome"・1280x900・ja-JP・Asia/Tokyo・light・reduced motion）。失敗しても別経路へは落とさない。
シナリオは末尾の SCENARIOS に1か所で並べる。各シナリオは check() で落ちる（失敗は xfail にせずそのまま報告する）。
出力: docs/shots/<target>_<シナリオ>.png と、標準出力の結果一覧。終了コード 0=全部成功 / 1=失敗あり / 2=起動・環境エラー。
"""
import argparse
import atexit
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "shots"

CELL = 22  # px of one grid cell at zoom 100% (BASE_CELL_PX in src/constants.ts)
CELL_MM = 455  # default mm per cell
PROJECT_KEY = "madori-simulator-project-v1"
OLD_DOC_KEY = "madori-simulator-doc-v1"
BACKUP_KEY = PROJECT_KEY + ".backup-prev"
CORRUPT_PREFIX = PROJECT_KEY + ".corrupt-"

NPX = shutil.which("npx.cmd") or shutil.which("npx") or "npx"
TARGETS = {
    "dev": dict(port=4178, path="/", cmd=["vite", "--port", "4178", "--strictPort"], env={"PORT": "4178"}),
    # vite.config.ts gives the production build the base /MadoriSimulator/ only for "build"; preview must be told the same base
    "prod": dict(port=4179, path="/MadoriSimulator/", cmd=["vite", "preview", "--port", "4179", "--strictPort", "--base", "/MadoriSimulator/"], env={}),
}


class InfraError(Exception):
    """Server / browser could not be started: exit code 2 (not a scenario failure)."""


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


# --------------------------------------------------------------------------- servers
def port_open(port):
    try:
        with socket.create_connection(("localhost", port), timeout=0.5):
            return True
    except OSError:
        return False


class Server:
    def __init__(self, name):
        t = TARGETS[name]
        self.name, self.port, self.path = name, t["port"], t["path"]
        self.cmd = [NPX, *t["cmd"]]
        self.env = {**os.environ, **t["env"]}
        self.proc = None
        self.log_path = None
        self.leaked = False

    @property
    def url(self):
        return f"http://localhost:{self.port}{self.path}"

    def log_tail(self, n=15):
        try:
            return "".join(Path(self.log_path).read_text(encoding="utf-8", errors="replace").splitlines(True)[-n:])
        except Exception:
            return ""

    def start(self):
        if self.name == "prod":
            dist = ROOT / "dist" / "index.html"
            check_dist(dist)
        if port_open(self.port):
            raise InfraError(f"ポート {self.port} が既に使われています（前回の残骸かもしれません）。止めてから再実行してください。")
        fd, self.log_path = tempfile.mkstemp(prefix=f"ui_check_{self.name}_", suffix=".log")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        self.proc = subprocess.Popen(self.cmd, cwd=ROOT, env=self.env, stdout=fd, stderr=subprocess.STDOUT, creationflags=flags)
        os.close(fd)
        deadline = time.time() + 90
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise InfraError(f"{self.name} サーバーが起動直後に終了しました:\n{self.log_tail()}")
            try:
                with urllib.request.urlopen(self.url, timeout=2) as r:
                    if r.status == 200:
                        self.probe_assets()
                        return
            except InfraError:
                raise
            except Exception:
                time.sleep(0.5)
        raise InfraError(f"{self.name} サーバーが 90 秒以内に応答しませんでした:\n{self.log_tail()}")

    def probe_assets(self):
        """The served page must reference a script that really is JavaScript (a wrong base path serves HTML for it)."""
        import re

        with urllib.request.urlopen(self.url, timeout=5) as r:
            html = r.read().decode("utf-8", "replace")
        m = re.search(r'<script[^>]+type="module"[^>]+src="([^"]+)"', html)
        check_infra(m is not None, f"{self.name}: index.html に module script が見つかりません")
        src = m.group(1)
        asset = src if src.startswith("http") else f"http://localhost:{self.port}{src}"
        with urllib.request.urlopen(asset, timeout=10) as r:
            ctype = r.headers.get("content-type", "")
            head = r.read(200).decode("utf-8", "replace").lstrip().lower()
        check_infra("javascript" in ctype or "ecmascript" in ctype, f"{self.name}: {src} が JavaScript で返りません（content-type={ctype}）。base パスを確認")
        check_infra(not head.startswith("<!doctype") and not head.startswith("<html"), f"{self.name}: {src} が HTML で返っています")

    def stop(self):
        p, self.proc = self.proc, None
        if p is not None:
            try:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
                else:
                    p.terminate()
                p.wait(timeout=15)
            except Exception:
                pass
            for _ in range(50):
                if not port_open(self.port):
                    break
                time.sleep(0.2)
            else:
                self.leaked = True
                print(f"WARNING: ポート {self.port} がまだ開いています（{self.name} サーバーを止め切れていません）", file=sys.stderr)
        if self.log_path:
            try:
                os.remove(self.log_path)
            except Exception:
                pass
            self.log_path = None


def check_infra(cond, msg):
    if not cond:
        raise InfraError(msg)


def check_dist(dist_index: Path):
    check_infra(dist_index.exists(), "dist/ がありません。先に npm run build を実行してください。")
    built = dist_index.stat().st_mtime
    sources = [p for p in (ROOT / "src").rglob("*") if p.is_file() and ".test." not in p.name]  # tests are not in the bundle
    newest = max((p.stat().st_mtime for p in sources), default=0)
    newest = max(newest, (ROOT / "index.html").stat().st_mtime, (ROOT / "vite.config.ts").stat().st_mtime)
    check_infra(built >= newest, "dist/ が src より古いです（古いビルドを検証してしまいます）。先に npm run build を実行してください。")


# --------------------------------------------------------------------------- browser helpers
class Ui:
    """One browser page (own context = own empty localStorage) with the helpers the scenarios share."""

    def __init__(self, env, width, height):
        self.env = env
        self.ctx = env.browser.new_context(
            viewport={"width": width, "height": height},
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
        self.dialogs: List[str] = []
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
            d.accept()
        except Exception:
            pass  # the page was closed while the dialog was open

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

    def make_room(self, x0, y0, x1, y1, name="R", wait_saved=True):
        self.drag(self.pt(x0, y0), self.pt(x1, y1))
        self.page.locator("button", has_text="部屋を作成").first.click()
        self.page.locator(".modal textarea").fill(name)
        self.page.locator(".modal button.primary").click()
        if wait_saved:
            self.wait_until(lambda: any(r["name"] == name for r in self.floor()["rooms"]), f"部屋 {name} の保存")

    def select_room_at(self, cx, cy):
        self.page.mouse.click(*self.pt(cx, cy))

    def import_file(self, filename, text):
        self.page.locator("input[type=file]").set_input_files(
            files=[{"name": filename, "mimeType": "application/json", "buffer": text.encode("utf-8")}]
        )

    def shot(self, name):
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(SHOTS / f"{self.env.target}_{name}.png"))


@dataclass
class Env:
    browser: object
    url: str
    target: str
    uis: list = None

    def ui(self, width=1280, height=900):
        ui = Ui(self, width, height)
        self.uis.append(ui)
        return ui


@dataclass
class Scenario:
    name: str
    bug: str  # finding id in docs/KANSA_20260928.md ("-" when it is a general check)
    fn: Callable
    note: str = ""


@dataclass
class Result:
    target: str
    name: str
    bug: str
    status: str  # PASS / FAIL / ERROR
    detail: str
    seconds: float
    notes: list


def run_scenario(env: Env, sc: Scenario) -> Result:
    env.uis = []
    t0 = time.time()
    status, detail = "PASS", ""
    try:
        sc.fn(env)
        for ui in env.uis:
            if ui.errors:
                raise AssertionError("ブラウザのエラー: " + " | ".join(ui.errors[:3]))
    except AssertionError as e:
        status, detail = "FAIL", str(e) or "assertion failed"
    except Exception as e:
        status, detail = "ERROR", f"{type(e).__name__}: {str(e)[:400]}"
    notes = []
    for i, ui in enumerate(env.uis):
        notes += ui.notes
        try:
            ui.shot(sc.name + ("" if i == 0 else f"_{i + 1}"))
        except Exception:
            pass
        try:
            ui.ctx.close()
        except Exception:
            pass
    return Result(env.target, sc.name, sc.bug, status, detail, time.time() - t0, notes)


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


# --------------------------------------------------------------------------- scenarios: stored data and entrances (B1 B2)
def sc_legacy_project_boots(env):
    """Old-format stored project (no openings, no 2nd floor) must start, and its raw text is kept in backup-prev."""
    ui = env.ui()
    ui.open()
    raw = json.dumps(legacy_project(LEGACY_DOC_NO_FLOOR2), ensure_ascii=False)
    ui.set_storage(PROJECT_KEY, raw)
    ui.reload()
    check(ui.page.locator("svg.canvas").count() == 1, "旧形式の保存データで画面が出ない（真っ白）")
    check("旧部屋" in ui.canvas_text(), "旧形式の部屋が表示されない")
    check(ui.storage(BACKUP_KEY) == raw, "読み込み前の生データが backup-prev に残っていない")
    ui.page.locator(".floor-tab", has_text="2階").click()
    ui.wait_canvas()
    ui.page.locator(".floor-tab", has_text="1階").click()
    ui.wait_until(lambda: "2" in ui.doc()["floors"] and ui.doc()["floors"]["1"]["openings"] == [], "補完した文書の保存")


def sc_old_doc_key_migrates(env):
    """The single-document key of the first version is still migrated."""
    ui = env.ui()
    ui.open()
    ui.page.evaluate(
        "([old, doc, proj]) => { localStorage.removeItem(proj); localStorage.setItem(old, doc); }",
        [OLD_DOC_KEY, json.dumps(LEGACY_DOC, ensure_ascii=False), PROJECT_KEY],
    )
    ui.reload()
    check(ui.tab_names() == ["間取り 1"], f"旧キーから1つの間取りになるはず: {ui.tab_names()}")
    check("旧部屋" in ui.canvas_text(), "旧キーの部屋が表示されない")


def sc_corrupt_storage_set_aside(env):
    """Unreadable stored data: start with a new project, keep the raw text under corrupt-<time> (not overwritten)."""
    ui = env.ui()
    ui.open()
    ui.set_storage(PROJECT_KEY, "{broken")
    ui.reload()
    check(ui.page.locator("svg.canvas").count() == 1, "壊れた保存データで画面が出ない")
    keys = [k for k in ui.storage_keys() if k.startswith(CORRUPT_PREFIX)]
    check(len(keys) == 1, f"壊れたデータの退避キーがちょうど1つあるはず: {keys}")
    check(ui.storage(keys[0]) == "{broken", "退避したデータが元の文字列と違う")
    ui.wait_until(lambda: len(ui.project()["plans"]) == 1, "新しいプロジェクトの保存")
    ui.reload()  # reload again: still exactly one copy
    keys = [k for k in ui.storage_keys() if k.startswith(CORRUPT_PREFIX)]
    check(len(keys) == 1, f"2回目の起動で退避が増えた: {keys}")


def sc_share_link_legacy_doc(env):
    """A share link carrying an old-format document opens as a new tab (third entrance of a Doc)."""
    enc = lz_compress(json.dumps({"n": "旧い共有", "d": LEGACY_DOC_NO_FLOOR2}, ensure_ascii=False))
    ui = env.ui()
    ui.open("#p=" + enc)
    ui.wait_until(lambda: ui.tab_names() == ["間取り 1", "旧い共有"], "共有リンクの間取りがタブに追加される")
    check("旧部屋" in ui.canvas_text(), "共有リンクの部屋が表示されない")
    check(ui.page.evaluate("location.hash") == "", "取り込み後も URL に #p= が残っている")


def sc_import_adds_tab_keeps_room(env):
    """Importing a file adds a tab and selects it; the plan being edited keeps its room (it used to be replaced)."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "消えたら困る部屋")
    ui.import_file("取込.json", json.dumps(EMPTY_DOC))
    ui.wait_until(lambda: ui.tab_names() == ["間取り 1", "取込"], "インポートで新しいタブが増える")
    check(ui.active_tab() == "取込", f"取り込んだタブが選ばれていない: {ui.active_tab()}")
    check(ui.page.locator(".room-label").count() == 0, "新しいタブに前の部屋が残っている")
    ui.page.locator(".plan-tab", has_text="間取り 1").click()
    check("消えたら困る部屋" in ui.canvas_text(), "元のタブの部屋が消えた")
    names = [r["name"] for pl in ui.project()["plans"] for r in pl["doc"]["floors"]["1"]["rooms"]]
    check(names == ["消えたら困る部屋"], f"保存データの部屋: {names}")


def sc_import_project_file_adds_all_plans(env):
    """A whole-project file adds all its plans as tabs (new ids) and selects the first of them."""

    def doc_with(name):
        d = json.loads(json.dumps(EMPTY_DOC))
        d["floors"]["1"]["rooms"].append({"id": "x", "name": name, "typeId": "living", "cells": ["1,1", "2,1"], "z": 1})
        return d

    proj = {
        "version": 1,
        "activePlanId": "b",
        "plans": [{"id": "a", "name": "A案", "doc": doc_with("Aの部屋")}, {"id": "b", "name": "B案", "doc": doc_with("Bの部屋")}],
    }
    ui = env.ui()
    ui.open()
    ui.import_file("backup.json", json.dumps(proj, ensure_ascii=False))
    ui.wait_until(lambda: ui.tab_names() == ["間取り 1", "A案", "B案"], "プロジェクトファイルの全間取りがタブに追加される")
    check(ui.active_tab() == "A案", f"最初に追加した間取りが選ばれるはず: {ui.active_tab()}")
    check("Aの部屋" in ui.canvas_text(), "A案の部屋が表示されない")
    ids = [pl["id"] for pl in ui.project()["plans"]]
    check(len(set(ids)) == 3 and "a" not in ids and "b" not in ids, f"id は新規採番のはず: {ids}")


def sc_import_legacy_and_bad_file(env):
    """An old-format Doc file imports; a file that is not a document only shows the alert and changes nothing."""
    ui = env.ui()
    ui.open()
    ui.import_file("old.json", json.dumps(LEGACY_DOC_NO_FLOOR2, ensure_ascii=False))
    ui.wait_until(lambda: ui.tab_names() == ["間取り 1", "old"], "旧形式ファイルの取り込み")
    check("旧部屋" in ui.canvas_text(), "旧形式ファイルの部屋が表示されない")
    ui.import_file("bad.json", "not json at all")
    ui.wait_until(lambda: ui.dialogs, "失敗のアラート")
    check("読み込みに失敗" in ui.dialogs[-1], f"アラートの文言: {ui.dialogs}")
    check(ui.tab_names() == ["間取り 1", "old"], f"失敗したのにタブが変わった: {ui.tab_names()}")


def sc_save_failure_shows_banner(env):
    """When the browser refuses to save, a red banner tells the user; it goes away after a successful save."""
    ui = env.ui()
    ui.ctx.add_init_script(
        "(() => { const orig = Storage.prototype.setItem; window.__failSave = false;"
        " Storage.prototype.setItem = function (k, v) {"
        " if (window.__failSave && String(k) === 'madori-simulator-project-v1') throw new DOMException('quota', 'QuotaExceededError');"
        " return orig.call(this, k, v); }; })();"
    )
    ui.open()
    check(ui.page.locator(".save-error").count() == 0, "保存できている時に赤い帯が出ている")
    ui.page.evaluate("window.__failSave = true")
    ui.make_room(2, 2, 5, 4, "A", wait_saved=False)
    ui.wait_until(lambda: ui.page.locator(".save-error").count() == 1, "保存失敗の赤い帯")
    check("保存に失敗しました" in ui.page.locator(".save-error").text_content(), "赤い帯の文言")
    ui.shot("save_failure_banner")  # the banner while the save is failing
    ui.page.evaluate("window.__failSave = false")
    ui.make_room(8, 2, 10, 4, "B", wait_saved=False)
    ui.wait_until(lambda: ui.page.locator(".save-error").count() == 0, "保存が通ったら赤い帯が消える")
    ui.wait_until(lambda: len(ui.floor()["rooms"]) == 2, "復帰後の保存")


# --------------------------------------------------------------------------- scenarios: drags (B3 B4 B5)
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


def sc_edge_drag_undo_count(env):
    """Dragging an edge handle is ONE history entry (create + reshape = 2). StrictMode used to make it 2 per drag."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "A")  # 4 x 3 = 12 cells
    ui.select_room_at(3, 3)
    ui.drag(ui.grid(6, 3.5), ui.grid(8, 3.5))  # east edge handle, 2 columns outward
    ui.wait_until(lambda: len(ui.floor()["rooms"][0]["cells"]) == 18, "辺ドラッグで 18 マスになる")
    n = ui.undo_all()
    check(n == 2, f"Undo は 2 回（作成+変形）で空になるはず: {n} 回")


def sc_corner_drag_undo_count(env):
    """Same for the corner handle of a rectangle."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "A")
    ui.select_room_at(3, 3)
    ui.drag(ui.grid(6, 5), ui.pt(7, 5))  # bottom-right corner handle -> corner cell (7,5): 6 x 4 = 24 cells
    ui.wait_until(lambda: len(ui.floor()["rooms"][0]["cells"]) == 24, "角ドラッグで 24 マスになる")
    n = ui.undo_all()
    check(n == 2, f"Undo は 2 回（作成+変形）で空になるはず: {n} 回")


def sc_opening_drag_undo_count(env):
    """Dragging a door along the wall moves it and is ONE history entry (room + door + drag = 3)."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 7, 6, "A")
    door = place_door(ui)
    check((door["cx"], door["cy"], door["side"]) == (4, 2, "N"), f"ドアの位置: {door}")
    ui.drag(ui.grid(4.5, 2), ui.grid(6.5, 2))
    ui.wait_until(lambda: ui.floor()["openings"][0]["cx"] == 6, "ドアを右へドラッグして移動")
    n = ui.undo_all()
    check(n == 3, f"Undo は 3 回（部屋+ドア+移動）で空になるはず: {n} 回")


def sc_furniture_move_resize_applied(env):
    """Furniture move / resize released right after the last move must still be applied (it was dropped before)."""
    ui = env.ui()
    ui.open()
    ui.page.locator("button", has_text="家具を作成").click()
    ui.drag(ui.pt(10, 10), ui.pt(13, 12))
    f0 = ui.wait_until(lambda: ui.floor()["furniture"][0], "家具の作成")

    ui.drag(ui.pt(11, 11), ui.pt(15, 11))  # move 4 cells right, released at once
    f1 = ui.wait_until(lambda: (lambda f: f if abs(f["x"] - f0["x"]) > 1 else None)(ui.floor()["furniture"][0]), "家具の移動が保存される")
    check(abs((f1["x"] - f0["x"]) - 4 * CELL_MM) < 2 and abs(f1["y"] - f0["y"]) < 1, f"移動量が違う: {f0} -> {f1}")

    ui.drag(ui.pt(15, 11), ui.pt(15, 13), steps=1)  # one single pointer move, then released
    f2 = ui.wait_until(lambda: (lambda f: f if abs(f["y"] - f1["y"]) > 1 else None)(ui.floor()["furniture"][0]), "1回だけ動かして離した移動が保存される")
    check(abs((f2["y"] - f1["y"]) - 2 * CELL_MM) < 2, f"1回の移動量が違う: {f1} -> {f2}")

    ox, oy = ui.origin()
    k = CELL / CELL_MM
    hx, hy = ox + (f2["x"] + f2["w"]) * k, oy + (f2["y"] + f2["h"]) * k  # bottom-right resize handle
    ui.drag((hx, hy), (hx + 44, hy + 22))
    f3 = ui.wait_until(lambda: (lambda f: f if abs(f["w"] - f2["w"]) > 1 else None)(ui.floor()["furniture"][0]), "サイズ変更が保存される")
    check(abs((f3["w"] - f2["w"]) - 2 * CELL_MM) < 2 and abs((f3["h"] - f2["h"]) - CELL_MM) < 2, f"サイズの変化量が違う: {f2} -> {f3}")
    n = ui.undo_all()
    check(n == 4, f"Undo は 4 回（作成+移動+移動+サイズ変更）で空になるはず: {n} 回")


def sc_move_beyond_edge_keeps_shape(env):
    """B3: moving a room past the edge of the grid must keep its shape (12 cells stay 12). Fixed in batch 2."""
    ui = env.ui()
    ui.open()
    ui.make_room(1, 1, 4, 3, "A")  # 4 x 3 = 12 cells at the top-left
    ui.page.locator("button.mode-btn", has_text="移動").click()
    before = sorted(ui.floor()["rooms"][0]["cells"])
    ui.drag(ui.pt(3, 2), ui.pt(0, 2))  # 3 cells to the left, only 1 fits
    cells = ui.wait_until(lambda: (lambda c: c if sorted(c) != before else None)(ui.floor()["rooms"][0]["cells"]), "移動の保存")
    check(len(cells) == 12, f"端の外へ動かすと形が潰れた: {len(cells)} マス（12 マスのはず）")


def sc_reload_keeps_document(env):
    """A document made in the UI (room, door, furniture) comes back identical after a reload (normalizeDoc keeps it)."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 7, 6, "LDK")
    place_door(ui)
    ui.page.locator("button", has_text="家具を作成").click()
    ui.drag(ui.pt(10, 10), ui.pt(13, 12))
    ui.wait_until(lambda: len(ui.floor()["furniture"]) == 1, "家具の保存")
    before = ui.doc()
    ui.reload()
    ui.wait_until(lambda: ui.doc() == before, "再読み込み後に同じ文書になる")


# --------------------------------------------------------------------------- the scenario list (the ONE place to add a scenario)
SCENARIOS = [
    Scenario("legacy_project_boots", "B1", sc_legacy_project_boots),
    Scenario("old_doc_key_migrates", "B1", sc_old_doc_key_migrates),
    Scenario("corrupt_storage_set_aside", "B1", sc_corrupt_storage_set_aside),
    Scenario("share_link_legacy_doc", "B1", sc_share_link_legacy_doc),
    Scenario("import_adds_tab_keeps_room", "B2", sc_import_adds_tab_keeps_room),
    Scenario("import_project_file_adds_all_plans", "B2", sc_import_project_file_adds_all_plans),
    Scenario("import_legacy_and_bad_file", "B1 B2", sc_import_legacy_and_bad_file),
    Scenario("save_failure_shows_banner", "2章", sc_save_failure_shows_banner),
    Scenario("reload_keeps_document", "-", sc_reload_keeps_document),
    Scenario("edge_drag_undo_count", "B5", sc_edge_drag_undo_count),
    Scenario("corner_drag_undo_count", "B5", sc_corner_drag_undo_count),
    Scenario("opening_drag_undo_count", "B5", sc_opening_drag_undo_count),
    Scenario("furniture_move_resize_applied", "B4", sc_furniture_move_resize_applied),
    Scenario("move_beyond_edge_keeps_shape", "B3", sc_move_beyond_edge_keeps_shape, "バッチ2で修正予定（それまでは失敗する）"),
]


# --------------------------------------------------------------------------- main
def print_result(r: Result):
    mark = {"PASS": "PASS ", "FAIL": "FAIL ", "ERROR": "ERROR"}[r.status]
    print(f"[{r.target:<4}] {mark} {r.name} ({r.bug}) {r.seconds:.1f}s")
    if r.status != "PASS":
        for line in r.detail.splitlines()[:4]:
            print(f"         {line}")
    for n in r.notes[:2]:
        print(f"         note: {n}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="間取りシミュレーターの画面E2E（ヘッドレス Playwright）")
    ap.add_argument("--target", choices=["dev", "prod", "both"], default="both")
    ap.add_argument("--only", help="名前にこの文字列を含むシナリオだけ実行")
    ap.add_argument("--list", action="store_true", help="シナリオ一覧を表示して終了")
    args = ap.parse_args(argv)
    scenarios = [s for s in SCENARIOS if not args.only or args.only in s.name]
    if args.list:
        for s in SCENARIOS:
            print(f"{s.name:<38} {s.bug:<6} {s.note}")
        return 0
    if not scenarios:
        print("該当するシナリオがありません", file=sys.stderr)
        return 2
    targets = ["dev", "prod"] if args.target == "both" else [args.target]
    servers = {t: Server(t) for t in targets}
    atexit.register(lambda: [s.stop() for s in servers.values()])
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright が未導入です（pip install playwright && python -m playwright install chrome）", file=sys.stderr)
        return 2

    results: List[Result] = []
    infra: Optional[str] = None
    try:
        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch(headless=True, channel="chrome")
            except Exception as e:
                print(f"ブラウザの起動に失敗しました（channel=chrome）: {e}\n別経路（バンドル版）へは自動で落としません。", file=sys.stderr)
                return 2
            try:
                for t in targets:
                    srv = servers[t]
                    try:
                        srv.start()
                        print(f"--- {t}: {srv.url}")
                        env = Env(browser, srv.url, t, [])
                        for sc in scenarios:
                            r = run_scenario(env, sc)
                            results.append(r)
                            print_result(r)
                    except InfraError as e:
                        infra = f"{t}: {e}"
                        print(f"ERROR(環境) {infra}", file=sys.stderr)
                    finally:
                        srv.stop()
            finally:
                browser.close()
    except KeyboardInterrupt:
        print("中断されました", file=sys.stderr)
        infra = "interrupted"
    finally:
        for s in servers.values():
            s.stop()

    bad = [r for r in results if r.status != "PASS"]
    print("=" * 60)
    for t in targets:
        rs = [r for r in results if r.target == t]
        print(f"{t}: {sum(1 for r in rs if r.status == 'PASS')}/{len(rs)} PASS")
    for r in bad:
        print(f"  NG [{r.target}] {r.name} ({r.bug}): {r.detail.splitlines()[0] if r.detail else ''}")
    leaked = [s.name for s in servers.values() if s.leaked]
    if leaked:
        print(f"サーバーを止め切れていません: {leaked}", file=sys.stderr)
    print(f"スクリーンショット: {SHOTS}")
    if infra or leaked:
        return 2
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
