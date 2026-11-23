import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';
import lanceball from './api/lanceball.mjs';

test('a entrada da Vercel atende a página, os recursos e o leilão', async () => {
  const server = createServer(lanceball);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = 'http://127.0.0.1:' + server.address().port;
  function request(path, params = {}, options) {
    return fetch(root + '/api/lanceball?' + new URLSearchParams({ __arena_path: path, ...params }), options);
  }
  try {
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /LANCEBALL/);
    const css = await request('/arena.css');
    assert.match(css.headers.get('content-type'), /text\/css/);
    const image = await request('/arena-background.png');
    assert.match(image.headers.get('content-type'), /image\/png/);
    await image.arrayBuffer();
    const solo = { solo: '0d8d8f77-e870-4cff-8e3c-96b7ccc18a17', mode: 'ucl', size: 4, club: 'Porto', team: 'Arena' };
    const start = await request('/start', solo, { method: 'POST' });
    assert.equal(start.status, 200);
    const { state } = await start.json();
    assert.equal(state.roundNumber, 1);
    assert.equal(state.teams[0].balance, 100);
    const bid = await request('/bid', solo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 0, playerId: state.round.player.id, amount: 5 }),
    });
    assert.equal(bid.status, 200);
    assert.equal((await bid.json()).state.round.highest.amount, 5);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
