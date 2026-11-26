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

test('as rodadas começam após 15 segundos sem comando do anfitrião', () => {
  const room = {
    mode: 'ucl', members: [{ id: 0, token: 'test-0' }, { id: 1, token: 'test-1' }],
    auction: { snapshot: () => ({ complete: true, teams }) },
  };
  const guestClock = now => postAuction(room, 'read', {}, 1, now).clock;
  for (const actor of [0, 1]) {
    const view = postAuction(room, 'read', {}, actor, 0);
    postAuction(room, 'simulate', { formation: '2-2-2', tactic: 'Equilibrada', ids: view.auto['2-2-2'] }, actor, 0);
  }
  assert.equal(guestClock(0).startsIn, 15);
  assert.equal(guestClock(14_999).playing, false);
  assert.equal(guestClock(15_000).playing, true);
  assert.equal(guestClock(15_420).minute, 1);
  const finishedAt = 15_000 + 90 * 420;
  assert.equal(guestClock(finishedAt).startsIn, 15);
  assert.equal(guestClock(finishedAt + 14_999).round, 0);
  const next = guestClock(finishedAt + 15_000);
  assert.equal(next.round, 1);
  assert.equal(next.playing, true);
  const stale = postAuction(room, 'clock', { command: 'toggle', round: 0 }, 0, finishedAt + 15_001);
  assert.equal(stale.clock.playing, true);
});

test('Liga e Champions premiam os líderes de gols e assistências ao final', () => {
  for (const mode of ['league', 'ucl']) {
    const soloTeams = teams.map(team => ({ ...team, bot: team.id !== 0 }));
    const room = { mode, auction: { snapshot: () => ({ complete: true, teams: soloTeams }) } };
    const call = (action, input) => postAuction(room, action, input, 0, 0);
    const lineup = call('read');
    let view = call('simulate', { formation: '2-2-2', tactic: 'Equilibrada', ids: lineup.auto['2-2-2'] });
    for (const [index] of view.season.rounds.entries()) {
      assert.equal(view.season.leaders, undefined);
      view = call('clock', { command: 'skip' });
      if (index < view.season.rounds.length - 1) view = call('clock', { command: 'next' });
    }
    const goals = view.season.rounds.flatMap(round => round.games.flatMap(game =>
      game.events.filter(event => event.scorer).map(event => ({ event, team: event.side === 0 ? game.home : game.away }))));
    for (const { event, team } of goals) {
      if (!event.assistant) continue;
      assert.notEqual(event.scorer.id, event.assistant.id);
      assert.ok(team.lineup.some(player => player.id === event.assistant.id));
    }
    for (const [award, field] of [['goals', 'scorer'], ['assists', 'assistant']]) {
      const totals = new Map();
      for (const { event, team } of goals) {
        const player = event[field];
        if (!player) continue;
        const key = team.name + ' ' + player.name;
        totals.set(key, (totals.get(key) ?? 0) + 1);
      }
      const highest = Math.max(0, ...totals.values());
      assert.deepEqual(view.season.leaders[award].map(entry => [entry.team + ' ' + entry.name, entry.count]),
        [...totals].filter(([, count]) => count === highest));
    }
  }
});

test('o relógio aplica somente comandos do próprio participante', () => {
  const room = {
    mode: 'ucl', members: [{ id: 0, token: 'test-0' }, { id: 1, token: 'test-1' }],
    auction: { snapshot: () => ({ complete: true, teams }) },
  };
  const call = (action, input = {}, actor = 0, now = 0) => postAuction(room, action, input, actor, now);
  const opened = call('read', {}, 1);
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
  const soloTeams = Array.from({ length: 8 }, (_, id) => ({
    ...teams[id % teams.length], id, name: 'Equipe ' + id, bot: id !== 0,
  }));
  const room = {
    mode: 'ucl', auction: { snapshot: () => ({ complete: true, teams: soloTeams }) },
  };
  const lineup = postAuction(room, 'read');
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
  const season = playSeason('ucl', inputs, undefined, { seed: 128 });
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
    let entries = size / 2;
    const knockout = season.rounds.slice(league.length);
    assert.equal(knockout.length, 2 * Math.log2(entries) - 1);
    const starters = knockout[0].games.flatMap(game => [game.home.id, game.away.id]);
    assert.deepEqual(new Set(starters), new Set(season.tables[0].table.slice(0, entries).map(team => team.id)));
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


test('a liga de 2 a 20 equipes termina com o lider da tabela, sem mata-mata', () => {
  for (const size of [2, 3, 8, 20]) {
    const participants = Array.from({ length: size }, (_, id) => ({
      ...teams[0], id, name: 'Time ' + id, lineup: teams[0].players,
    }));
    const { rounds, tables, champion, championId } = playSeason('league', participants, undefined, { seed: 42 });
    assert.equal(rounds.length, size % 2 ? size : size - 1);
    assert.ok(rounds.every(round => round.name === 'Liga'));
    const matches = rounds.flatMap(round => round.games);
    assert.equal(matches.length, size * (size - 1) / 2);
    assert.equal(new Set(matches.map(({ home, away }) => [home.id, away.id].sort().join(':'))).size, matches.length);
    assert.equal(champion, tables[0].table[0].name);
    assert.equal(championId, tables[0].table[0].id);
  }
});

test('o campeonato de liga revela o campeao apenas ao fim da ultima rodada', () => {
  const soloTeams = teams.map(team => ({ ...team, bot: team.id !== 0 }));
  const room = { mode: 'league', auction: { snapshot: () => ({ complete: true, teams: soloTeams }) } };
  const lineup = postAuction(room, 'read');
  let view = postAuction(room, 'simulate', { formation: '2-2-2', tactic: 'Equilibrada', ids: lineup.auto['2-2-2'] });
  assert.equal(view.season.champion, undefined);
  assert.deepEqual(view.highlights, []);
  for (let i = 0; i < 2; i++) {
    view = postAuction(room, 'clock', { command: 'skip' });
    assert.equal(view.season.champion, undefined);
    view = postAuction(room, 'clock', { command: 'next' });
  }
  view = postAuction(room, 'clock', { command: 'skip' });
  assert.ok(view.season.champion);
  assert.deepEqual(view.highlights.map(entry => entry.id), ['champion']);
  assert.equal(view.highlights[0].teams[0].name, view.season.champion);
});


test('contra-ataque e pressao alta produzem transicoes proprias', () => {
  const inputs = teams.map((team, index) => ({
    ...team, lineup: team.players, tactic: index % 2 === 0 ? 'Pressão alta' : 'Contra-ataque',
  }));
  const settings = { seed: 128 };
  const season = playSeason('ucl', inputs, undefined, settings);
  assert.deepEqual(season, playSeason('ucl', inputs, undefined, settings));
  const allGames = result => result.rounds.flatMap(round => round.games);
  const events = allGames(season).flatMap(game => game.events);
  for (const type of ['pressing', 'escaped-press', 'counter']) {
    assert.ok(events.some(event => event.transition === type), type);
  }
  for (const game of allGames(season)) {
    for (const event of game.events.filter(event => event.transition)) {
      const sides = [game.home, game.away];
      const team = sides[event.transition === 'escaped-press' ? 1 - event.side : event.side];
      assert.equal(team.tactic, event.transition === 'counter' ? 'Contra-ataque' : 'Pressão alta');
    }
  }
  const saved = playSeason('ucl', inputs, undefined, { ...settings, tacticalTransitions: false });
  assert.ok(allGames(saved).every(game => game.events.every(event => !event.transition)));
});
