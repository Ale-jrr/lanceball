import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from './build-site.mjs';
import { edgeHandler } from './supabase/functions/_shared/edge-handler.mjs';

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
