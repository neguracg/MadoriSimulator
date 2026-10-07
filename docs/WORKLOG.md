# WORKLOG（作業ログ）

時系列の正本。1行 = 1作業単位。書式: `- YYYY-MM-DD | 内容 | 検証 | commit`
不具合は BUGLOG.md、設計判断は KANSA_20260928.md の設計方針、修正の指示書は SHIJI_20261007_kansa.md。

- 2026-10-07 | バッチ1（全体監査の B1 B2 B4 B5）: vitest 導入／normalizeDoc（state/migrate.ts）／保存・読込・取込を state/projectStore.ts へ引っ越し（backup-prev・corrupt 退避・保存失敗の赤い帯・インポートは新しいタブへ追加）／ドラッグ確定3箇所を state 更新関数の外へ（hooks/useLiveValue.ts）＋ linkedToRoomMove・cellOwnerMap に判定を集約／scripts/ui_check.py（dev・prod の E2E） | vitest 64件 PASS・npm run build OK・ui_check は dev 13/14・prod 13/14 PASS（失敗は B3 端の外へ移動＝バッチ2で対応。xfail にしていない）。修正前のコードに ui_check を当てると 14件中13件が失敗する（B1 画面が出ない・B2 タブが増えない・B4 家具が動かない・B5 Undo 3回/4回・B3 6マス）ことを確認 | c299be6 fc495b4 86723a8 6d654de
