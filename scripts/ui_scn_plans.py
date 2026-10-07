"""ui_scn_plans.py -- 画面E2Eのシナリオ: 間取り(タブ)を増やす・渡す・書き出す経路（共有URL・複製・ファイルメニュー・別タブとの統合）。
@owns 間取りの増減と受け渡しを確かめるシナリオ"""


import json
import re

from ui_lib import check, public_app_url


def sc_share_link_uses_public_base(env):
    """B9: a share link made from a local run points at the published address (a link to localhost opens nothing on another device); the dialog says so, and the payload opens the plan as a new tab."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "共有する部屋")
    ui.page.locator("button", has_text="共有").click()
    ui.page.locator(".modal").wait_for()
    url = ui.page.locator(".share-url input").input_value()
    base = public_app_url()
    check(url.startswith(base + "#p="), f"ローカル起動中の共有リンクは公開版の住所で作るはず: {url[:90]}")
    check("localhost" not in url and "127.0.0.1" not in url, "共有リンクにローカルの住所が入っている")
    check("公開版のURL" in (ui.page.locator(".modal .op-hint").first.text_content() or ""), "公開版のURLで作った旨の注記が無い")
    # the receiving side: the payload after '#p=' opens as a new tab (the published site cannot be opened from here, so the app under test stands in)
    other = env.ui()
    other.open("#p=" + url.split("#p=", 1)[1])
    other.wait_until(lambda: len(other.tab_names()) == 2, "共有リンクの間取りが新しいタブとして開く")
    check("共有する部屋" in other.canvas_text(), "共有リンクの部屋が表示されない")


def sc_duplicate_plan(env):
    """F1: the copy button of the active tab makes "<name> のコピー", a deep copy opened at once; editing the copy leaves the original alone."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "原案の部屋")
    check(ui.page.locator(".plan-tab-dup").count() == 1, "複製ボタンはアクティブなタブにだけ出るはず")
    ui.page.locator(".plan-tab-dup").click()
    ui.wait_until(lambda: ui.tab_names() == ["間取り 1", "間取り 1 のコピー"], "複製でタブが増える")
    check(ui.active_tab() == "間取り 1 のコピー", f"複製した間取りが選ばれていない: {ui.active_tab()}")
    check("原案の部屋" in ui.canvas_text(), "複製に元の部屋が無い")
    check(ui.page.locator("button", has_text="Undo").is_disabled(), "複製したばかりの間取りに Undo 履歴が残っている")
    ids = [p["id"] for p in ui.project()["plans"]]
    check(len(set(ids)) == 2, f"複製の id は新規のはず: {ids}")
    ui.select_room_at(3, 3)
    ui.key("Delete")  # edit the copy
    ui.wait_until(lambda: len(ui.floor()["rooms"]) == 0, "複製の部屋を消す")
    ui.page.locator(".plan-tab").nth(0).click()
    ui.wait_until(lambda: ui.active_tab() == "間取り 1", "元のタブへ戻る")
    check("原案の部屋" in ui.canvas_text() and len(ui.floor()["rooms"]) == 1, "複製を編集したら元の間取りまで変わった")
    ui.reload()
    check(ui.tab_names() == ["間取り 1", "間取り 1 のコピー"], f"再読み込み後にタブが違う: {ui.tab_names()}")


def sc_file_menu_export_backup_import(env):
    """F3: the file menu writes out this plan, backs up all plans, and reads a file in as new tabs (with a short message). Esc closes it."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "A室")
    ui.page.locator(".plan-tab-add").click()
    ui.wait_until(lambda: len(ui.project()["plans"]) == 2, "2つ目の間取り")
    ui.make_room(8, 2, 11, 4, "B室")  # in plan 2

    def open_menu():
        ui.page.locator(".app-header button", has_text="ファイル").click()
        ui.page.locator(".context-menu").wait_for()

    open_menu()
    labels = [t.strip() for t in ui.page.locator(".context-menu button").all_text_contents()]
    check(len(labels) == 3 and "書き出し" in labels[0] and "バックアップ" in labels[1] and "読み込み" in labels[2], f"ファイルメニューの項目: {labels}")
    ui.key("Escape")
    ui.page.locator(".context-menu").wait_for(state="detached")
    check(len(ui.floor()["rooms"]) == 1, "メニューを閉じる Esc で部屋が動いた")

    open_menu()  # this plan only
    with ui.page.expect_download() as dl:
        ui.page.locator(".context-menu button", has_text="この間取りを書き出し").click()
    one = dl.value
    check(one.suggested_filename == "間取り 2.json", f"書き出しのファイル名: {one.suggested_filename}")
    doc = json.loads(open(one.path(), encoding="utf-8").read())
    check([r["name"] for r in doc["floors"]["1"]["rooms"]] == ["B室"], "書き出した間取りの中身が違う")

    open_menu()  # everything
    with ui.page.expect_download() as dl:
        ui.page.locator(".context-menu button", has_text="全部まとめてバックアップ").click()
    allp = dl.value
    check(re.fullmatch(r"madori-backup-\d{4}-\d{2}-\d{2}\.json", allp.suggested_filename), f"バックアップのファイル名: {allp.suggested_filename}")
    text = open(allp.path(), encoding="utf-8").read()
    proj = json.loads(text)
    got = [(p["name"], [r["name"] for r in p["doc"]["floors"]["1"]["rooms"]]) for p in proj["plans"]]
    check(got == [("間取り 1", ["A室"]), ("間取り 2", ["B室"])], f"バックアップに全部の間取りが入っていない: {got}")

    open_menu()  # read it back in through the menu: a file chooser opens
    with ui.page.expect_file_chooser() as fc:
        ui.page.locator(".context-menu button", has_text="ファイルから読み込み").click()
    fc.value.set_files(files=[{"name": "戻す.json", "mimeType": "application/json", "buffer": text.encode("utf-8")}])
    ui.wait_until(lambda: len(ui.tab_names()) == 4, "バックアップの2件が新しいタブとして追加される")
    notice = ui.wait_until(lambda: ui.page.locator(".notice").text_content(), "追加した件数のメッセージ")
    check("2件の間取りを追加しました" in notice, f"メッセージ: {notice}")
    check(ui.tab_names()[:2] == ["間取り 1", "間取り 2"], f"元のタブが変わった: {ui.tab_names()}")


def sc_other_tab_plans_join(env):
    """Another tab's new plans join this tab (nothing is selected, deletions are not copied, a plan deleted here does not come back),
    and a tab that only watches never writes its older copies over what the working tab saved."""
    a = env.ui()
    a.open()
    a.make_room(2, 2, 5, 4, "A室")
    b = a.another_tab()
    b.open()  # boots from storage: plan 1 with A室
    a.page.bring_to_front()
    a.make_room(8, 2, 11, 4, "A2室")  # tab B's copy of plan 1 is now older than what is stored
    a.page.locator(".plan-tab-add").click()  # tab A makes plan 2
    b.page.bring_to_front()
    b.wait_until(lambda: b.tab_names() == ["間取り 1", "間取り 2"], "別のタブで作った間取りがこのタブにも追加される")
    check(b.active_tab() == "間取り 1", f"取り込んだだけなのに選択が移った: {b.active_tab()}")
    check("別のタブの間取り" in (b.page.locator(".notice").text_content() or ""), "追加した旨のメッセージが出ていない")
    b.settle(800)
    names = [r["name"] for r in a.project()["plans"][0]["doc"]["floors"]["1"]["rooms"]]
    check(names == ["A室", "A2室"], f"見ているだけのタブが、作業中のタブの保存を古い内容で上書きした: {names}")

    b.page.locator(".plan-tab", has_text="間取り 2").locator(".plan-tab-close").click()  # delete plan 2 in B (the confirm is accepted)
    b.wait_until(lambda: b.tab_names() == ["間取り 1"], "B で間取り 2 を削除")
    a.page.bring_to_front()
    a.settle(800)
    check(a.tab_names() == ["間取り 1", "間取り 2"], f"別のタブでの削除がこのタブにも反映された: {a.tab_names()}")
    a.make_room(14, 2, 17, 4, "A3室")  # A saves again, and its project still has plan 2
    b.page.bring_to_front()
    b.settle(1000)
    check(b.tab_names() == ["間取り 1"], f"こちらで削除した間取りが、別のタブの保存から戻ってきた: {b.tab_names()}")
