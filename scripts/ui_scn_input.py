"""ui_scn_input.py -- 画面E2Eのシナリオ: キー操作・ダイアログ・文字/数値の入力（B6 B7 B8 F7）。
@owns 入力まわり（キー・ダイアログ・入力欄・Undo のまとめ）を確かめるシナリオ"""


from ui_lib import check, place_door


def sc_modal_blocks_shortcuts(env):
    """B6/F7: while a dialog or menu is open, Delete / Ctrl+Z leave the document behind it alone, and Esc closes the dialog or menu."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "A")
    ui.select_room_at(3, 3)
    ui.page.locator("button", has_text="共有").click()
    ui.page.locator(".modal").wait_for()
    ui.key("Delete")
    ui.settle()
    check(len(ui.floor()["rooms"]) == 1, "共有ダイアログを開いたまま Delete で裏の部屋が消えた")
    ui.key("Control+z")  # would undo the creation of the room
    ui.settle()
    check(len(ui.floor()["rooms"]) == 1, "共有ダイアログを開いたまま Ctrl+Z で裏の操作が取り消された")
    ui.key("Escape")
    ui.page.locator(".modal").wait_for(state="detached")
    ui.page.locator("button", has_text="設定").click()
    ui.page.locator(".settings-row input").first.click()  # focus inside a field: Esc must still close the dialog
    ui.key("Escape")
    ui.page.locator(".modal").wait_for(state="detached")
    ui.page.mouse.click(*ui.pt(3, 3), button="right")
    ui.page.locator(".context-menu").wait_for()
    ui.key("Delete")
    ui.settle()
    check(len(ui.floor()["rooms"]) == 1, "メニューを開いたまま Delete で部屋が消えた")
    ui.key("Escape")
    ui.page.locator(".context-menu").wait_for(state="detached")
    ui.page.mouse.click(*ui.pt(3, 3), button="right")  # the opening dialog
    ui.page.locator(".context-menu button", has_text="ドア").click()
    ui.page.locator(".size-grid").wait_for()
    ui.key("Escape")
    ui.page.locator(".modal").wait_for(state="detached")
    ui.drag(ui.pt(10, 10), ui.pt(12, 12))  # the room dialog (focus is in its text field)
    ui.page.locator("button", has_text="部屋を作成").first.click()
    ui.page.locator(".modal textarea").wait_for()
    ui.key("Escape")
    ui.page.locator(".modal").wait_for(state="detached")
    ui.select_room_at(3, 3)
    ui.key("Delete")  # nothing is open any more: the shortcut works again on the selected room
    ui.wait_until(lambda: len(ui.floor()["rooms"]) == 0, "何も開いていなければ Delete が効く")


def sc_typing_is_one_undo_step(env):
    """B7: typing a name / dragging a colour is one Undo step while it continues; a pause longer than 1.5 s starts a new step."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "A")
    ui.select_room_at(3, 3)
    ta = ui.page.locator(".right textarea")
    ta.click()
    ta.press("End")
    ta.press_sequentially("123456789", delay=10)
    ui.wait_until(lambda: ui.floor()["rooms"][0]["name"] == "A123456789", "9 文字の保存")
    ui.page.wait_for_timeout(1700)
    ta.press_sequentially("xyz", delay=10)
    ui.wait_until(lambda: ui.floor()["rooms"][0]["name"] == "A123456789xyz", "続きの保存")
    colour = ui.page.locator(".right input[type=color]")
    colour.fill("#336699")
    colour.fill("#996633")
    ui.wait_until(lambda: ui.floor()["rooms"][0].get("colorOverride") == "#996633", "色の保存")
    n = ui.undo_all()
    check(n == 4, f"Undo は 4 回（作成 + 文字入力 + 間を置いた文字入力 + 色）のはず: {n} 回")


def sc_settings_number_fields(env):
    """B8: emptying or mistyping a numeric field never changes the document; only a valid value is applied; leaving the field restores the last valid text."""
    ui = env.ui()
    ui.open()
    ui.page.locator("button", has_text="設定").click()
    wall = ui.page.locator(".settings-row input").nth(0)
    cell = ui.page.locator(".settings-row input").nth(1)
    cell.fill("")
    ui.settle()
    check(ui.doc()["settings"]["cellMm"] == 455, "1マスを空にしたら値が変わった")
    cell.fill("9")
    ui.settle()
    check(ui.doc()["settings"]["cellMm"] == 455, "範囲外の 9 が入った")
    cell.fill("500")
    ui.wait_until(lambda: ui.doc()["settings"]["cellMm"] == 500, "有効な値 500 の反映")
    cell.fill("")
    cell.blur()
    check(cell.input_value() == "500", f"空のまま離れたら直前の有効値に戻るはず: {cell.input_value()}")
    wall.fill("401")
    ui.settle()
    check(ui.doc()["settings"]["wallMm"] == 120, "範囲外の 401 が入った")
    wall.fill("60")
    ui.wait_until(lambda: ui.doc()["settings"]["wallMm"] == 60, "有効な値 60 の反映")
    wall.fill("abc")
    ui.settle()
    check(ui.doc()["settings"]["wallMm"] == 60, "数字でない値が入った")
    check(wall.get_attribute("aria-invalid") == "true", "不正な入力が赤く示されていない")


def sc_opening_width_validated(env):
    """B8: the opening-width prompt and the custom width of the dialog accept only 100..4000 mm."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 7, 6, "A")
    door = place_door(ui)
    size0 = door["size"]
    for answer in ["99999", "abc"]:
        ui.prompt_answers[:] = [answer]
        n = len(ui.dialogs)
        ui.page.mouse.click(*ui.grid(4.5, 2), button="right")
        ui.page.locator(".context-menu button", has_text="幅を変更").click()
        ui.wait_until(lambda: len(ui.dialogs) >= n + 2, f"{answer} を入力したら範囲外の案内が出る")
        ui.settle()
        check(ui.floor()["openings"][0]["size"] == size0, f"{answer} がドア幅に入った")
    ui.prompt_answers[:] = ["1200"]
    ui.page.mouse.click(*ui.grid(4.5, 2), button="right")
    ui.page.locator(".context-menu button", has_text="幅を変更").click()
    ui.wait_until(lambda: ui.floor()["openings"][0]["size"] == 1200, "有効な幅 1200 の反映")
    # the dialog: an invalid custom width is never used (the field goes back to the last valid one), a valid one is
    for text, expect in [("50", "800"), ("1000", "1000")]:
        ui.page.mouse.click(*ui.pt(3, 4), button="right")
        ui.page.locator(".context-menu button", has_text="ドア").click()
        ui.page.locator(".custom-size input").fill(text)
        ui.page.locator(".custom-size button").click()
        banner = ui.page.locator(".place-banner")
        banner.wait_for()
        check(f"（{expect}mm）" in (banner.text_content() or ""), f"カスタム幅 {text} のとき配置する幅は {expect}mm のはず: {banner.text_content()}")
        ui.key("Escape")
        banner.wait_for(state="detached")


def sc_furniture_size_free_input(env):
    """Furniture width / depth keep their free-input behaviour (now through the shared NumberField)."""
    ui = env.ui()
    ui.open()
    ui.page.locator("button", has_text="家具を作成").click()
    ui.drag(ui.pt(10, 10), ui.pt(13, 12))
    f0 = ui.wait_until(lambda: ui.floor()["furniture"][0], "家具の作成")
    width = ui.page.locator(".dim-row input").nth(0)
    width.fill("")
    ui.settle()
    check(ui.floor()["furniture"][0]["w"] == f0["w"], "空にしたら幅が変わった")
    width.fill("10")
    ui.settle()
    check(ui.floor()["furniture"][0]["w"] == f0["w"], "20mm 未満の 10 が入った")
    width.fill("1500")
    ui.wait_until(lambda: ui.floor()["furniture"][0]["w"] == 1500, "有効な幅 1500 の反映")
    width.fill("")
    width.blur()
    check(width.input_value() == "1500", f"空のまま離れたら直前の有効値に戻るはず: {width.input_value()}")
