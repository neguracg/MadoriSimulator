"""ui_scn_view.py -- 画面E2Eのシナリオ: 画面の見え方（全体表示・スマホ幅・2本指スクロール・印刷）。
@owns 表示の仕方（拡大・スクロール・画面幅・印刷）を確かめるシナリオ"""


from ui_lib import check


def sc_fit_all_shows_whole_content(env):
    """The "全体" button picks the zoom at which everything on the floor fits the scrolled area and scrolls to it; an empty floor goes back to 100% at the top left."""
    ui = env.ui()
    ui.open()
    ui.scroll_canvas_to_end()  # the bottom right of the grid is on screen: put a room there, far from the top left
    ui.make_room(50, 44, 58, 55, "遠い部屋")
    check(ui.zoom_pct() == 100, "前提: 拡大率は 100%")
    ui.page.locator(".zoom-fit").click()
    ui.wait_until(lambda: ui.zoom_pct() != 100, "「全体」で拡大率が変わる")
    ui.settle(200)
    c = ui.center_box()
    x0, y0, x1, y1 = ui.room_px_box(50, 44, 58, 55)
    check(c["x"] - 1 <= x0 and x1 <= c["x"] + c["width"] + 1, f"部屋が横に見切れている: 部屋 {x0:.0f}..{x1:.0f} / 表示域 {c['x']:.0f}..{c['x'] + c['width']:.0f}")
    check(c["y"] - 1 <= y0 and y1 <= c["y"] + c["height"] + 1, f"部屋が縦に見切れている: 部屋 {y0:.0f}..{y1:.0f} / 表示域 {c['y']:.0f}..{c['y'] + c['height']:.0f}")
    check(ui.zoom_pct() > 100, f"小さな内容は拡大して見せるはず: {ui.zoom_pct()}%")
    ui.page.locator(".floor-tab", has_text="2階").click()  # an empty floor
    ui.page.locator(".zoom-fit").click()
    ui.wait_until(lambda: ui.zoom_pct() == 100, "空の階では 100% に戻る")
    ui.settle(200)
    check(ui.scroll_pos() == [0, 0], f"空の階は左上へ: {ui.scroll_pos()}")
