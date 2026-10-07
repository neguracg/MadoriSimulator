# BUGLOG（バグ台帳）

ルール: バグを直したら**原則すべて**1行追記する（フィルターしない。目的は手広く集めること）。
その場で分析はしない（横断分析・再発防止化は週次の bug-review スキルの担当）。
除外してよいのは、コミットに至らない書き間違いだけ。**書くか迷ったら書く。**
書式の正本: ~/.claude/skills/bug-review/references/buglog-rules.md

---

## 🔴 要対策（同じ機構で2回以上やらかした／!重が出た＝次も必ず起きる）

| 発覚 | 機構（次も起きること） | 回数 | 状態 |
|---|---|---|---|
| 2026-09-28 | **外から入る間取り文書(Doc)の形を、入口ごとに個別に見ている**（保存データの読込・インポート・共有リンクが別々に検査し、openings や2階の有無を誰も見なかった）。新しい入口を足すたびに同じ穴が開く | 1回・重大 | **対策済み・様子見**（fc495b4。normalizeDoc に集約し全入口を通した。入口を足す時は normalizeDoc / parseImportFile を通す） |
| 2026-09-28 | **取り込み・復元の操作が、いま編集中のデータを確認なしに置き換える**（インポートが現在の間取りを履歴ごと上書きしていた） | 1回・重大 | **対策済み・様子見**（fc495b4。インポートは常に新しいタブへ追加。間取りを増やす経路は appendPlans だけ） |
| 2026-09-28 | **state 更新関数（setX(fn)・useHistory.commit(fn)）の中で副作用（親の commit など）を呼ぶ**。更新関数は後から走る・2回走るため、確定が落ちる／履歴が2件積まれる。ドラッグ確定の3箇所（辺/角・ドア/窓・家具）で発生 | 2回（B4 / B5） | **対策済み・様子見**（86723a8。useLiveValue で確定値を ref に持ち pointerup から直接確定。src/lint/noUpdaterSideEffects.test.ts が全ソースを検査） |
| 2026-10-07 | **ドア/窓はセルの辺の位置だけを持ち部屋を持たないため、部屋の形・存在を変える操作が開口部を見ないと、宙に残る・壁から離れる**（削除してもドア/窓が残り、辺ドラッグ・マス追加削除で壁から離れた。移動への追随 84bf2f9 と同じ機構）。部屋に作用する操作を足すたびに起きる | 2回（B11 / F6） | **対策済み・様子見**（(本コミット)。openingOps.reconcileOpenings・pruneOrphans に集約し、マスを変える docOps の操作は followShape / pruneOrphans を通る。src/state/docOps.invariants.test.ts の公開操作の表が、新しい操作の宣言漏れを落とす） |
| 2026-10-07 | **部屋・ドア窓・家具をグリッド範囲へ収める処理が、マス/要素ごとの個別クランプ、またはクランプ無しで書かれている**（移動はマスごとにクランプして形が潰れ、貼付と辺ドラッグは範囲外のマスを作り、保存を読み直すと消える。移動に付くドア窓・家具も各自クランプで部屋から離れた）。座標やマスを作る経路を足すたびに起きる | 3回（B3 / B12 / 辺ドラッグ）・重大 | **対策済み・様子見**（(本コミット)。移動量をまとめて切り詰める geometry.clampRoomDelta と範囲判定 inGrid に集約し、docOps.normalize が範囲外のマスを落とす。公開操作の表＋網羅テスト src/state/docOps.invariants.test.ts が、新しい操作の宣言漏れを落とす） |

---

## 時系列ログ

- 2026-10-07 | [!重] 旧形式の保存データ（openings の無い文書・2階の無い文書）や旧形式の共有リンクで起動すると画面が真っ白になる（Cannot read properties of undefined・#root が空）。公開サイトの利用者は何も操作できず、壊れたデータは次の自動保存で上書きされ復旧もできない（全体監査 B1） | 原因: 文書(Doc)の妥当性検査が App.loadProject（保存キー・旧キー）・App.importJson・share.decodePlan に分散し、どれも openings と2階の有無を見ていなかった。読み込めなかった生データの退避も無かった | fc495b4 | @jissou ヨコテン:済4件（Docの入口=保存キー読込・旧キー読込・インポート・共有リンクを全て normalizeDoc へ。内部の switchPlan・deletePlan・クリップボードは入口を通った値だけを扱うため不要） グローバル:不要(kaishu-policy 着手前5問の問1・yokoten モード4が同型＝同じ知識を持つ場所の全数列挙。このアプリ固有の対策は normalizeDoc と projectStore のテスト)
- 2026-10-07 | [!重] インポートが編集中の間取りを確認なしに置き換え、Undo もできない（部屋1つの間取りへ空の JSON を読み込むと部屋0・Undo 無効・タブ1つのまま。取り込み直前の作業が消える）（全体監査 B2） | 原因: App.importJson が reset(d) で現在の文書を履歴ごと置換していた。「間取りを増やす経路」のうちインポートだけが追加方式でなく置換方式だった | fc495b4 | @sekkei ヨコテン:済3件（間取りを増やす経路=新規タブ・共有リンク・ファイル取込を appendPlans 1関数に統合。置換していたのはインポートだけ） グローバル:不要(取り込みは追加を既定にする定石を取り違えたこのアプリの設計判断)
- 2026-10-07 | 家具のドラッグ移動・サイズ変更が、動かしてすぐ離すと反映されないことがある（移動・リサイズとも座標が変わらない）（全体監査 B4） | 原因: Canvas の pointerup が state 更新関数 setFurnLive((f) => {…}) の中で親の commit（props.onPatchFurniture）を呼び、直後に furnMovedRef を false に戻していた。更新関数は後から走るため、走った時には条件が偽で確定が落ちる | 86723a8 | @jissou ヨコテン:済3件（機構=state 更新関数の中で副作用を呼ぶ。src 全体の set*((…)=>…) を全数列挙し、副作用ありの3箇所＝辺/角ハンドル・ドア/窓・家具を同コミットで修正。残りは純粋で不要） グローバル:済(kankyo-policy NOTES.md に React の更新関数の落とし穴を記録)
- 2026-10-07 | 辺ドラッグ・ドア/窓ドラッグで Undo 履歴が2件積まれる（dev 起動時。部屋作成+辺ドラッグで Undo 3回・部屋+ドア+ドラッグで 4回。React の警告 Cannot update a component while rendering a different component も出る）（全体監査 B5） | 原因: B4 と同じ機構。state 更新関数の中の副作用（親の commit）が StrictMode で2回走る。Canvas の3箇所（辺/角・ドア/窓・家具） | 86723a8 | @jissou ヨコテン:済3件（B4 と同じ3箇所を同コミットで。commit(fn) の関数形引数に副作用を入れた箇所は0件）/恒久化:hooks/useLiveValue.ts（確定値を ref に持つ部品）+ src/lint/noUpdaterSideEffects.test.ts（更新関数内の副作用を全ソースで検出。修正前の Canvas を入れると3箇所とも落ちることを確認） グローバル:済(B4 と同じ。kankyo-policy NOTES.md)
- 2026-10-07 | [!重] 移動モードで部屋を端の外へ動かすと形が潰れる（4x3=12マスの部屋を左へ3マス頼むと6マスになる。部屋に付くドア/窓・家具も部屋とは別々に切り詰められ、壁・部屋から離れる。プレビューは潰れない形を見せるのに、離すと潰れる）（全体監査 B3） | 原因: docOps.translateRoom が移動量ではなく個別のマスをグリッド範囲へクランプしていた（連動するドア/窓は clampX/clampY・家具は Math.max(0, …) と各自でクランプ）。Canvas のプレビュー moveOffset はクランプ自体が無く、確定した結果とずれた | (本コミット) | @jissou ヨコテン:済9件（機構=グリッド範囲へ収める処理を要素ごとに行う／行わない。マス・位置を作る経路を全数列挙: 移動=部屋・ドア窓・家具・プレビュー・確定の5件／貼付=部屋・家具の2件／辺ドラッグ applyRunDrag／公開操作の出口 docOps.normalize の計9件を適用。矩形作成・マス追加削除 rectCells・角ドラッグ・家具の自由配置・読込 normalizeCells は理由つきで不要）/恒久化:geometry.clampRoomDelta・inGrid + src/state/docOps.invariants.test.ts（公開操作の表＋網羅。normalize の範囲外除去を外すと3件落ちることを確認） グローバル:不要(図面ドメイン固有のグリッド範囲の扱い。まとまりは要素ごとでなく移動量をクランプする、は一般則だがこのアプリの部品と網羅テストで足りる)
- 2026-10-07 | [!重] 貼り付けた部屋がグリッド外へ出る・移動モードにならず重なったまま残る（端の部屋を貼付すると 64,64 などの範囲外マスができ、保存を読み直すと消える。同じ階へ貼ると元の部屋と重なったまま）（全体監査 B12） | 原因: docOps.pasteRoom にクランプが無く、pasteFurniture も範囲を見ていなかった。貼った部屋が重なっていても移動モードへ切り替わらず、重なり解決は移動モードを出る時にしか走らない | (本コミット) | @jissou ヨコテン:済2件（貼付は部屋・家具の2経路とも範囲内へ収める。App は部屋の貼付後 setMode('move')。家具の貼付は部屋と重ならない概念なので移動モードへは切り替えない）/恒久化:B3 と同じ（docOps.invariants テストの表に pasteRoom） グローバル:不要(B3 と同じ。図面ドメイン固有)
- 2026-10-07 | 移動モードのまま間取りタブの切替・新規追加・ファイル取込・共有リンク取込をすると、重なり解決前の（重なったままの）文書が保存される（元のタブへ戻っても部屋が重なったまま。画面E2Eで実証。全体監査 B12 の推測欄） | 原因: App.switchPlan が commit(resolveOverlaps) の直後に presentRef.current を読んでいた（presentRef は次の描画まで更新されず、重なり解決前の値）。appendPlans（新規・共有リンク・取込）は重なり解決自体を呼んでいなかった | (本コミット) | @jissou ヨコテン:済4件（文書を離れる経路=switchPlan・addPlan・importSharedPlan・importJson を全数列挙し、switchPlan と appendPlans 経由の3つを leaveCurrentDoc 1関数に統一。setMode・switchFloor は同じ文書に留まるため commit のまま・deletePlan は文書を捨てるだけなので不要。未対応=移動モードのままタブを閉じる／再読込すると重なったまま保存される）/恒久化:leaveCurrentDoc に1本化＋3経路の画面E2E（leave_move_mode_by_*） グローバル:済(kankyo-policy NOTES.md に React の commit 直後に ref を読むと古い値、を記録)
- 2026-10-07 | 部屋を消してもドア/窓が宙に残る（削除後 rooms=0・openings=1。切り取り Ctrl+X でも同じ。残ったドア/窓は何にも属さず、同じ場所に別の部屋を作ると勝手に付く）。部屋の形を辺ドラッグ・マス追加削除で変えても、ドア/窓は元の位置に残って壁から離れる（全体監査 B11・F6） | 原因: ドア/窓はセルの辺の位置だけを持ち部屋を持たないため、部屋の形・存在を変える docOps の操作（deleteRoom・expandRoom・shrinkRoom・setRoomShape・resolveOverlaps）が開口部を見ないと、宙に残る・壁から離れる | (本コミット) | @jissou ヨコテン:済5件（機構=開口部は辺の位置だけで持ち部屋を持たない。マスや存在を変える docOps の操作を全数列挙し、deleteRoom・resolveOverlaps は孤立除去、expandRoom・shrinkRoom・setRoomShape は追随の計5件に適用。createRoom=新設で既存の持ち主を奪わない・translateRoom=連動移動 linkedToRoomMove・pasteRoom=追加のみ・reorderRoom=z のみ・patchRoom=名前色のみは理由つきで不要。削除の UI 経路4本=Delete・Ctrl+X・右クリック・パネルは全て ops.deleteRoom 1関数）/恒久化:src/state/openingOps.ts（reconcileOpenings・pruneOrphans）+ src/state/docOps.invariants.test.ts（公開操作の表。ドア/窓を宙に浮かせない不変条件。配線を外すと3件落ちることを確認） グローバル:不要(図面ドメイン固有: 開口部と壁の対応)
