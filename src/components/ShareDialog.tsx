import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  url: string;
  planName: string;
  onClose: () => void;
}

export default function ShareDialog({ url, planName, onClose }: Props) {
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    QRCode.toDataURL(url, { width: 240, margin: 1, errorCorrectionLevel: 'L' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      inputRef.current?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const tooLong = url.length > 2000;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>「{planName}」を共有</h3>
        <p className="modal-area">
          このリンク/QRを送ると、相手の端末で同じ間取りが新しいタブとして開きます（サーバー不要）。
        </p>
        {qr && (
          <div className="qr-wrap">
            <img src={qr} alt="QR" width={200} height={200} />
            <span className="muted">スマホのカメラで読み取り</span>
          </div>
        )}
        <div className="share-url">
          <input ref={inputRef} readOnly value={url} onFocus={(e) => e.target.select()} />
          <button className="primary" onClick={copy}>
            {copied ? 'コピー済み' : 'コピー'}
          </button>
        </div>
        {tooLong && (
          <p className="op-hint">
            間取りが大きいためURLが長め（{url.length}文字）。一部の古い端末・アプリでは開けない場合があります。
          </p>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
