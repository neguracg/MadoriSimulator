// @owns ファイルメニューの項目（この間取りの書き出し・全部のバックアップ・ファイルからの読み込み）。実際の処理は App が持つ
interface Props {
  onExportPlan: () => void;
  onBackupAll: () => void;
  onImport: () => void;
}

/** The items of the file menu; rendered inside the shared `.context-menu` box. */
export default function FileMenu(props: Props) {
  return (
    <>
      <button onClick={props.onExportPlan}>この間取りを書き出し (JSON)</button>
      <button onClick={props.onBackupAll}>全部まとめてバックアップ (JSON)</button>
      <hr />
      <button onClick={props.onImport}>ファイルから読み込み…（新しいタブに追加）</button>
    </>
  );
}
