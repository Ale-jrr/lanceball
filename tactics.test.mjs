import assert from 'node:assert/strict';
import test from 'node:test';
import { postAuction } from './supabase/functions/_shared/post-auction.mjs';
import { decisiveShot, playSeason } from './supabase/functions/_shared/tournament.mjs';

const teams = Array.from({ length: 4 }, (_, id) => ({
  id, name: 'Equipe ' + id, bot: id > 1, tactic: 'Equilibrada',
  players: ['GK','DEF','DEF','MID','MID','FWD','FWD']
    .map((position, index) => ({
      id: id + ':' + index, name: 'Atleta ' + index, position, overall: 85,
      rating: 85, role: position,
    })),
}));

test('a troca manual preserva lances anteriores e partidas simultâneas', () => {
  const inputs = teams.map(team => ({ ...team, lineup: team.players }));
  const before = playSeason('ucl', inputs, undefined, { seed: 128 });
  const game = before.rounds[0].games[0];
  const other = before.rounds[0].games[1];
  const after = playSeason('ucl', inputs, undefined, { seed: 128, changes: {
    [game.id]: [{ minute: 46, teamId: game.home.id, tactic: 'Posse de bola' }],
  } });
  const changed = after.rounds[0].games[0];
  assert.deepEqual(changed.events.filter(event => event.minute <= 45),
    game.events.filter(event => event.minute <= 45));
  assert.deepEqual(after.rounds[0].games[1], other);
  assert.ok(changed.events.some(event => event.minute === 46 && event.text.includes('Posse de bola')));
  assert.ok(changed.possession > game.possession);
});

test('o relógio aplica somente comandos do próprio participante', () => {
  const room = {
    mode: 'ucl', members: [{ id: 0, token: 'test-0' }, { id: 1, token: 'test-1' }],
    auction: { snapshot: () => ({ complete: true, teams }) },
  };
  const call = (action, input = {}, actor = 0, now = 0) => postAuction(room, action, input, actor, now);
  call('lineup', {}, 0);
  const opened = call('lineup', {}, 1);
  assert.deepEqual(opened.pendingLineupTeamIds, [0, 1]);
  for (const actor of [0, 1]) {
    const view = call('read', {}, actor);
    const submitted = call('simulate', { formation: '2-2-2', tactic: 'Equilibrada', ids: view.auto['2-2-2'] }, actor);
    assert.deepEqual(submitted.pendingLineupTeamIds, actor === 0 ? [1] : []);
  }
  const initial = call('read');
  const game = initial.season.rounds[0].games.find(entry => entry.home.id === 0 || entry.away.id === 0);
  assert.equal(initial.clock.canChangeTactic, false);
  assert.ok(initial.season.rounds.slice(1).every(round => round.games.length === 0));
  assert.equal(game.score, undefined);
  assert.throws(() => call('tactic', { matchId: game.id, tactic: 'Ofensiva' }), /durante/);
  call('clock', { command: 'toggle' });
  const before = call('read', {}, 0, 420 * 12);
  const beforeGame = before.season.rounds[0].games.find(entry => entry.id === game.id);
  assert.throws(() => call('tactic', { matchId: game.id, tactic: 'Ofensiva' }, 1, 420 * 12), /durante/);
  const pending = call('tactic', { matchId: game.id, tactic: 'Ofensiva' }, 0, 420 * 12);
  assert.equal(pending.clock.currentTactic, 'Equilibrada');
  assert.equal(pending.clock.pendingTactic, 'Ofensiva');
  assert.deepEqual(pending.season.rounds[0].games.find(entry => entry.id === game.id).events, beforeGame.events);
  const applied = call('read', {}, 0, 420 * 13);
  assert.equal(applied.clock.currentTactic, 'Ofensiva');
  assert.equal(applied.clock.pendingTactic, undefined);
  assert.equal(call('read', {}, 1, 420 * 13).clock.currentTactic, 'Equilibrada');
  call('clock', { command: 'skip' }, 0, 420 * 13);
  assert.throws(() => call('tactic', { matchId: game.id, tactic: 'Defensiva' }, 0, 420 * 13), /durante/);
  call('clock', { command: 'next' }, 0, 420 * 13);
  assert.equal(call('read', {}, 0, 420 * 13).clock.currentTactic, 'Equilibrada');
});

test('vinhetas revelam classificados só após a fase correspondente', () => {
  const soloTeams = teams.map(team => ({ ...team, bot: team.id !== 0 }));
  const room = {
    mode: 'ucl', auction: { snapshot: () => ({ complete: true, teams: soloTeams }) },
  };
  const lineup = postAuction(room, 'lineup');
  let view = postAuction(room, 'simulate', {
    formation: '2-2-2', tactic: 'Equilibrada', ids: lineup.auto['2-2-2'],
  });
  const seen = new Map();
  for (let index = 0; index < view.season.rounds.length; index++) {
    const round = view.season.rounds[index];
    const initialCount = seen.size;
    assert.equal(view.highlights.length, initialCount);
    view = postAuction(room, 'clock', { command: 'skip' });
    for (const highlight of view.highlights) {
      if (!seen.has(highlight.id)) seen.set(highlight.id, { highlight, round });
    }
    view = postAuction(room, 'clock', { command: 'next' });
  }
  assert.deepEqual([...seen.keys()], ['semifinals', 'final', 'champion']);
  assert.deepEqual([...seen.values()].map(({ highlight }) => highlight.teams.length), [4, 2, 1]);
  assert.equal(seen.get('semifinals').round.name, 'Liga');
  assert.equal(seen.get('final').round.name, 'Semifinais · Volta');
  assert.equal(seen.get('champion').highlight.teams[0].name, view.season.champion);
});

test('chutes decisivos destacam chances de empate ou vantagem no fim', () => {
  assert.equal(decisiveShot(79, 0), null);
  assert.equal(decisiveShot(80, -1), 'equalizer');
  assert.equal(decisiveShot(89, 0), 'lead');
  assert.equal(decisiveShot(90, -2), null);
  assert.equal(decisiveShot(91, 0), null);
  assert.equal(decisiveShot(110, 0), 'lead');
  const inputs = teams.map(team => ({ ...team, lineup: team.players }));
  const season = playSeason('ucl', inputs, () => .01);
  assert.ok(season.rounds.flatMap(round => round.games).some(game =>
    game.events.some(event => event.highlight?.outcome === 'goal')));
});


test('all supported sizes complete the league and seeded knockout bracket', () => {
  for (const size of [4, 8, 16, 32, 64]) {
    const participants = Array.from({ length: size }, (_, id) => ({
      ...teams[0], id, name: 'Team ' + id, lineup: teams[0].players,
    }));
    const season = playSeason('ucl', participants, undefined, { seed: 42 });
    const league = season.rounds.filter(round => round.name === 'Liga');
    assert.equal(league.length, Math.min(8, size - 1));
    let entries = size;
    const knockout = season.rounds.slice(league.length);
    assert.equal(knockout.length, 2 * Math.log2(size) - 1);
    for (let index = 0; index < knockout.length - 1; index += 2) {
      const [first, second] = knockout.slice(index, index + 2);
      assert.equal(first.games.length, entries / 2);
      assert.equal(new Set(first.games.flatMap(game => [game.home.id, game.away.id])).size, entries);
      second.games.forEach((game, tie) => {
        assert.equal(game.home.id, first.games[tie].away.id);
        assert.equal(game.away.id, first.games[tie].home.id);
        assert.deepEqual(game.carry, [...first.games[tie].score].reverse());
        assert.ok(game.winner);
      });
      entries /= 2;
    }
    const [final] = knockout.at(-1).games;
    assert.equal(final.stage, 'Final');
    assert.equal(season.champion, final.winner.name);
  }
});
