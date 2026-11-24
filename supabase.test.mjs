import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { openAuction } from './auction.mjs';
import { persistentHandler } from './supabase/functions/_shared/persistent-handler.mjs';
import { supabaseStore } from './supabase/functions/_shared/supabase-store.mjs';

test('clientes em instâncias separadas compartilham lances no Supabase', async () => {
  const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
  const rows = new Map();
  async function fakeRest(url, options) {
    assert.equal(options.headers.apikey, 'sb_secret_test');
    assert.equal(options.headers.Authorization, undefined);
    const query = url.searchParams;
    if (url.pathname === '/realtime/v1/api/broadcast') {
      const [message] = JSON.parse(options.body).messages;
      assert.match(message.topic, /^lanceball-[A-F0-9]{8}$/);
      assert.deepEqual(message, { topic: message.topic, event: 'changed', payload: {} });
      return Response.json({});
    }
    if (url.pathname.endsWith('/lanceball_players')) {
      const offset = Number(query.get('offset'));
      assert.equal(options.method, 'GET');
      return Response.json(catalog.players.slice(offset, offset + Number(query.get('limit'))));
    }
    if (!query.has('id') && options.method === 'GET') {
      return Response.json([...rows.values()].filter(row => row.public_info).map(row => ({
        public_info: row.public_info,
      })));
    }
    const patch = options.body ? JSON.parse(options.body) : null;
    const id = query.get('id')?.slice(3) ?? patch?.id;
    const record = rows.get(id);
    if (options.method === 'GET') return Response.json(record ? [record] : []);
    if (options.method === 'POST') {
      if (record) return Response.json({ error: 'duplicate' }, { status: 409 });
      rows.set(id, patch);
    } else {
      if (!record || 'eq.' + record.revision !== query.get('revision')) return Response.json([]);
      if (options.method === 'DELETE') rows.delete(id);
      else rows.set(id, { ...record, ...patch });
    }
    return Response.json([{ id }]);
  }
  const servers = Array.from({ length: 2 }, () => {
    const server = createServer(persistentHandler(supabaseStore('https://example.supabase.co', 'sb_secret_test', fakeRest)));
    server.listen(0, '127.0.0.1');
    return server;
  });
  await Promise.all(servers.map(server => once(server, 'listening')));

  async function request(instance, path, payload, token) {
    const url = 'http://127.0.0.1:' + servers[instance].address().port + path;
    const response = await fetch(url, {
      method: payload ? 'POST' : 'GET',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }

  try {
    const created = await request(0, '/rooms', {
      name: 'Arena', team: 'Anfitrião', identity: 'Porto', mode: 'ucl', size: 4,
    });
    assert.equal(created.status, 201);
    const { code, token: host } = created.data;
    const query = '?room=' + code;
    assert.equal((await request(1, '/rooms')).data[0].code, code);
    const joined = await request(1, '/room' + query, { action: 'join', team: 'Amigo', identity: 'PSG' });
    assert.equal(joined.status, 200);
    const guest = joined.data.token;
    assert.equal((await request(0, '/room' + query, { action: 'start' }, host)).status, 200);
    const initial = (await request(1, '/state' + query, undefined, guest)).data;
    assert.equal(initial.state.teams.length, 4);
    assert.equal(initial.yourTeamId, 1);
    assert.deepEqual((await request(1, '/rooms')).data, []);
    const playerId = initial.state.round.player.id;
    rows.get('room:' + code).payload.room.auction.round.deadline = Date.now() + 1500;
    const bids = await Promise.all([
      request(0, '/bid' + query, { teamId: 0, playerId, amount: 1 }, host),
      request(1, '/bid' + query, { teamId: 1, playerId, amount: 1 }, guest),
    ]);
    assert.deepEqual(bids.map(result => result.status).sort(), [200, 400]);
    const row = rows.get('room:' + code);
    assert.equal(row.payload.room.auction.bids.length, 1);
    assert.equal(row.payload.room.auction.round.highest.amount, 1);
    row.payload.room.auction.round.deadline = Date.now() - 1;
    const winner = (await request(1, '/state' + query, undefined, guest)).data.state.purchases[0];
    assert.equal(winner.amount, 1);
    const result = (await request(0, '/state' + query, undefined, host)).data.state;
    assert.equal(result.purchases.length, 1);
    assert.deepEqual(result.purchases[0], winner);
    assert.equal(result.teams[winner.teamId].balance, 99);

    // Move the shared draft to completion without waiting for every timer.
    const draft = rows.get('room:' + code).payload.room.auction;
    let clock = Date.now();
    const auction = openAuction(':memory:', () => clock, draft);
    try {
      let state = draft;
      while (!state.complete) {
        clock = state.round.deadline;
        state = auction.tick();
      }
      rows.get('room:' + code).payload.room.auction = state;
    } finally {
      auction.close();
    }
    const route = '/post-auction' + query;
    const rejected = await request(1, route, { action: 'close-trades' }, guest);
    assert.match(rejected.data.error, /anfitrião/);
    assert.equal((await request(1, route, undefined, guest)).data.stage, 'trades');
    assert.equal((await request(0, route, { action: 'lineup' }, host)).data.stage, 'trades');
    const closed = await request(0, route, { action: 'close-trades' }, host);
    assert.equal(closed.status, 200);
    assert.equal(closed.data.stage, 'lineup');
    assert.equal((await request(1, route, undefined, guest)).data.stage, 'lineup');
    const lateTrade = await request(1, route, { action: 'trade' }, guest);
    assert.match(lateTrade.data.error, /trocas foi encerrada/);
    for (const [instance, token] of [[0, host], [1, guest]]) {
      const view = (await request(instance, route, undefined, token)).data;
      const submitted = await request(instance, route, {
        action: 'simulate', formation: '2-2-2', tactic: 'Equilibrada', ids: view.auto['2-2-2'],
      }, token);
      assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    }
    const saved = rows.get('room:' + code).payload.room.post;
    assert.ok(saved.model);
    assert.equal(saved.season, undefined);
    const skip = await request(0, route, { action: 'clock', command: 'skip' }, host);
    const guestView = (await request(1, route, undefined, guest)).data;
    assert.equal(guestView.stage, 'tournament');
    assert.equal(guestView.clock.minute, 90);
    assert.deepEqual(guestView.season.rounds[0], skip.data.season.rounds[0]);
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
});
