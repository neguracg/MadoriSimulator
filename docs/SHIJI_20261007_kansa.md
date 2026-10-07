# 指示書: 全体監査の修正・機能追加（2026-10-07）

所見の正本は [KANSA_20260928.md](KANSA_20260928.md)（B1〜B12・F1〜F7・設計方針・5問の答え）。
この指示書は **実装の順番と受入条件** を決める。バッチごとに別ワーカーが順に担当する（並走なし）。

## 全バッチ共通の規律

- 作業単位ごとに「ファイルを明示して add」→ commit（一括ステージは禁止）。コミットメッセージは日本語・末尾に
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。push は各バッチの最後に1回。
- バグを1つ直すごとに `docs/BUGLOG.md` へ1行（書式は implementer の規律6。`ヨコテン:`・`グローバル:` 両欄必須）。
  `docs/WORKLOG.md` へバッチ完了時に1行（`- YYYY-MM-DD | 内容 | 検証 | commit`）。両ファイルは無ければ作る
  （BUGLOG 冒頭に `## 🔴 要対策` の空表を置く）。
- 新規モジュールの1行目コメントに `@owns <業務概念>`。既存ファイルへは「配線」だけ足し、新しい概念は新モジュールへ。
  **Canvas.tsx を 1,000 行に近づけない**（今 865 行。フックが遮断する。増やすより減らす）。
- `<input type="number">` を新規に書かない（`NumberField` 部品を使う）。
- 1回の編集で関数全文を貼り直さない（Edit で必要な数行だけ）。完了報告は 30 行以内・コード引用禁止・表1つまで。
- `spawn_task` を呼ばない。別件に気づいたら完了報告に書く。
- 画面確認はヘッドレス（Playwright python。`scripts/ui_check.py`）。ブラウザペイン・Chrome拡張は使わない。
  dev サーバーを手で起動したら同じターンで止める。
- 検証コマンド: `npm run build`（tsc 含む）／`npx vitest run`／`python scripts/ui_check.py`（バッチ1で作る）。

## バッチ1: テスト基盤・文書の正規化と永続化・ドラッグ確定の修正（所見 B1 B2(土台) B4 B5）

1. **vitest 導入**: `npm i -D vitest@2`（vite 5 と同系）。`package.json` の scripts に `"test": "vitest run"`。
   テストは `src/**/*.test.ts`。
2. **`src/state/migrate.ts`**（@owns 間取り文書(Doc)の妥当性検査と旧形式からの移行）:
   `normalizeDoc(raw: unknown): Doc | null`。
   - `floors` が無い／オブジェクトでない → null。
   - 1階・2階を必ず持たせる（無ければ `emptyFloor()`）。各階の `rooms`/`openings`/`furniture` は配列に（無ければ `[]`）。
   - rooms: `cells` は `"x,y"` 形式で 0≤x<GRID_W, 0≤y<GRID_H のものだけ残す（空になった部屋は捨てる）。`z` が数値でなければ順番で付番。`name`/`typeId` は文字列化。
   - openings: `cx`/`cy` 整数・`side` が N/E/S/W・`size`≥100 のものだけ残す。furniture: 数値 x/y/w/h（w,h≥20）のものだけ残す。
   - roomTypes: 配列でなければ `DEFAULT_TYPES` のコピー。settings: `cellMm` は 100〜1000 以外なら 455、`wallMm` は 50〜400 以外なら 120。
   - `version` は 1 に固定。入力を破壊しない（新しいオブジェクトを返す）。
   テスト: 旧形式（openings 無し・2階無し）・壊れた cells・範囲外 settings・正常文書は同値、の4系統以上。
3. **`src/state/projectStore.ts`**（@owns 複数間取り(プロジェクト)の localStorage 永続化とファイル入出力）。
   App.tsx から `Plan`/`Project`/`makePlan`/`loadProject`/保存キーを移す（**引っ越し**: `madori-simulator-project-v1` と
   旧キー `madori-simulator-doc-v1` からの移行を維持）。追加:
   - `loadProject()`: 各 plan.doc を `normalizeDoc` に通す（null の plan は捨てる。全滅なら既定）。
     読み込み対象の生文字列を **読む前に** `madori-simulator-project-v1.backup-prev` へそのままコピーする（修理より先に退避）。
     パース/検査に失敗した生データは `madori-simulator-project-v1.corrupt-<ISO日時>` へ退避してから既定へ落ちる。
   - `saveProject(p): boolean`（失敗で false。握りつぶさない）。
   - `parseImportFile(text, fileName): Plan[]`: 中身が Project（`plans` 配列）なら全 plan、Doc なら1件（名前はファイル名から拡張子を除いたもの）。
     すべて `normalizeDoc` を通す。不正なら空配列。id は必ず新規採番（既存とぶつけない）。
   - `exportProject(p)` の JSON 文字列生成。
   App.tsx: `importJson` は現在の間取りを置換せず、`parseImportFile` の結果を **新しいタブとして追加して選択**する（B2 の修正）。
   保存失敗時は `saveError` state を立て、ヘッダー下に赤い帯「保存に失敗しました。ファイルへ書き出して退避してください」を出す。
   `share.decodePlan` も `normalizeDoc` を通す（B1 の3箇所目）。
   テスト: parseImportFile（Doc/Project/不正）、旧キー移行。
4. **Canvas のドラッグ確定（B4/B5）**: 機構＝「state 更新関数の中で親の commit を呼び、直後に ref を初期化している」。
   3箇所（辺/角ハンドル `setHandlePreview` の onUp・ドア/窓 `setOpeningDragPos` の onUp・家具 `setFurnLive` の onUp）を
   同じ方法で直す: ライブ値を ref（例 `handlePreviewRef`）にも持ち、onUp はハンドラの中で ref を読んで
   `props.onSetShape/onPatchOpening/onPatchFurniture` を直接呼び、その後 state と ref を初期化する。更新関数の中に副作用を残さない。
   同コミットで、**Canvas.tsx:382-407 の linkedOpeningIds/linkedFurnitureIds** と **docOps.translateRoom の同じ判定**を
   `docOps.linkedToRoomMove(f: FloorData, roomId, cellMm): { openingIds: Set<string>; furnitureIds: Set<string> }` 1関数に集約し、
   Canvas の `cellOwner` と docOps の owner 構築を `geometry.cellOwnerMap(rooms)` に集約する（同じ知識は1箇所）。
   受入: dev 起動（StrictMode）で「部屋作成→辺ドラッグ」の Undo が **2回**で無効になる／家具を動かしてすぐ離しても座標が変わる／
   React の `Cannot update a component while rendering` 警告が出ない。
5. **`scripts/ui_check.py`（E2E の骨格）**: `scripts/_seed_ui_repro*.py` を元に作り、元ファイルは削除する。
   - 自前でサーバーを起動して終了時に必ず止める: `--target dev`（`npx vite --port 4178 --strictPort`、env `PORT=4178` で自動オープン抑止）
     ／`--target prod`（`npm run build` 済みを前提に `npx vite preview --port 4179 --strictPort`。URL は `/MadoriSimulator/`）。既定は両方。
   - 起動条件は `C:\Claude\101_KaihatsuHyoujun\shiken\tools\browser_check.py` と同じ（headless・channel="chrome"・1280x900・ja-JP・Asia/Tokyo）。
   - シナリオは **1箇所の一覧（SCENARIOS）** に関数として持ち、各シナリオは assert で落ちる。少なくとも:
     旧形式データで起動できる／インポートで新タブが増え元の部屋が残る／辺ドラッグ Undo 回数／家具の移動・リサイズ反映／
     端の外へ移動しても形が保たれる（バッチ2で直るまでは xfail 扱いにせず、**失敗を報告に残す**）。
   - 出力: `docs/shots/` にスクショ、stdout に結果一覧、終了コード 0/1。
6. BUGLOG 行（B1/B2/B4/B5）、WORKLOG 1行、push。

## バッチ2: 移動・貼付のクランプ、開口部の追随と孤立除去、履歴まとめ、数値入力、キー操作（B3 B6 B7 B8 B11 B12 F6 F7）

1. **`geometry.clampRoomDelta(cells, dx, dy)`**: 外接矩形がグリッド内に収まる最大の (dx,dy) を返す。
   `docOps.translateRoom` と Canvas の moveOffset（プレビュー）の両方がこれを使う。pasteRoom も同じ関数で形を保ったまま内側へずらす。
   `pasteFurniture` は x,y を 0 以上かつ `GRID_W*cellMm - w` 以下にクランプ。
   App: 部屋を貼り付けたら `setMode('move')` にして貼付した部屋を選択（重なりは編集へ戻る時に解決＝既存設計）。
   同コミットで **文書を離れる経路の統一**: `switchPlan`/`addPlan`/`importSharedPlan`/タブ追加系が、移動モード中なら
   `ops.resolveOverlaps(presentRef.current, floor)` を同期で計算した文書を保存する（commit の非同期結果を読まない）。
   経路を `leaveCurrentDoc(): Doc` のような1関数に寄せる。
2. **`src/state/openingOps.ts`**（@owns 開口部(ドア/窓)と壁の対応: ホスト判定・形変更への追随・孤立除去）:
   - `hostOf(f, o)`: 開口部を壁として持つ部屋と、その部屋から見た向き（N/E/S/W）。cell(cx,cy) が部屋に属し隣が属さない → その向き、
     逆なら反対向き。どの部屋にも属さなければ null。
   - `reconcileOpenings(before: FloorData, after: FloorData, roomId): Opening[]`: roomId の形が before→after へ変わった時、
     before で roomId が持っていた開口部のうち after で壁でなくなったものを、**after の同じ向きの境界辺のうち最も近いもの**
     （垂直方向の差を優先、同点なら辺方向の差）へ移す。候補が無ければ削除。他の部屋の開口部は触らない。
   - `pruneOrphans(f): FloorData`: どの部屋の壁でもなくなった開口部を削除。
   docOps: `setRoomShape`/`expandRoom`/`shrinkRoom` は reconcile を通す。`deleteRoom`/`resolveOverlaps` は prune を通す。
   移動モード中（translateRoom）は従来どおり（重なり中は判定しない）。
   テスト: 辺を外へ2マス伸ばすとドアが新しい壁へ移る／矩形の角ドラッグで辺上の窓が同じ向きの辺へ移る／部屋削除でドアが消える／
   共有壁のドアは隣室が残る限り消えない。
3. **useHistory の連続入力まとめ**: `commit(next, mergeKey?: string)`。直前のコミットと同じ mergeKey で 1500ms 以内なら
   past を増やさず present だけ置換（`now` は updater の外で取る）。undo/redo/reset でキーを忘れる。
   適用: 部屋名・部屋色・家具名/色/幅/奥行・種別名/色・設定の壁厚/マス。キーは `room-name:<id>` 等 id 付き。
   受入: 部屋作成→9文字入力で Undo 2回。
4. **`src/components/NumberField.tsx`**（@owns 数値の自由入力欄）: FurniturePanel の実装を部品化（`type="text" inputMode="numeric"`、
   min/max、有効値だけ `onCommit`、blur で無効なら元値へ）。FurniturePanel・SettingsDialog（壁厚 50〜400・マス 100〜1000）・
   OpeningDialog（100〜4000）で使う。幅変更の `window.prompt` も 100〜4000 を検査。
5. **キー操作**: モーダル（部屋作成・設定・共有・ドア窓）やメニューが開いている間はショートカットを無視。Esc は開いている
   モーダル/メニューを閉じる（開いていなければ従来どおり選択解除）。
6. ui_check に「端の外へ移動」「モーダル中の Delete」「設定欄を空にしても値が飛ばない」「入力の Undo 回数」を追加。
   BUGLOG（B3 B6 B7 B8 B11 B12）、WORKLOG、push。

## バッチ3: 機能追加（F1〜F5、共有URL B9、スマホ B10、保守）

1. **間取りの複製（F1）**: PlanTabs のアクティブタブに「⧉」ボタン（title「この間取りを複製」）。名前 `<名前> のコピー`。
   文書は JSON 往復で深いコピー（id は新規）。複製直後にそのタブへ切替。
2. **ヘッダー整理とファイル操作（F3）**: 「エクスポート／インポート」を「💾 ファイル ▾」メニュー（既存 `.context-menu` の見た目を流用）に:
   `この間取りを書き出し (JSON)`／`全部まとめてバックアップ (JSON)`／`ファイルから読み込み…（新しいタブに追加）`。
   読み込み結果は「N件の間取りを追加しました」をトーストか alert で出す。
3. **印刷（F2）**: ヘッダーに「🖨 印刷」。`src/components/PrintSheet.tsx`（@owns 印刷用レイアウト）。
   画面では非表示、`@media print` で `.app` を隠し PrintSheet だけ表示。部屋がある階ごとに1ページ:
   見出し「<間取り名> <n>階」、Canvas を **読み取り専用・全体フィット**で描画（Canvas に `fit?: {minX,minY,w,h}` を足し、
   指定時は `viewBox` とパーセント幅で描く。ハンドル・選択表示は出さない）、下に部屋一覧（名前・種別・㎡・畳）と階/延床面積。
   `print-color-adjust: exact` を明示。部屋の色が印刷に出ること。
4. **ドア／窓のツールバーボタン（F4）**: 「🚪 ドア／窓を追加」。既存の右クリックメニューと同じ OpeningDialog を開く。
   ツールバーのヒント文にもドア/窓・右クリックの案内を足す。
5. **共有URLの基底（B9）**: constants に `PUBLIC_APP_URL = 'https://neguracg.github.io/MadoriSimulator/'`。
   `buildShareUrl` は hostname が localhost/127.0.0.1/[::1] または file: のとき PUBLIC_APP_URL を基底にする。
   ShareDialog にその旨の注記（「ローカル起動中のため公開版のURLで作成しています」）。テスト: 基底の切替。
6. **スマホ（F5/B10）**: `@media (max-width: 820px)` で `.body` を縦並び（キャンバス→ツールバー→右パネル。キャンバスの高さは 55vh）、
   ヘッダーは折返し。ズーム欄に「全体」ボタン（内容の外接矩形が表示域に収まる zoom を選び、その位置へスクロール）。
   2本指パン: `src/hooks/useTwoFingerPan.ts`（@owns タッチ2本指でのキャンバススクロール）を `.center` に付け、
   2本目の pointerdown で Canvas の進行中ジェスチャを中断（Canvas は `panning` 中の pointer イベントを無視）。
   受入: 390x844 で `.center` の幅が 390 になりキャンバスが見える（スクショ `docs/shots/sp_*.png`）。
7. **別タブとの統合**: `storage` イベントで保存キーが変わったら、未知の id の間取りをこのタブへ追加（削除は反映しない）。
8. **保守**: `vite.config.ts` に `strictPort: true`。`起動.bat` はポートが使えない時のメッセージ
   （「既に起動中なら http://localhost:5173 を開いてください」）。`tsconfig.tsbuildinfo` を `.gitignore` へ追加し `git rm --cached`。
9. ui_check に複製・ファイル読込・スマホ幅・共有URL・印刷（`page.emulate_media(media="print")` でスクショ）を追加。
   BUGLOG（B9 B10）、WORKLOG、push。

## バッチ4: 文書の最新化

1. README を書き直す（正本宣言1行「機能の正本はこの README、時系列は docs/WORKLOG.md、不具合は docs/BUGLOG.md、設計判断は docs/KANSA_20260928.md §4」）。
   章: 何のツールか／使い方（公開URL・起動.bat・データはブラウザ内保存＝バックアップ推奨・ポート注意）／機能一覧（部屋・移動・ドア窓・家具・
   コピー貼付・タブ・複製・共有QR・印刷・ファイル）／ショートカット／開発（build・test・ui_check・deploy）／既知の制約。
   日付付き見出しや変更履歴を README に書かない。
2. docs/KANSA_20260928.md 冒頭の「状態」行を「修正完了（バッチ1〜4）」へ更新し、各所見に対応コミットを1語で添える。
3. WORKLOG 1行、push。
