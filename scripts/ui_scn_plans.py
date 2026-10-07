"""ui_scn_plans.py -- 画面E2Eのシナリオ: 間取り(タブ)を増やす・渡す・書き出す経路（共有URL・複製・ファイルメニュー・別タブとの統合）。
@owns 間取りの増減と受け渡しを確かめるシナリオ"""


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
