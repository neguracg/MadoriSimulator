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
        (the base is read from PUBLIC_APP_URL in src/constants.ts, the same line vite.config.ts uses)
ブラウザの起動条件は C:/Claude/101_KaihatsuHyoujun/shiken/tools/browser_check.py と同じ
（headless・channel="chrome"・1280x900・ja-JP・Asia/Tokyo・light・reduced motion）。失敗しても別経路へは落とさない。
シナリオ本体は ui_scn_*.py（概念ごと）、共通部品は ui_lib.py。実行する一覧（SCENARIOS）はこのファイルの1か所。
各シナリオは check() で落ちる（失敗は xfail にせずそのまま報告する）。
出力: docs/shots/<target>_<シナリオ>.png と、標準出力の結果一覧。終了コード 0=全部成功 / 1=失敗あり / 2=起動・環境エラー。
"""
import argparse
import atexit
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

from ui_lib import ROOT, SHOTS, Env, InfraError, app_base_path, check_infra
from ui_scn_canvas import (
    sc_corner_drag_undo_count,
    sc_delete_room_removes_its_door,
    sc_door_follows_edge_drag,
    sc_edge_drag_undo_count,
    sc_furniture_move_resize_applied,
    sc_leave_move_mode_by_duplicate,
    sc_leave_move_mode_by_import,
    sc_leave_move_mode_by_new_tab,
    sc_leave_move_mode_by_tab_switch,
    sc_move_beyond_edge_carries_opening_and_furniture,
    sc_move_beyond_edge_keeps_shape,
    sc_opening_drag_undo_count,
    sc_paste_room_at_edge_keeps_shape,
    sc_reload_keeps_document,
)
from ui_scn_document import (
    sc_corrupt_storage_set_aside,
    sc_import_adds_tab_keeps_room,
    sc_import_legacy_and_bad_file,
    sc_import_project_file_adds_all_plans,
    sc_legacy_project_boots,
    sc_old_doc_key_migrates,
    sc_reload_in_move_mode_settles_overlaps,
    sc_save_failure_shows_banner,
    sc_share_link_legacy_doc,
)
from ui_scn_input import (
    sc_furniture_size_free_input,
    sc_modal_blocks_shortcuts,
    sc_opening_width_validated,
    sc_settings_number_fields,
    sc_typing_is_one_undo_step,
)
from ui_scn_plans import sc_duplicate_plan, sc_file_menu_export_backup_import, sc_share_link_uses_public_base


NPX = shutil.which("npx.cmd") or shutil.which("npx") or "npx"
BASE = app_base_path()  # vite.config.ts gives the production build this base only for "build"; preview must be told the same one
TARGETS = {
    "dev": dict(port=4178, path="/", cmd=["vite", "--port", "4178", "--strictPort"], env={"PORT": "4178"}),
    "prod": dict(port=4179, path=BASE, cmd=["vite", "preview", "--port", "4179", "--strictPort", "--base", BASE], env={}),
}


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


def check_dist(dist_index: Path):
    check_infra(dist_index.exists(), "dist/ がありません。先に npm run build を実行してください。")
    built = dist_index.stat().st_mtime
    sources = [p for p in (ROOT / "src").rglob("*") if p.is_file() and ".test." not in p.name]  # tests are not in the bundle
    newest = max((p.stat().st_mtime for p in sources), default=0)
    newest = max(newest, (ROOT / "index.html").stat().st_mtime, (ROOT / "vite.config.ts").stat().st_mtime)
    check_infra(built >= newest, "dist/ が src より古いです（古いビルドを検証してしまいます）。先に npm run build を実行してください。")


# --------------------------------------------------------------------------- scenarios and results
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
    Scenario("share_link_uses_public_base", "B9", sc_share_link_uses_public_base),
    Scenario("reload_in_move_mode_settles_overlaps", "B12", sc_reload_in_move_mode_settles_overlaps),
    Scenario("reload_keeps_document", "-", sc_reload_keeps_document),
    Scenario("edge_drag_undo_count", "B5", sc_edge_drag_undo_count),
    Scenario("corner_drag_undo_count", "B5", sc_corner_drag_undo_count),
    Scenario("opening_drag_undo_count", "B5", sc_opening_drag_undo_count),
    Scenario("furniture_move_resize_applied", "B4", sc_furniture_move_resize_applied),
    Scenario("move_beyond_edge_keeps_shape", "B3", sc_move_beyond_edge_keeps_shape),
    Scenario("move_beyond_edge_carries_opening_and_furniture", "B3", sc_move_beyond_edge_carries_opening_and_furniture),
    Scenario("paste_room_at_edge_keeps_shape", "B12", sc_paste_room_at_edge_keeps_shape),
    Scenario("leave_move_mode_by_new_tab", "B12", sc_leave_move_mode_by_new_tab),
    Scenario("leave_move_mode_by_tab_switch", "B12", sc_leave_move_mode_by_tab_switch),
    Scenario("leave_move_mode_by_import", "B12", sc_leave_move_mode_by_import),
    Scenario("leave_move_mode_by_duplicate", "F1 B12", sc_leave_move_mode_by_duplicate),
    Scenario("duplicate_plan", "F1", sc_duplicate_plan),
    Scenario("file_menu_export_backup_import", "F3", sc_file_menu_export_backup_import),
    Scenario("door_follows_edge_drag", "F6", sc_door_follows_edge_drag),
    Scenario("delete_room_removes_its_door", "B11", sc_delete_room_removes_its_door),
    Scenario("modal_blocks_shortcuts", "B6 F7", sc_modal_blocks_shortcuts),
    Scenario("typing_is_one_undo_step", "B7", sc_typing_is_one_undo_step),
    Scenario("settings_number_fields", "B8", sc_settings_number_fields),
    Scenario("opening_width_validated", "B8", sc_opening_width_validated),
    Scenario("furniture_size_free_input", "B8", sc_furniture_size_free_input),
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
