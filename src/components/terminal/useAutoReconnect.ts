import { useEffect, useRef, useState } from 'react';
import { RECONNECT_DELAYS_S } from '../../services/appEvents';
import { AddEventLog } from './TerminalLogDialogs';

export function useAutoReconnect(addEventLog: AddEventLog) {
  // ---- Reconnect (T-016) ---------------------------------------------------
  // Restarts the session in this same terminal, like PuTTY's "Restart
  // Session": the scrollback stays and the new connection continues below.
  // restartSessionRef is filled in by the mount effect, which owns the
  // terminal and its output handler.
  const restartSessionRef = useRef<(() => Promise<void>) | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const [reconnectIn, setReconnectIn] = useState<number | null>(null);

  const cancelAutoReconnect = () => {
    if (reconnectTimerRef.current !== null) window.clearInterval(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    setReconnectIn(null);
  };

  const reconnectNow = () => {
    cancelAutoReconnect();
    void restartSessionRef.current?.();
  };

  const handleManualReconnect = () => {
    reconnectAttemptRef.current = 0;
    reconnectNow();
  };

  /**
   * After a drop from a live session: wait, then restart; the waits grow and
   * after the last one it stops, so a host that's gone isn't hammered.
   */
  const scheduleAutoReconnect = () => {
    const attempt = reconnectAttemptRef.current + 1;
    if (attempt > RECONNECT_DELAYS_S.length) {
      addEventLog(`Gave up reconnecting after ${RECONNECT_DELAYS_S.length} attempts`, 'warn');
      return;
    }
    reconnectAttemptRef.current = attempt;
    cancelAutoReconnect();
    let left = RECONNECT_DELAYS_S[attempt - 1];
    setReconnectIn(left);
    addEventLog(`Connection lost; reconnecting in ${left} s (attempt ${attempt} of ${RECONNECT_DELAYS_S.length})`, 'warn');
    reconnectTimerRef.current = window.setInterval(() => {
      left -= 1;
      if (left <= 0) reconnectNow();
      else setReconnectIn(left);
    }, 1000);
  };
  const scheduleAutoReconnectRef = useRef(scheduleAutoReconnect);
  scheduleAutoReconnectRef.current = scheduleAutoReconnect;
  useEffect(() => () => {
    if (reconnectTimerRef.current !== null) window.clearInterval(reconnectTimerRef.current);
  }, []);

  return {
    restartSessionRef, reconnectAttemptRef, reconnectIn,
    cancelAutoReconnect, reconnectNow, handleManualReconnect, scheduleAutoReconnectRef,
  };
}
