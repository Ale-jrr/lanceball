import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { openAuction } from './auction.mjs';
import { publicAuction, resolveAuctionPlayer } from './supabase/functions/_shared/auction-view.mjs';

const catalog = {
  edition: 'synthetic-test-v1',
  source: 'Dados sintéticos de teste',
  players: Object.entries({ GK: 8, DEF: 16, MID: 16, FWD: 16 }).flatMap(
    ([position, count]) => Array.from({ length: count }, (_, index) => ({
      id: `${position}-${index}`, name: `Atleta teste ${position} ${index}`, position, overall: 70,
    })),
  ),
};

function contender(path, teamId, deadline) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { openAuction } from './auction.mjs';
import { publicAuction, resolveAuctionPlayer } from './supabase/functions/_shared/auction-view.mjs';
      const [path, teamId, deadline] = process.argv.slice(1);
      const auction = openAuction(path, () => Number(deadline) - 1);
      try { auction.bid(Number(teamId), 'GK-0', 93); }
      catch (error) {
        if (error.message !== 'Lance inválido') throw error;
        process.exitCode = 2;
      } finally { auction.close(); }
    `, path, String(teamId), String(deadline)], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('exit', resolve);
  });
}

test('oito equipes completam elencos após concorrência e reabertura', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'football-auction-'));
  const path = join(dir, 'auction.sqlite');
  let now = 1000;
  let auction = openAuction(path, () => now);
  try {
    assert.throws(() => auction.start({ ...catalog, players: catalog.players.slice(1) }), /GK/);
    auction.start(catalog);
    const { round } = auction.tick();
    assert.equal(round.highest, null);
    assert.throws(() => auction.bid(0, 'GK-0', 95), /Lance inválido/);
    const codes = await Promise.all(Array.from({ length: 8 }, (_, id) =>
      contender(path, id, round.deadline)));
    assert.deepEqual(codes.sort(), [0, 2, 2, 2, 2, 2, 2, 2]);

    const extended = auction.snapshot().round.deadline;
    assert.equal(extended, round.deadline + 3000);
    now = round.deadline;
    assert.equal(auction.tick().round.deadline, extended);
    const leader = auction.snapshot().round.highest.teamId;
    auction.bid((leader + 1) % 8, 'GK-0', 94);
    assert.equal(auction.snapshot().round.deadline, extended + 3000);
    now = extended + 3000;
    assert.throws(() => auction.bid(7, 'GK-0', 32), /Rodada indisponível/);
    auction.close();
    auction = openAuction(path, () => now);
    assert.equal(auction.snapshot().bids.length, 2);
    assert.equal(auction.tick().purchases.length, 1);
    assert.equal(auction.tick().purchases.length, 1);

    let state = auction.snapshot();
    while (!state.complete) {
      now = state.round.deadline;
      state = auction.tick();
    }
    assert.equal(state.purchases.length, 56);
    assert.equal(new Set(state.purchases.map(purchase => purchase.playerId)).size, 56);
    assert.equal(state.purchases.filter(purchase => purchase.method === 'allocation').length, 55);
    for (const team of state.teams) {
      for (const [position, count] of Object.entries({ GK: 1, DEF: 2, MID: 2, FWD: 2 })) {
        assert.equal(team.players.filter(player => player.position === position).length, count);
      }
      assert.ok(team.balance >= 0);
      assert.equal(team.balance + state.purchases.filter(purchase => purchase.teamId === team.id)
        .reduce((total, purchase) => total + purchase.amount, 0), 100);
    }
    assert.deepEqual(auction.tick(), state);
  } finally {
    auction.close();
    rmSync(dir, { recursive: true });
  }
});



test('passar é visível na rodada e preserva o lance já feito', () => {
  let now = 0;
  const auction = openAuction(':memory:', () => now);
  try {
    auction.start(catalog);
    const { round } = auction.tick();
    auction.bid(0, round.player.id, 5);
    const before = auction.snapshot().round;
    auction.pass(0, round.player.id);
    auction.pass(0, round.player.id);
    assert.deepEqual(auction.snapshot().round, { ...before, passed: [0] });
    assert.throws(() => auction.bid(0, round.player.id, 6), /já passou/);
    now = before.deadline;
    const next = auction.tick();
    assert.equal(next.purchases[0].teamId, 0);
    assert.deepEqual(next.round.passed, []);
  } finally {
    auction.close();
  }
});


test('a carta surpresa revela identidade e overall apenas depois do prazo', () => {
  let now = 0;
  const auction = openAuction(':memory:', () => now);
  try {
    auction.start(catalog, undefined, undefined, { surpriseAt: 1 });
    const initial = auction.tick();
    assert.equal(publicAuction(initial).catalog.players.length, 1);
    now = initial.round.deadline;
    const state = auction.tick();
    const hidden = state.round.player;
    const view = publicAuction(state);
    const ref = view.round.player.id;
    const asJson = JSON.stringify(view);
    assert.notEqual(ref, hidden.id);
    assert.ok(view.round.clue);
    assert.equal(view.round.player.overall, undefined);
    assert.equal(view.round.player.name, undefined);
    assert.ok(!asJson.includes(hidden.name));
    assert.ok(!asJson.includes(JSON.stringify(hidden.id)));
    assert.equal(resolveAuctionPlayer(state.round, hidden.id), null);
    assert.equal(resolveAuctionPlayer(state.round, ref), hidden.id);
    auction.bid(2, resolveAuctionPlayer(state.round, ref), 7);
    const bidding = publicAuction(auction.snapshot());
    assert.equal(bidding.bids[0].playerId, ref);
    assert.equal(bidding.lastClosed, null);
    now = bidding.round.deadline;
    const revealed = publicAuction(auction.tick());
    assert.equal(revealed.lastClosed.player.name, hidden.name);
    assert.equal(revealed.lastClosed.player.overall, hidden.overall);
    assert.equal(revealed.lastClosed.highest.teamId, 2);
    assert.equal(revealed.purchases[0].playerId, hidden.id);
  } finally {
    auction.close();
  }
});

test('lances adicionam até três segundos com teto de seis e preservam o prazo inicial', () => {
  let now = 0;
  const auction = openAuction(':memory:', () => now);
  try {
    auction.start(catalog);
    const { round } = auction.tick();
    const id = round.player.id;
    auction.bid(0, id, 1);
    assert.equal(auction.snapshot().round.deadline, 10000);
    now = 6000;
    auction.bid(1, id, 2);
    assert.equal(auction.snapshot().round.deadline, 12000);
    auction.bid(2, id, 3);
    assert.equal(auction.snapshot().round.deadline, 12000);
    now = 11000;
    assert.throws(() => auction.bid(2, id, 4), /seu lance já está na frente/i);
    assert.equal(auction.snapshot().round.deadline, 12000);
    assert.equal(auction.snapshot().bids.length, 3);
    auction.bid(3, id, 4);
    assert.equal(auction.snapshot().round.deadline, 15000);
  } finally {
    auction.close();
  }
});

test('bots valorizam overall, preenchem posições e reservam saldo para as vagas', async () => {
  const { botBidLimit } = await import('./supabase/functions/_shared/bot-bidding.mjs');
  const team = { id: 1, balance: 100, players: [] };
  const state = { rosterSize: 7, quotas: { GK: 1, DEF: 2, MID: 2, FWD: 2 },
    catalog: { players: Array(28) }, queue: Array(27), round: {} };
  const ordinary = { position: 'FWD', overall: 78 };
  const elite = { ...ordinary, overall: 91 };
  assert.ok(botBidLimit(state, team, elite) >= 12);
  assert.ok(botBidLimit(state, team, elite) <= 18);
  assert.ok(botBidLimit(state, team, ordinary) <= 8);
  const scarce = { ...state, teams: [team] };
  const plentiful = { ...scarce, queue: Array(27).fill(ordinary) };
  assert.ok(botBidLimit(scarce, team, ordinary) > botBidLimit(plentiful, team, ordinary));
  const lastVacancy = { ...team, balance: 50, players: Array(6).fill({ position: 'DEF' }) };
  const lastBid = botBidLimit(state, lastVacancy, elite);
  assert.ok(lastBid > 18 && lastBid < lastVacancy.balance);
  assert.ok(botBidLimit(state, team, elite) > botBidLimit(state, team, ordinary));
  assert.ok(botBidLimit(state, { ...team, balance: 10 }, elite) <= 4);
  assert.equal(botBidLimit(state, { ...team, players: [ordinary, ordinary] }, elite), 0);
  assert.equal(botBidLimit({ ...state, round: { clue: {} } }, team, elite),
    botBidLimit({ ...state, round: { clue: {} } }, team, ordinary));
});
