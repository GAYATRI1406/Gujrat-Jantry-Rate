import { useCallback, useEffect, useRef, useState } from 'react';

// WebSocket link to the browser agent: JSON messages for steps/results, binary messages for live frames.
export function useBot({ onMessage, onFrame }) {
  const [connected, setConnected] = useState(false);
  const socket = useRef(null);
  const handlers = useRef({ onMessage, onFrame });
  handlers.current = { onMessage, onFrame };

  useEffect(() => {
    let closed = false;
    let retry;
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws.binaryType = 'blob';
      socket.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') handlers.current.onMessage(JSON.parse(e.data));
        else handlers.current.onFrame(e.data);
      };
      ws.onclose = () => {
        setConnected(false);
        handlers.current.onMessage({ type: 'disconnected' });
        if (!closed) retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, []);

  const run = useCallback((query, address) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify({ type: 'run', query, address }));
    return true;
  }, []);

  return { connected, run };
}
