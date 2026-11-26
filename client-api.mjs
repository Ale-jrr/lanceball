import { connection } from './edge-config.mjs';

export function arenaFetch(path, options) {
  if (!connection) return fetch(path, options);
  const source = new URL(path, location.origin);
  const target = new URL('/functions/v1/lanceball', connection.url);
  target.search = source.search;
  target.searchParams.set('route', source.pathname);
  const headers = new Headers(options?.headers);
  const token = headers.get('Authorization');
  headers.delete('Authorization');
  if (token?.startsWith('Bearer ')) headers.set('X-Lanceball-Token', token.slice(7));
  headers.set('apikey', connection.publicKey);
  if (options?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(target, { ...options, headers });
}

export function liveUpdates(room, refresh, delay, channel = 'lanceball') {
  let running = false;
  let pending = false;
  let confirmed = false;
  let timer;
  let scheduledAt = Infinity;
  let heartbeat;
  let socket;
  let retries = 0;
  let open = true;
  let reconnect;

  function schedule(ms) {
    const deadline = performance.now() + ms;
    if (!open || deadline >= scheduledAt) return;
    clearTimeout(timer);
    scheduledAt = deadline;
    timer = setTimeout(update, ms);
  }

  function invalidate(ms) {
    if (running) pending = true;
    else schedule(ms);
  }

  async function update() {
    scheduledAt = Infinity;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try { await refresh(); }
    finally {
      running = false;
      schedule(pending ? 100 : delay(confirmed));
      pending = false;
    }
  }

  if (connection && room) {
    const endpoint = new URL('/realtime/v1/websocket', connection.url);
    endpoint.protocol = 'wss:';
    endpoint.search = new URLSearchParams({ apikey: connection.publicKey, vsn: '1.0.0' });
    const topic = 'realtime:' + channel + '-' + room.toUpperCase();
    let ref = 1;

    function connect() {
      if (!open) return;
      try { socket = new WebSocket(endpoint); }
      catch { retry(); return; }
      socket.onopen = () => {
        if (!open) { socket.close(); return; }
        socket.send(JSON.stringify({
          topic, event: 'phx_join', ref: '1',
          payload: { config: { broadcast: { ack: false, self: false }, private: false } },
        }));
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
            topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref),
          }));
        }, 25_000);
      };
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.topic !== topic) return;
        if (message.event === 'phx_reply' && message.ref === '1') {
          confirmed = message.payload?.status === 'ok';
          if (confirmed) { retries = 0; invalidate(30); }
          else socket.close();
        } else if (message.event === 'phx_error' || message.event === 'phx_close') {
          socket.close();
        } else if (confirmed && message.event === 'broadcast' && message.payload?.event === 'changed') {
          invalidate(50);
        }
      };
      socket.onclose = () => {
        clearInterval(heartbeat);
        confirmed = false;
        if (open) { invalidate(100); retry(); }
      };
      socket.onerror = () => socket.close();
    }

    function retry() {
      reconnect = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(retries++, 5)));
    }

    connect();
  }
  schedule(0);
  return () => {
    open = false;
    clearTimeout(timer);
    clearTimeout(reconnect);
    clearInterval(heartbeat);
    socket?.close();
  };
}
