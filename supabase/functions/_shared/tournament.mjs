import { randomInt } from 'node:crypto';
import { uclClubs, clubCrests } from './ucl-clubs.mjs';
import { roomSizes } from './fut7.mjs';
import { worldFlags } from './world-teams.mjs';

export function previewTournament(mode, humans, random = randomInt, { size = 4, team, club, country } = {}) {
  if (!['ucl', 'world'].includes(mode) || !Number.isInteger(humans) || humans < 1 || humans > size) {
    throw Error('Informe um número de participantes compatível com a sala.');
  }

  if (!roomSizes.includes(size)) throw Error('Escolha 4, 8, 16, 32 ou 64 equipes.');

  const customName = team?.trim().slice(0, 30);
  const selectedClub = mode === 'ucl' && uclClubs.includes(club) ? club : null;
  const selectedCountry = mode === 'world' && worldFlags.has(country) ? country : null;
  const availableClubs = selectedClub ? uclClubs.filter(name => name !== selectedClub) : [];
  const availableCountries = selectedCountry ? [...worldFlags.keys()].filter(name => name !== selectedCountry) : [];
  const teams = Array.from({ length: Math.max(size, humans) }, (_, index) => ({
    id: index + 1,
    name: index < humans ? `Equipe ${index + 1}` : `Bot ${index - humans + 1}`,
    country: index === 0 ? selectedCountry : index >= humans ? availableCountries[index - humans] ?? null : null,
    club: index === 0 ? selectedClub : index >= humans ? availableClubs[index - humans] ?? null : null,
    points: 0,
    scored: 0,
    conceded: 0,
  }));
  if (customName) teams[0].name = customName;
  for (const entry of teams) entry.crestUrl = clubCrests.get(entry.club) ?? worldFlags.get(entry.country) ?? null;
  const previewTeams = teams.map(team => ({
    ...team,
    tactic: 'Equilibrada',
    lineup: ['GK', 'DEF', 'MID', 'FWD'].map(role => ({ name: team.name, role, rating: 80 })),
  }));
  const season = playSeason(mode, previewTeams, () => random(1_000_000) / 1_000_000);
  function summary(game) {
    const { home, away, score, winner, extraTime, penalties, carry } = game;
    return {
      home: home.name, away: away.name, homeGoals: score[0], awayGoals: score[1],
      winner: winner ? { name: winner.name } : null, extraTime, penalties,
      aggregate: carry ? score.map((goals, side) => goals + carry[side]) : null,
    };
  }
  const firstPhase = season.tables.map(({ name, table }) => ({
    name,
    standings: table.map(team => ({ name: team.name, points: team.pts, scored: team.gf, conceded: team.ga })),
    matches: season.rounds.flatMap(round => round.games).filter(game => game.stage === name).map(summary),
  }));
  const semifinalRounds = season.rounds.filter(round => round.name.startsWith('Semifinais'))
    .map(round => ({ name: round.name, matches: round.games.map(summary) }));
  const bronze = season.rounds.find(round => round.name === 'Disputa de terceiro lugar');
  return { teams, firstPhase, semifinalRounds, thirdPlace: bronze ? summary(bronze.games[0]) : null,
    final: summary(season.rounds.at(-1).games[0]) };
}





const knockoutPhases = {
  64: ['Fase de 64', 'Fase de 64'],
  32: ['Fase de 32', 'Fase de 32'],
  16: ['Oitavas de final', 'Oitavas de final'],
  8: ['Quartas de final', 'Quartas de final'],
  4: ['Semifinais', 'Semifinal'],
};

function bracketOrder(teams) {
  let seeds = [1, 2];
  while (seeds.length < teams.length) {
    const nextSize = seeds.length * 2;
    seeds = seeds.flatMap(seed => [seed, nextSize + 1 - seed]);
  }
  return seeds.map(seed => teams[seed - 1]);
}

function schedule(group) {
  const rotation = [...group];
  if (rotation.length % 2) rotation.push(null);
  return Array.from({ length: rotation.length - 1 }, () => {
    const pairs = [];
    for (let index = 0; index < rotation.length / 2; index++) {
      const home = rotation[index];
      const away = rotation[rotation.length - index - 1];
      if (home && away) pairs.push([home, away]);
    }
    rotation.splice(1, 0, rotation.pop());
    return pairs;
  });
}

export function decisiveShot(minute, margin) {
  if (minute < 80 || (minute > 90 && minute < 110)) return null;
  if (margin === -1) return 'equalizer';
  if (margin === 0) return 'lead';
  return null;
}

export function playSeason(mode, teams, draw = Math.random, { seed, changes = {}, fullBracket = true } = {}) {
  function matchRandom(id) {
    if (seed === undefined) return draw;
    let value = seed;
    for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 0x1_0000_0000;
    };
  }
  function strength(team, role) {
    const players = team.lineup.filter(player => player.role === role);
    return players.reduce((total, player) => total + player.rating, 0) / players.length;
  }

  function match(home, away, stage, { knockout = false, carry = null } = {}) {
    const id = stage + ':' + home.id + ':' + away.id;
    const random = matchRandom(id);
    const timeline = changes[id] ?? [];
    const events = [];
    const score = [0, 0];
    const shots = [0, 0];
    const onTarget = [0, 0];
    const sides = [home, away];
    const approach = {
      'Equilibrada': [0, 0], 'Ofensiva': [4, -3], 'Defensiva': [-3, 4],
      'Contra-ataque': [2, 1], 'Posse de bola': [1, 2], 'Pressão alta': [3, -1],
    };
    const active = sides.map(team => team.tactic);
    const forwards = sides.map(team => strength(team, 'FWD'));
    const midfield = sides.map(team => strength(team, 'MID'));
    const defenders = sides.map(team => strength(team, 'DEF'));
    const keepers = sides.map(team => strength(team, 'GK'));
    let possession;
    let attack;
    let defense;
    let possessionSum = 0;
    let minutesPlayed = 0;
    function updateStrength() {
      attack = active.map((tactic, i) => forwards[i] * .65 + midfield[i] * .35 + approach[tactic][0]);
      defense = active.map((tactic, i) => defenders[i] * .65 + keepers[i] * .35 + approach[tactic][1]);
      possession = Math.round(Math.max(35, Math.min(65, 50 + (midfield[0] - midfield[1]) * .65 +
        (active[0] === 'Posse de bola' ? 5 : 0) - (active[1] === 'Posse de bola' ? 5 : 0))));
    }
    updateStrength();
    function chances(start, end) {
      for (let minute = start; minute <= end; minute++) {
        for (const change of timeline.filter(entry => entry.minute === minute)) {
          const side = sides.findIndex(team => team.id === change.teamId);
          active[side] = change.tactic;
          events.push({ minute, side, text: sides[side].name + ' muda a tática para ' + change.tactic + '.' });
          updateStrength();
        }
        possessionSum += possession;
        minutesPlayed++;
        if (random() >= .23) continue;
        const side = random() * 100 < possession ? 0 : 1;
        const opponent = 1 - side;
        const attackers = sides[side].lineup.filter(player => player.role === 'FWD' || player.role === 'MID');
        const player = attackers[Math.floor(random() * attackers.length)];
        shots[side]++;
        const accurate = random() < .42;
        if (accurate) onTarget[side]++;
        const goal = accurate && random() < Math.max(.12, Math.min(.55, .28 +
          (attack[side] - defense[opponent]) * .012 + (player.rating - 80) * .003));
        const margin = score[side] - score[opponent] + (carry?.[side] ?? 0) - (carry?.[opponent] ?? 0);
        const kind = decisiveShot(minute, margin);
        const highlight = kind ? { kind, outcome: goal ? 'goal' : accurate ? 'save' : 'miss',
          aggregate: Boolean(carry) } : null;
        if (goal) score[side]++;
        const keeper = sides[opponent].lineup.find(entry => entry.role === 'GK');
        const text = goal ? 'Gol de ' + player.name + '!' : accurate
          ? keeper.name + ' defende a finalização de ' + player.name
          : player.name + ' finaliza para fora';
        events.push({ minute, side, text, score: [...score], shots: [...shots], onTarget: [...onTarget],
          ...(highlight ? { highlight } : {}) });
      }
    }
    chances(1, 90);
    const total = () => score.map((goals, side) => goals + (carry?.[side] ?? 0));
    const tied = () => {
      const [homeGoals, awayGoals] = total();
      return homeGoals === awayGoals;
    };
    const extraTime = knockout && tied();
    if (extraTime) {
      events.push({ minute: 90, text: carry ? 'Empate no agregado. Vamos para a prorrogação.' : 'Empate. Vamos para a prorrogação.' });
      chances(91, 120);
    }
    const penalties = extraTime && tied();
    const [homeTotal, awayTotal] = total();
    let winner = homeTotal > awayTotal ? home : awayTotal > homeTotal ? away : null;
    if (penalties) {
      const winnerSide = random() < .5 ? 0 : 1;
      winner = sides[winnerSide];
      const penaltyScore = winnerSide === 0 ? [5, 4] : [4, 5];
      events.push({ minute: 120, text: winner.name + ' vence nos pênaltis por ' + penaltyScore.join(' a ') + '.' });
    }
    return {
      id, stage, home, away, score, carry, shots, onTarget,
      possession: Math.round(possessionSum / minutesPlayed), extraTime, penalties, events, winner,
    };
  }

  const groups = mode === 'world'
    ? [teams.filter((_, i) => i % 2 === 0), teams.filter((_, i) => i % 2 === 1)] : [teams];
  const rounds = [];
  const tables = groups.map((group, index) => {
    const name = mode === 'world' ? 'Grupo ' + ['A', 'B'][index] : 'Liga';
    const table = group.map(team => ({ id: team.id, name: team.name, pts: 0, gf: 0, ga: 0 }));
    const calendar = schedule(group);
    if (mode === 'ucl' && fullBracket) calendar.splice(8);
    for (const [roundIndex, pairs] of calendar.entries()) {
      const round = rounds[roundIndex] ??= { name: name === 'Liga' ? 'Liga' : 'Fase de grupos', games: [] };
      for (const [home, away] of pairs) {
        const game = match(home, away, name);
        const [goalsHome, goalsAway] = game.score;
        const homeRow = table.find(row => row.id === home.id);
        const awayRow = table.find(row => row.id === away.id);
        homeRow.gf += goalsHome;
        homeRow.ga += goalsAway;
        awayRow.gf += goalsAway;
        awayRow.ga += goalsHome;
        homeRow.pts += game.winner?.id === home.id ? 3 : game.winner ? 0 : 1;
        awayRow.pts += game.winner?.id === away.id ? 3 : game.winner ? 0 : 1;
        round.games.push(game);
      }
    }
    table.sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.id - b.id);
    return { name, table };
  });
  const byId = id => teams.find(team => team.id === id);
  const [a, b] = tables.map(group => group.table.map(team => byId(team.id)));
  if (mode === 'league') {
    const leader = tables[0].table[0];
    return { tables, rounds, champion: leader.name, championId: leader.id, thirdPlace: null };
  }
  let finalists;
  let thirdPlace = null;
  if (mode === 'ucl') {
    const qualified = fullBracket && roomSizes.includes(a.length) ? a : a.slice(0, 4);
    let remaining = bracketOrder(qualified);
    const rank = new Map(qualified.map((team, index) => [team.id, index]));
    while (remaining.length > 2) {
      const [phase, stage] = knockoutPhases[remaining.length];
      const first = [];
      for (let index = 0; index < remaining.length; index += 2) {
        const pair = remaining.slice(index, index + 2).sort((a, b) => rank.get(b.id) - rank.get(a.id));
        first.push(match(pair[0], pair[1], stage + ' · Ida'));
      }
      const second = first.map(game => match(game.away, game.home, stage + ' · Volta', {
        knockout: true, carry: [...game.score].reverse(),
      }));
      rounds.push({ name: phase + ' · Ida', games: first }, { name: phase + ' · Volta', games: second });
      remaining = second.map(game => game.winner);
    }
    finalists = remaining;
  } else {
    const semifinal1 = match(a[0], b[1], 'Semifinal', { knockout: true });
    const semifinal2 = match(b[0], a[1], 'Semifinal', { knockout: true });
    const loser = game => game.winner.id === game.home.id ? game.away : game.home;
    const third = match(loser(semifinal1), loser(semifinal2), 'Disputa de terceiro lugar', { knockout: true });
    thirdPlace = third.winner.name;
    finalists = [semifinal1.winner, semifinal2.winner];
    rounds.push({ name: 'Semifinais', games: [semifinal1, semifinal2] },
      { name: 'Disputa de terceiro lugar', games: [third] });
  }
  const final = match(finalists[0], finalists[1], 'Final', { knockout: true });
  rounds.push({ name: 'Final', games: [final] });
  return { tables, rounds, champion: final.winner.name, thirdPlace };
}


export function restoreSeason(season, teams, mode) {
  if (season.rounds) return season;
  const rounds = [];
  const groups = mode === 'world'
    ? [teams.filter((_, index) => index % 2 === 0), teams.filter((_, index) => index % 2 === 1)]
    : [teams];
  for (const group of groups) {
    for (const [index, pairs] of schedule(group).entries()) {
      const round = rounds[index] ??= { name: mode === 'world' ? 'Fase de grupos' : 'Liga', games: [] };
      for (const [home, away] of pairs) {
        const game = season.games.find(entry => entry.stage !== 'Semifinal' && entry.stage !== 'Final' &&
          [entry.home.id, entry.away.id].includes(home.id) && [entry.home.id, entry.away.id].includes(away.id));
        if (!game) throw Error('Calendário anterior incompleto.');
        round.games.push(game);
      }
    }
  }
  rounds.push(
    { name: 'Semifinais', games: season.games.filter(game => game.stage === 'Semifinal') },
    { name: 'Final', games: season.games.filter(game => game.stage === 'Final') },
  );
  return { tables: season.tables, champion: season.champion, seed: season.seed, rounds };
}
