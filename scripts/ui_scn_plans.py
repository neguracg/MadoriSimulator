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
