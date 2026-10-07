// @owns 一時的な通知文の状態（出して数秒で消える。保存失敗のように消えない警告は対象外）
import { useCallback, useEffect, useRef, useState } from 'react';

/** `[message, show]`: show(text) displays the text and hides it again after `ms`; a newer text replaces the older one. */
export function useNotice(ms = 4000): [string | null, (text: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback(
    (text: string) => {
      window.clearTimeout(timer.current);
      setMessage(text);
      timer.current = window.setTimeout(() => setMessage(null), ms);
    },
    [ms],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [message, show];
}
