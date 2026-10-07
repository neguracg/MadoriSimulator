"""ui_scn_document.py -- 画面E2Eのシナリオ: 保存データ・取り込み・共有リンクなど、文書(Doc)の入口と保存（B1 B2）。
@owns 文書の入口と保存を確かめるシナリオ"""


import json

from ui_lib import (
    BACKUP_KEY,
    CORRUPT_PREFIX,
    EMPTY_DOC,
    LEGACY_DOC,
    LEGACY_DOC_NO_FLOOR2,
    OLD_DOC_KEY,
    PROJECT_KEY,
    check,
    legacy_project,
    lz_compress,
    move_a_over_b,
    no_overlap,
    two_rooms,
)


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


def sc_reload_in_move_mode_settles_overlaps(env):
    """Closing / reloading while still in move mode left overlapping rooms in storage; they come back settled (the room on top keeps the cells)."""
    ui = env.ui()
    ui.open()
    two_rooms(ui)
    move_a_over_b(ui)  # the autosave holds the unsettled document: A sits on a column of B
    check(not no_overlap(ui.doc()), "前提: 保存データが重なっていない")
    raw = ui.storage(PROJECT_KEY)
    ui.reload()
    ui.wait_until(lambda: no_overlap(ui.doc()), "再読み込み後は重なりが解消された文書が保存される")
    check({r["name"] for r in ui.floor()["rooms"]} == {"A", "B"}, "重なりを解消しても部屋が消えている")
    check("A" in ui.canvas_text() and "B" in ui.canvas_text(), "再読み込み後に部屋が表示されない")
    check(ui.storage(BACKUP_KEY) == raw, "重なっていた元の文字列が backup-prev に残っていない")
