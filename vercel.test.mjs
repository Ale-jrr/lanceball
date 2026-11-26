import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildSite } from './build-site.mjs';
import { edgeHandler } from './supabase/functions/_shared/edge-handler.mjs';

test('o chat recebe mensagens no leilão com o painel aberto ou fechado', async () => {
  function element() {
    return {
      children: [], hidden: true, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      get childElementCount() { return this.children.length; },
      setAttribute() {}, addEventListener() {},
      show() { this.open = true; },
    };
  }
  const elements = new Map();
  const wrapper = element();
  const launcher = element();
  const toggle = element();
  const badge = element();
  toggle.querySelector = selector => selector === '.chat-count' ? badge : null;
  elements.set('.chat-toggle', toggle);
  elements.set('.chat-count', badge);
  wrapper.querySelector = selector => {
    if (launcher.children.length && ['.chat-toggle', '.chat-count'].includes(selector)) return null;
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  let poll;
  let messages = [];
  const script = await readFile(new URL('./room-chat.mjs', import.meta.url), 'utf8');
  runInNewContext(script.replace(/^import .+\r?\n/, ''), {
    URLSearchParams, Intl, AbortSignal, location: { search: '?room=ABCD1234' },
    localStorage: { getItem: () => 'guest' },
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { body: element(), createElement: tag => tag === 'div' && !elements.has('dialog') ? wrapper : element(), querySelector: () => launcher, addEventListener() {} },
    window: { addEventListener() {} },
    matchMedia: () => ({ matches: false }),
    clearInterval() {}, setInterval: callback => { poll = callback; },
    liveUpdates: () => () => {},
    arenaFetch: async (_path, options) => {
      assert.equal(options.method, 'GET');
      return Response.json({ messages });
    },
  });
  await poll();
  messages = [{ id: 'new', name: 'Anfitrião', time: Date.now(), text: 'Boa partida!' }];
  await poll();
  assert.equal(elements.get('.chat-count').hidden, false);
  assert.equal(elements.get('.chat-count').textContent, '1');
  assert.equal(elements.get('ol').children[0].children[1].textContent, 'Boa partida!');
  elements.get('.chat-toggle').onclick();
  assert.equal(elements.get('.chat-count').hidden, true);
  await new Promise(resolve => setImmediate(resolve));
  messages.push({ id: 'another', name: 'Anfitrião', time: Date.now(), text: 'Mais uma mensagem' });
  await poll();
  assert.equal(elements.get('ol').children.at(-1).children[1].textContent, 'Mais uma mensagem');
  assert.equal(elements.get('.chat-count').hidden, true);
});

test('a hospedagem estática leva apenas a conexão pública ao navegador', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanceball-build-'));
  try {
    const env = {
      VERCEL: '1', LANCEBALL_SUPABASE_URL: 'https://example.supabase.co',
      LANCEBALL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_never_export',
    };
    await buildSite(dir, env);
    const config = await readFile(join(dir, 'edge-config.mjs'), 'utf8');
    assert.match(config, /sb_publishable_test/);
    assert.doesNotMatch(config, /sb_secret_/);
    for (const file of ['index.html', 'sala/index.html', 'leilao/index.html', 'pos-leilao/index.html',
      'health/index.html']) {
      const page = await readFile(join(dir, file), 'utf8');
      assert.match(page, /client-api.mjs/);
      const header = page.match(/<header class="arena-header">[\s\S]*?<\/header>/)?.[0];
      if (header) assert.doesNotMatch(header, /href="\/(?:campeonato|leilao)"/);
    }
    await assert.rejects(readFile(join(dir, 'campeonato/index.html')), { code: 'ENOENT' });
    await assert.rejects(buildSite(dir, { ...env, LANCEBALL_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test' }), /chave pública/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a Edge Function autoriza o jogador por sala e emite apenas um aviso sem o estado privado', async () => {
  const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
  const sessions = new Map();
  const signals = [];
  const store = {
    players: async () => catalog.players,
    list: async () => [],
    load: async id => structuredClone(sessions.get(id) ?? null),
    signal: async code => { signals.push(code); },
    async save(id, previous, data) {
      if (previous?.revision !== sessions.get(id)?.revision) return false;
      if (data) sessions.set(id, { ...structuredClone(data), revision: crypto.randomUUID() });
      else sessions.delete(id);
      return true;
    },
  };
  const hostInstance = edgeHandler(store);
  const guestInstance = edgeHandler(store);
  async function ask(handler, route, { token, room, method, body } = {}) {
    const url = new URL('https://example.supabase.co/functions/v1/lanceball');
    url.searchParams.set('route', route);
    if (room) url.searchParams.set('room', room);
    return handler(new Request(url, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: token ? { 'x-lanceball-token': token } : {},
      body: body ? JSON.stringify(body) : undefined,
    }));
  }
  const preflight = await ask(hostInstance, '/room', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-lanceball-token/);
  const health = await ask(hostInstance, '/health');
  assert.equal((await health.json()).servidor, 'Edge Function');
  const created = await ask(hostInstance, '/rooms', { body: {
    name: 'Arena', team: 'Anfitrião', identity: 'Porto', mode: 'ucl', size: 4,
  } });
  const { code: room, token } = await created.json();
  const joined = await ask(guestInstance, '/room', { room, body: { action: 'join', team: 'Amigo', identity: 'PSG' } });
  assert.equal(joined.status, 200);
  const guest = (await joined.json()).token;
  assert.equal((await ask(hostInstance, '/room', { room, token, body: { action: 'start' } })).status, 200);
  assert.equal((await ask(guestInstance, '/state', { room })).status, 401);
  const state = await (await ask(guestInstance, '/state', { room, token: guest })).json();
  assert.equal(state.yourTeamId, 1);
  assert.ok(!JSON.stringify(state).includes(token));
  assert.equal(state.state.queue, undefined);
  assert.equal(state.state.catalog.players.length, 1);
  assert.ok(signals.length >= 2 && signals.every(code => code === room));

  const withEmptyCatalog = edgeHandler({ ...store, players: async () => [] });
  const second = await ask(withEmptyCatalog, '/rooms', { body: {
    name: 'Arena 2', team: 'Outro anfitrião', identity: 'Porto', mode: 'ucl', size: 4,
  } });
  const another = await second.json();
  const blocked = await ask(withEmptyCatalog, '/room', {
    room: another.code, token: another.token, body: { action: 'start' },
  });
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).code, 'catalog_missing');
  assert.equal((await ask(withEmptyCatalog, '/room', { room: another.code })).status, 200);

  const bundled = JSON.parse(await readFile(
    new URL('./supabase/functions/_shared/catalog-bundled.json', import.meta.url), 'utf8',
  ));
  assert.deepEqual(bundled.players, catalog.players);
  const imports = [];
  const fallback = edgeHandler({
    ...store, players: async () => [],
    seed: async (players, options) => { imports.push({ players, options }); },
  }, () => {}, bundled);
  const started = await ask(fallback, '/room', {
    room: another.code, token: another.token, body: { action: 'start' },
  });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).started, true);
  assert.equal(imports[0].players.length, 908);
  assert.equal(imports[0].options.preserveExisting, true);
  const stateWithFallback = await ask(fallback, '/state', { room: another.code, token: another.token });
  assert.equal((await stateWithFallback.json()).state.totalPlayers, 28);
});

test('successive realtime notices keep the earliest refresh and channel failures reconnect', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = (await readFile(new URL('./client-api.mjs', import.meta.url), 'utf8'))
    .replace(/^import .*;$/m, '').replaceAll('export function ', 'function ');
  let now = 0;
  let id = 0;
  let refreshes = 0;
  const timers = new Map();
  const sockets = [];
  class Socket {
    constructor() { sockets.push(this); }
    close() { this.onclose?.(); }
  }
  const context = {
    connection: { url: 'https://example.supabase.co', publicKey: 'test' },
    WebSocket: Socket, URL, URLSearchParams, performance: { now: () => now },
    setTimeout(fn, ms) { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout(timer) { timers.delete(timer); },
    clearInterval() {},
  };
  const update = runInNewContext(source + '\nliveUpdates', context);
  const stop = update('ABCD', async () => { refreshes++; }, () => 4500);
  const receive = (event, payload, ref) => sockets[0].onmessage({
    data: JSON.stringify({ topic: 'realtime:lanceball-ABCD', event, ref, payload }),
  });
  const advance = async until => {
    const next = [...timers.entries()].filter(([, entry]) => entry.at <= until).sort((a,b) => a[1].at - b[1].at)[0];
    if (next) { timers.delete(next[0]); now = next[1].at; await next[1].fn(); }
    now = until;
  };
  await advance(0);
  receive('phx_reply', { status: 'ok' }, '1');
  await advance(30);
  receive('broadcast', { event: 'changed' });
  await advance(60);
  receive('broadcast', { event: 'changed' });
  await advance(80);
  assert.equal(refreshes, 3);
  receive('phx_error', {});
  for (let i = 0; i < 3; i++) await advance(600);
  assert.equal(sockets.length, 2);
  stop();
});
