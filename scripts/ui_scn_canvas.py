"""ui_scn_canvas.py -- 画面E2Eのシナリオ: キャンバス上の操作（ドラッグ・移動・貼り付け・ドア/窓・家具）と、その Undo の数（B3 B4 B5 B11 B12 F6）。
@owns 図面の操作を確かめるシナリオ"""


import json

from ui_lib import CELL, CELL_MM, EMPTY_DOC, add_door_at, cell_xy, check, place_door


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


def sc_move_beyond_edge_carries_opening_and_furniture(env):
    """B3: the door on the wall of the room and the furniture inside it travel by the SAME clamped shift as the room (each used to clamp on its own)."""
    ui = env.ui()
    ui.open()
    ui.make_room(1, 1, 4, 3, "A")  # x 1..4, y 1..3
    add_door_at(ui, (2, 2), 2.5, 1, 1)  # on the top wall above cell (2,1)
    ui.page.locator("button", has_text="家具を作成").click()
    ui.drag(ui.pt(2, 2), ui.pt(3, 3))  # 455 x 455 mm, its centre lies inside A
    f0 = ui.wait_until(lambda: ui.floor()["furniture"][0], "家具の作成")
    door0 = ui.floor()["openings"][0]
    check((door0["cx"], door0["cy"], door0["side"]) == (2, 1, "N"), f"ドアの初期位置: {door0}")
    ui.page.locator("button.mode-btn", has_text="移動").click()
    ui.drag(ui.pt(1, 2), ui.pt(-2, 2))  # 3 cells to the left asked, only 1 fits (grabbed away from the selected furniture and its handles)
    cells = ui.wait_until(lambda: (lambda c: c if "0,1" in c else None)(ui.room("A")["cells"]), "移動の保存")
    check(len(cells) == 12 and min(cell_xy(c)[0] for c in cells) == 0, f"部屋の形が保たれていない: {sorted(cells)}")
    door = ui.floor()["openings"][0]
    check((door["cx"], door["cy"], door["side"]) == (1, 1, "N"), f"ドアは部屋と同じ 1 マスだけ動くはず: {door0} -> {door}")
    f1 = ui.floor()["furniture"][0]
    check(abs(f1["x"] - (f0["x"] - CELL_MM)) < 1 and abs(f1["y"] - f0["y"]) < 1, f"家具は部屋と同じ 1 マスだけ動くはず: {f0} -> {f1}")


def sc_paste_room_at_edge_keeps_shape(env):
    """B12: a room pasted next to the edge of the grid is shifted inside as a whole (no cell outside the grid); pasting switches to move mode."""
    ui = env.ui()
    ui.open()
    ui.scroll_canvas_to_end()
    ui.make_room(61, 60, 63, 62, "E")  # 3 x 3 in the bottom-right corner
    ui.select_room_at(62, 61)
    ui.key("Control+c")
    ui.key("Control+v")
    ui.wait_until(lambda: len(ui.floor()["rooms"]) == 2, "貼り付け")
    rooms = ui.floor()["rooms"]
    pasted = max(rooms, key=lambda r: r["z"])
    xy = [cell_xy(c) for c in pasted["cells"]]
    check(len(xy) == 9 and all(0 <= x < 64 and 0 <= y < 64 for x, y in xy), f"グリッドの外にマスがある／形が崩れた: {sorted(pasted['cells'])}")
    active = (ui.page.locator("button.mode-btn.active").text_content() or "").strip()
    check(active == "移動", f"貼り付け後は移動モードになるはず: {active}")


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


def sc_leave_move_mode_by_new_tab(env):
    """Leaving the document by adding a tab while in move mode parks it with the overlaps settled."""
    ui = env.ui()
    ui.open()
    two_rooms(ui)
    move_a_over_b(ui)
    ui.page.locator(".plan-tab-add").click()
    ui.wait_until(lambda: len(ui.project()["plans"]) == 2, "新しいタブ")
    check(no_overlap(ui.project()["plans"][0]["doc"]), "移動モードのまま新しいタブを作ったら、元の間取りに重なりが残った")


def sc_leave_move_mode_by_tab_switch(env):
    """Same for switching to another tab."""
    ui = env.ui()
    ui.open()
    two_rooms(ui)
    ui.page.locator(".plan-tab-add").click()
    ui.wait_until(lambda: len(ui.project()["plans"]) == 2, "2つ目のタブ")
    first_id = ui.project()["plans"][0]["id"]
    ui.page.locator(".plan-tab", has_text="間取り 1").click()
    ui.wait_until(lambda: ui.project()["activePlanId"] == first_id, "1つ目のタブに戻る")
    move_a_over_b(ui)
    ui.page.locator(".plan-tab", has_text="間取り 2").click()
    ui.wait_until(lambda: ui.project()["activePlanId"] != first_id, "タブの切替が保存される")
    check(no_overlap(ui.project()["plans"][0]["doc"]), "移動モードのままタブを切り替えたら、元の間取りに重なりが残った")


def sc_leave_move_mode_by_import(env):
    """Same for importing a file (it adds a tab)."""
    ui = env.ui()
    ui.open()
    two_rooms(ui)
    move_a_over_b(ui)
    ui.import_file("x.json", json.dumps(EMPTY_DOC))
    ui.wait_until(lambda: len(ui.project()["plans"]) == 2, "取り込みでタブが増える")
    check(no_overlap(ui.project()["plans"][0]["doc"]), "移動モードのまま取り込んだら、元の間取りに重なりが残った")


def sc_door_follows_edge_drag(env):
    """F6: dragging a wall of the room takes its door along (same direction, the nearest position on the new wall)."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 7, 6, "A")  # x 2..7, y 2..6
    door = add_door_at(ui, (3, 3), 3.5, 2, 1)  # on the top wall above cell (3,2)
    check((door["cx"], door["cy"], door["side"]) == (3, 2, "N"), f"ドアの初期位置: {door}")
    ui.select_room_at(5, 4)
    ui.drag(ui.grid(5, 2), ui.grid(5, 0))  # the top-wall handle, 2 rows up
    ui.wait_until(lambda: min(cell_xy(c)[1] for c in ui.room("A")["cells"]) == 0, "辺ドラッグで上へ2マス伸びる")
    door = ui.floor()["openings"][0]
    check((door["cx"], door["cy"], door["side"]) == (3, 0, "N"), f"ドアは新しい上の壁へ移るはず: {door}")


def sc_delete_room_removes_its_door(env):
    """B11: a door that no room has any more is removed with the room; a door on a wall shared with another room stays while that room exists."""
    ui = env.ui()
    ui.open()
    ui.make_room(2, 2, 5, 4, "A")
    add_door_at(ui, (3, 3), 3.5, 2, 1)
    ui.select_room_at(3, 3)
    ui.key("Delete")
    ui.wait_until(lambda: len(ui.floor()["rooms"]) == 0, "部屋の削除")
    ui.wait_until(lambda: len(ui.floor()["openings"]) == 0, "部屋を消したらそのドアも消える")
    ui.undo_all()
    ui.make_room(2, 2, 4, 4, "L")
    ui.make_room(5, 2, 7, 4, "R")  # right next to L
    add_door_at(ui, (3, 3), 5, 3.5, 1)  # on the wall between L and R
    ui.select_room_at(3, 3)
    ui.key("Delete")
    ui.wait_until(lambda: [r["name"] for r in ui.floor()["rooms"]] == ["R"], "L の削除")
    ui.settle()
    check(len(ui.floor()["openings"]) == 1, "共有壁のドアは隣の部屋が残る間は消えないはず")
    ui.select_room_at(6, 3)
    ui.key("Delete")
    ui.wait_until(lambda: len(ui.floor()["openings"]) == 0, "最後の部屋を消したら共有壁のドアも消える")
