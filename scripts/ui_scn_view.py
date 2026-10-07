"""ui_scn_view.py -- 画面E2Eのシナリオ: 画面の見え方（全体表示・スマホ幅・2本指スクロール・印刷）。
@owns 表示の仕方（拡大・スクロール・画面幅・印刷）を確かめるシナリオ"""


from ui_lib import SHOTS, add_door_at, check, count_color, move_a_over_b, pdf_pages, two_rooms


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


def sc_sp_layout(env):
    """B10/F5: at 390x844 the canvas area is as wide as the screen and shows the canvas; the header wraps so that every button is on screen and
    can be pressed; the toolbar and the panels follow below the canvas; dialogs and the file menu fit the screen."""
    ui = env.ui(390, 844, touch=True)
    ui.open()
    c = ui.center_box()
    check(abs(c["width"] - 390) <= 1, f".center の幅が画面幅になっていない: {c['width']}")
    check(abs(c["height"] - 0.55 * 844) <= 3, f".center の高さは画面の 55% のはず: {c['height']}")
    svg = ui.page.locator("svg.canvas").bounding_box()
    check(svg["width"] > 300 and svg["x"] < 390 and svg["y"] < 844, f"キャンバスが見えない: {svg}")
    check(ui.page.evaluate("document.documentElement.scrollWidth") <= 390, "ページが横にはみ出している")
    for btn in ui.page.locator(".app-header button").all():
        label = (btn.text_content() or "").strip()
        box = btn.bounding_box()
        check(box is not None and box["x"] >= -0.5 and box["x"] + box["width"] <= 390.5 and box["y"] >= 0, f"ヘッダーのボタン「{label}」が画面からはみ出している: {box}")
        covered = btn.evaluate("el => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !(t === el || el.contains(t)); }")
        check(not covered, f"ヘッダーのボタン「{label}」が他の要素に隠れて押せない")
    ui.shot_named("sp_layout")
    ui.scroll_body_to("end")  # the toolbar and the panels are below the canvas
    ui.settle(100)
    c2 = ui.center_box()  # the canvas has scrolled up with the page: the toolbar must lie below it
    create = ui.page.locator(".toolbar button", has_text="部屋を作成").bounding_box()
    check(create is not None and 0 <= create["y"] and create["y"] + create["height"] <= 844 and create["y"] >= c2["y"] + c2["height"] - 1, f"ツールバーがキャンバスの下に見えない: {create} / キャンバス {c2}")
    ui.shot_named("sp_toolbar")
    ui.scroll_body_to(0)
    ui.page.locator(".app-header button", has_text="共有").tap()
    modal = ui.page.locator(".modal").bounding_box()
    check(modal["x"] >= 0 and modal["x"] + modal["width"] <= 390.5, f"共有ダイアログが画面からはみ出している: {modal}")
    ui.key("Escape")
    ui.page.locator(".modal").wait_for(state="detached")
    ui.page.locator(".app-header button", has_text="設定").tap()
    modal = ui.page.locator(".modal").bounding_box()
    check(modal["x"] >= 0 and modal["x"] + modal["width"] <= 390.5, f"設定ダイアログが画面からはみ出している: {modal}")
    ui.key("Escape")
    ui.page.locator(".modal").wait_for(state="detached")
    ui.page.locator(".app-header button", has_text="ファイル").tap()
    menu = ui.page.locator(".context-menu").bounding_box()
    check(menu["x"] >= 0 and menu["x"] + menu["width"] <= 390.5, f"ファイルメニューが画面からはみ出している: {menu}")


def finger_drag(ui, start, end, steps=5, finger=1):
    """One finger puts down at `start`, slides to `end` and lifts (real touch input through CDP)."""
    ui.touch("touchStart", {finger: start})
    for i in range(1, steps + 1):
        ui.touch("touchMove", {finger: (start[0] + (end[0] - start[0]) * i / steps, start[1] + (end[1] - start[1]) * i / steps)})
    ui.touch("touchEnd", {})


def sc_two_finger_pan_scrolls_canvas(env):
    """F5: one finger still draws on the canvas; two fingers scroll it (the content follows them) and drop what the first finger had begun;
    the canvas is not left in a half-done gesture, and one finger works again afterwards."""
    ui = env.ui(390, 844, touch=True)
    ui.open()
    finger_drag(ui, ui.pt(2, 2), ui.pt(5, 4))  # one finger: a rubber band over empty cells -> a pending selection
    n = ui.wait_until(lambda: ui.page.locator(".pending-cell").count() or None, "1本指のドラッグで範囲選択ができる")
    check(n == 12, f"4x3 マスを選んだはずが {n} マス")
    ui.reload()  # clean start (the selection is not saved)
    check(ui.scroll_pos() == [0, 0], f"前提: スクロール位置は左上: {ui.scroll_pos()}")
    f1, f2 = ui.pt(2, 2), ui.pt(7, 2)
    ui.touch("touchStart", {1: f1})  # the first finger starts a rubber band
    ui.touch("touchMove", {1: (f1[0] + 20, f1[1] + 10)})
    ui.touch("touchStart", {1: (f1[0] + 20, f1[1] + 10), 2: f2})  # the second finger lands: scrolling starts
    ui.settle(100)
    p1, p2 = (f1[0] + 20, f1[1] + 10), f2
    for i in range(1, 6):
        dx, dy = -20 * i, -24 * i  # both fingers move 100 left, 120 up in total
        ui.touch("touchMove", {1: (p1[0] + dx, p1[1] + dy), 2: (p2[0] + dx, p2[1] + dy)})
    ui.touch("touchEnd", {1: (p1[0] - 100, p1[1] - 120)})  # lift the second finger first
    ui.touch("touchEnd", {})
    ui.settle(200)
    sx, sy = ui.scroll_pos()
    check(abs(sx - 100) <= 3 and abs(sy - 120) <= 3, f"2本指で動かした分だけキャンバスがスクロールするはず(100, 120): ({sx}, {sy})")
    check(ui.page.locator(".rubber").count() == 0, "最初の指が始めた範囲選択が中断されずに残っている")
    check(ui.page.locator(".pending-cell").count() == 0, "2本指のスクロールで範囲選択が確定してしまった")
    ui.shot_named("sp_pan")
    a = ui.pt(8, 8)  # one finger works again after the scroll
    finger_drag(ui, a, (a[0] + 44, a[1] + 22))
    n = ui.wait_until(lambda: ui.page.locator(".pending-cell").count() or None, "スクロール後も1本指で範囲選択できる")
    check(n == 6, f"3x2 マスを選んだはずが {n} マス")


def sc_sp_fit_all(env):
    """F5: on a phone the "全体" button brings a room made far from the top left into view (the canvas is 64x64 cells; the screen shows a corner of it)."""
    ui = env.ui(390, 844, touch=True)
    ui.open()
    ui.scroll_canvas_to_end()
    ui.make_room(50, 47, 58, 55, "遠い部屋")
    ui.scroll_body_to(0)
    ui.page.locator(".zoom-fit").tap()
    ui.wait_until(lambda: ui.zoom_pct() != 100, "「全体」で拡大率が変わる")
    ui.settle(300)
    c = ui.center_box()
    x0, y0, x1, y1 = ui.room_px_box(50, 47, 58, 55)
    check(c["x"] - 1 <= x0 and x1 <= c["x"] + c["width"] + 1, f"部屋が横に見切れている: 部屋 {x0:.0f}..{x1:.0f} / 表示域 {c['x']:.0f}..{c['x'] + c['width']:.0f}")
    check(c["y"] - 1 <= y0 and y1 <= c["y"] + c["height"] + 1, f"部屋が縦に見切れている: 部屋 {y0:.0f}..{y1:.0f} / 表示域 {c['y']:.0f}..{c['y'] + c['height']:.0f}")
    check(ui.zoom_pct() >= 100, f"小さな部屋は拡大して見せるはず: {ui.zoom_pct()}%")
    ui.shot_named("sp_fit")


def sc_print_layout(env):
    """F2: printing shows only the printout, one page for each floor that has rooms (heading, drawing, room list, areas), and the room colours
    survive. Checked on the print media emulation (screenshot) and on a real PDF made without "background graphics" (the browser's default)."""
    ui = env.ui(794, 1123)  # A4 portrait at 96 dpi
    ui.open()
    ui.make_room(2, 2, 7, 6, "LDK", type_name="LDK")  # 6 x 5 = 30 cells
    ui.make_room(9, 2, 12, 6, "寝室")  # 4 x 5 = 20 cells, the first type (blue)
    add_door_at(ui, (3, 3), 3.5, 2, 1)
    ui.page.locator(".floor-tab", has_text="2階").click()
    ui.make_room(2, 2, 5, 5, "子供部屋", wait_saved=False)  # 4 x 4 = 16 cells (make_room waits on floor 1 only)
    ui.page.locator(".floor-tab", has_text="1階").click()
    ui.wait_until(lambda: len(ui.floor(1)["rooms"]) == 2 and len(ui.floor(2)["rooms"]) == 1, "3つの部屋の保存")
    ui.page.evaluate("() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; }")  # the dialog itself cannot be driven
    ui.page.locator(".app-header button", has_text="印刷").click()
    check(ui.page.evaluate("window.__printed") == 1, "「印刷」ボタンが window.print を呼んでいない")
    ui.page.emulate_media(media="print")
    ui.settle(200)
    check(not ui.page.locator(".app").is_visible(), "印刷なのに画面の UI が見えている")
    check(not ui.page.locator(".app-header").is_visible(), "印刷なのにヘッダーが見えている")
    check(ui.page.locator(".print-page").count() == 2, "部屋がある階（1階・2階）ごとに1ページのはず")
    heads = [t.strip() for t in ui.page.locator(".print-page h1").all_text_contents()]
    check(heads == ["間取り 1 1階", "間取り 1 2階"], f"見出し: {heads}")
    rows = [[c.strip() for c in tr.locator("td").all_text_contents()] for tr in ui.page.locator(".print-page").nth(0).locator("tbody tr").all()]
    check(rows == [["LDK", "LDK", "6.21", "3.8"], ["寝室", "居室", "4.14", "2.6"]], f"1階の部屋一覧: {rows}")
    total = " ".join((ui.page.locator(".print-total").nth(0).text_content() or "").split())
    check("1階 合計 10.35㎡" in total and "延床面積（全階）13.66㎡" in total, f"面積の行: {total}")
    ui.shot_named("print_floor1", full_page=True)
    shot = ui.page.screenshot(full_page=True)
    LDK_FILL, ROOM_FILL = (250, 215, 160), (191, 217, 234)  # the colours of LDK (#F5B041) and 居室 (#7FB3D5) at the 50% the canvas fills them with
    check(count_color(shot, LDK_FILL) > 3000 and count_color(shot, ROOM_FILL) > 3000, "印刷の表示に部屋の色が出ていない")
    # a real PDF, made the way a browser makes it by default: without "background graphics"
    pdf = ui.page.pdf(format="A4", print_background=False, prefer_css_page_size=True)
    texts, pngs = pdf_pages(pdf)
    check(len(texts) == 2, f"PDF は2ページ（階ごとに1ページ）のはず: {len(texts)} ページ")
    check("間取り 1 1階" in texts[0] and "LDK" in texts[0] and "子供部屋" in texts[1], "PDF の各ページの中身が違う")
    check("設定" not in "".join(texts) and "ファイル" not in "".join(texts), "PDF に画面のボタンが出ている")
    for i, png in enumerate(pngs):
        (SHOTS / f"print_pdf_page{i + 1}.png").write_bytes(png)
    CHIP = (245, 176, 65)  # the colour chip in the room list is a CSS background: only print-color-adjust keeps it
    check(count_color(pngs[0], LDK_FILL) > 3000 and count_color(pngs[0], ROOM_FILL) > 3000, "PDF に部屋の色が出ていない")
    check(count_color(pngs[0], CHIP, tol=6) > 20, "一覧の色チップが PDF に出ていない（背景のグラフィックを切ると消える）")
    # control: without print-color-adjust the same PDF loses the chips, so the check above can see the difference
    ui.page.add_style_tag(content=".print-sheet, .print-sheet * { -webkit-print-color-adjust: economy !important; print-color-adjust: economy !important; }")
    _, plain = pdf_pages(ui.page.pdf(format="A4", print_background=False, prefer_css_page_size=True))
    check(count_color(plain[0], CHIP, tol=6) == 0, "対照: print-color-adjust を外しても色チップが出る（検査が効いていない）")
    check(count_color(plain[0], LDK_FILL) > 3000, "対照: 図の塗りまで消えた（図は背景ではなく内容のはず）")


def sc_print_settles_move_mode_overlap(env):
    """Printing while rooms still overlap in move mode prints them as they will be once settled: no cell is counted twice in the list."""
    ui = env.ui(794, 1123)
    ui.open()
    two_rooms(ui)  # A 3x3 and B 3x3
    move_a_over_b(ui)  # A (on top) covers a column of B: B keeps 6 of its 9 cells
    ui.page.emulate_media(media="print")
    ui.settle(200)
    rows = {r[0]: r[2] for r in ([c.strip() for c in tr.locator("td").all_text_contents()] for tr in ui.page.locator("tbody tr").all())}
    check(rows == {"A": "1.86", "B": "1.24"}, f"重なりを解消した面積のはず（A 9マス・B 6マス）: {rows}")
    total = " ".join((ui.page.locator(".print-total").text_content() or "").split())
    check("1階 合計 3.11㎡" in total, f"合計は重なりを数えない: {total}")
