import { randomInt } from 'node:crypto';
import { playSeason } from './tournament.mjs';
import { hostId, memberRef } from './rooms.mjs';
import { rosterSize } from './fut7.mjs';

import { autoLineup, fut7Formations } from './formations.mjs';

const legacyFormations = {
  '4-3-3': ['GK','DEF','DEF','DEF','DEF','MID','MID','MID','FWD','FWD','FWD'],
  '4-4-2': ['GK','DEF','DEF','DEF','DEF','MID','MID','MID','MID','FWD','FWD'],
  '3-4-3': ['GK','DEF','DEF','DEF','MID','MID','MID','MID','FWD','FWD','FWD'],
};
const tactics = ['Equilibrada', 'Ofensiva', 'Defensiva', 'Contra-ataque', 'Posse de bola', 'Pressão alta'];
const roundWait = 15_000;
const minuteDuration = 420;

function calculate(mode, model) {
  return playSeason(mode, model.teams, undefined, {
    seed: model.seed, changes: model.changes, fullBracket: model.fullBracket ?? false,
    halfBracket: model.halfBracket ?? false, tacticalTransitions: model.tacticalTransitions ?? false,
  });
}

function ownLineupTactic(post, actor) {
  return post.lineups[actor]?.tactic ?? post.tactic;
}

function endMinute(game) {
  return game.extraTime ? 120 : 90;
}

function phaseHighlights(season, live, teams) {
  const completed = index => index >= 0 && (index < live.round ||
    (index === live.round && live.minute >= Math.max(...season.rounds[index].games.map(endMinute))));
  const leagueEnd = season.rounds.findLastIndex(round => round.name === 'Liga');
  const semifinalEnd = season.rounds.findLastIndex(round => round.name.startsWith('Semifinais'));
  const finalIndex = season.rounds.length - 1;
  const club = ({ id, name, crestUrl }) => ({ id, name, crestUrl });
  const highlights = [];
  for (let index = leagueEnd + 1; leagueEnd >= 0 && index < finalIndex; index++) {
    const round = season.rounds[index];
    const firstLeg = round.name.endsWith(' · Ida') || round.name === 'Semifinais';
    if (!firstLeg || !completed(index - 1)) continue;
    const title = round.name.split(' · ')[0];
    highlights.push({
      id: title === 'Semifinais' ? 'semifinals' : 'knockout-' + index,
      title, subtitle: 'Classificados para o mata-mata',
      teams: round.games.flatMap(game => [club(game.home), club(game.away)]),
    });
  }
  const final = season.rounds[finalIndex];
  if (final.name === 'Final' && completed(semifinalEnd >= 0 ? semifinalEnd : finalIndex - 1)) {
    const { home, away } = final.games[0];
    highlights.push({
      id: 'final', title: 'Grande final', subtitle: 'As equipes que vão disputar o título',
      teams: [club(home), club(away)],
    });
  }
  if (completed(finalIndex)) {
    const leagueOnly = season.championId !== undefined;
    const champion = leagueOnly ? teams.find(team => team.id === season.championId)
      : season.rounds[finalIndex].games[0].winner;
    highlights.push({
      id: 'champion', title: leagueOnly ? 'Campeão da Liga' : 'Campeão da Champions',
      subtitle: 'Fim do campeonato', teams: [club(champion)],
    });
  }
  return highlights;
}

function tournamentLeaders(rounds) {
  const goals = new Map();
  const assists = new Map();
  function count(totals, player, team) {
    if (!player) return;
    const key = JSON.stringify([team.id, player.id]);
    const entry = totals.get(key) ?? { name: player.name, team: team.name, count: 0 };
    entry.count++;
    totals.set(key, entry);
  }
  for (const round of rounds) {
    for (const game of round.games) {
      for (const event of game.events) {
        if (!event.scorer) continue;
        const team = event.side === 0 ? game.home : game.away;
        count(goals, event.scorer, team);
        count(assists, event.assistant, team);
      }
    }
  }
  function leaders(totals) {
    const entries = [...totals.values()];
    const best = Math.max(0, ...entries.map(entry => entry.count));
    return entries.filter(entry => entry.count === best);
  }
  return { goals: leaders(goals), assists: leaders(assists) };
}

function visibleSeason(season, live) {
  const rounds = season.rounds.map((round, index) => {
    if (index > live.round) return { games: [] };
    if (index < live.round) return round;
    return { ...round, games: round.games.map(game => {
      if (live.minute >= endMinute(game)) return game;
      const { score, shots, onTarget, penalties, winner, possession, ...details } = game;
      return { ...details, extraTime: live.minute >= 90 && game.extraTime,
        events: game.events.filter(event => event.minute <= live.minute) };
    }) };
  });
  const complete = live.round === season.rounds.length - 1 &&
    live.minute >= Math.max(...season.rounds[live.round].games.map(endMinute));
  return {
    rounds,
    tables: season.tables.map(group => ({
      name: group.name, table: group.table.map(({ id, name }) => ({ id, name })),
    })),
    champion: complete ? season.champion : undefined,
    thirdPlace: complete ? season.thirdPlace : undefined,
    leaders: complete ? tournamentLeaders(season.rounds) : undefined,
  };
}

export function postAuction(room, action, input = {}, actor = 0, now = Date.now()) {
  const state = room.auction.snapshot();
  if (!state?.complete) throw Error('Conclua o leilão antes de continuar.');
  const size = state.teams[0].players.length;
  const formations = size === rosterSize ? fut7Formations : legacyFormations;
  const baseFormation = size === rosterSize ? '2-2-2' : '4-3-3';
  const post = room.post ??= {
    stage: 'lineup', teams: state.teams, formation: baseFormation, tactic: tactics[0],
  };
  const own = post.teams.find(team => team.id === actor && !team.bot);
  if (!own) throw Error('Equipe indisponível.');
  const online = Boolean(room.members);
  const humans = post.teams.filter(team => !team.bot);
  const host = online ? hostId(room) : 0;
  if (post.stage === 'trades') {
    post.stage = 'lineup';
    delete post.ready;
    delete post.offers;
  }
  post.lineups ??= {};
  if (action === 'simulate' && post.stage !== 'tournament') {
    if (post.stage !== 'lineup') throw Error('Abra a escalação primeiro.');
    if (!Object.hasOwn(formations, input.formation) || !tactics.includes(input.tactic) ||
        !Array.isArray(input.ids) || input.ids.length !== size || new Set(input.ids).size !== size ||
        input.ids.some(id => !own.players.some(player => player.id === id))) {
      throw Error(`Escolha ${size} atletas diferentes, uma formação e uma tática válidas.`);
    }
    post.lineups[actor] = { formation: input.formation, tactic: input.tactic, ids: input.ids };
  }
  if (post.stage === 'lineup' && humans.every(team => post.lineups[team.id])) {
    const teams = post.teams.map(team => {
      const selection = post.lineups[team.id];
      const slots = formations[selection?.formation ?? team.formation ?? baseFormation];
      const ids = selection?.ids ?? autoLineup(team.players, slots);
      const lineup = ids.map((id, index) => {
        const player = team.players.find(entry => entry.id === id);
        const fit = player.position === slots[index];
        return { ...player, rating: player.overall - (fit ? 0 : 8), role: slots[index] };
      });
      return { ...team, lineup, tactic: selection?.tactic ?? tactics[team.id % tactics.length] };
    });
    post.model = { teams, seed: randomInt(0x1_0000_0000), changes: {}, fullBracket: true, halfBracket: true, tacticalTransitions: true };
    post.season = calculate(room.mode, post.model);
    post.stage = 'tournament';
  }
  if (post.model && !post.season) post.season = calculate(room.mode, post.model);
  if (action === 'tactic' && !post.season) throw Error('Inicie o campeonato antes de alterar a tática.');
  let clock;
  if (post.season) {
    const live = post.live ??= { round: 0, minute: 0, since: null, startsAt: now + roundWait };
    const games = () => post.season.rounds[live.round].games;
    const end = () => Math.max(...games().map(endMinute));
    const ownGame = () => games().find(game => game.home.id === actor || game.away.id === actor);
    const waitingForNext = () => live.minute >= end() && live.round < post.season.rounds.length - 1;
    if (live.startsAt === undefined) {
      live.startsAt = live.since === null && (live.minute === 0 || waitingForNext()) ? now + roundWait : null;
    }
    if (live.startsAt !== null && now >= live.startsAt) {
      if (waitingForNext()) {
        live.round++;
        live.minute = 0;
      }
      live.since = live.startsAt;
      live.startsAt = null;
    }
    if (live.since !== null) {
      const elapsed = Math.min(end() - live.minute, Math.max(0, Math.floor((now - live.since) / minuteDuration)));
      live.minute += elapsed;
      live.since = live.minute === end() ? null : live.since + elapsed * minuteDuration;
    }
    if (action === 'clock' && actor !== host) throw Error('Só o anfitrião controla a rodada.');
    if (action === 'clock' && (input.round === undefined || input.round === live.round)) {
      if (input.command === 'start' && live.minute < end() && live.since === null) {
        live.since = now;
        live.startsAt = null;
      }
      if (input.command === 'toggle' && live.minute < end()) {
        live.since = live.since === null ? now : null;
        live.startsAt = null;
      }
      if (input.command === 'event' && !online) {
        const game = games().find(entry => entry.id === input.matchId) ?? ownGame();
        const source = game && live.minute < endMinute(game) ? [game] : games();
        live.minute = Math.min(end(), ...source.flatMap(entry =>
          entry.events.filter(event => event.minute > live.minute).map(event => event.minute)));
        if (live.minute === end()) live.since = null;
      }
      if (input.command === 'skip') {
        live.minute = end();
        live.since = null;
        live.startsAt = null;
      }
      if (input.command === 'next' && live.minute >= end() && live.round < post.season.rounds.length - 1) {
        live.round++;
        live.minute = 0;
        live.startsAt ??= now + roundWait;
      }
    }
    if (waitingForNext()) live.startsAt ??= now + roundWait;
    else if (live.minute >= end()) live.startsAt = null;
    if (action === 'tactic') {
      const game = ownGame();
      if (!post.model || !game || game.id !== input.matchId || live.minute >= endMinute(game) ||
          (live.minute === 0 && live.since === null) || !tactics.includes(input.tactic)) {
        throw Error('Escolha uma tática válida durante o seu jogo.');
      }
      const timeline = post.model.changes[game.id] ??= [];
      const minute = live.minute + 1;
      const queued = timeline.find(change => change.teamId === actor && change.minute === minute);
      if (queued) queued.tactic = input.tactic;
      else timeline.push({ teamId: actor, minute, tactic: input.tactic });
      post.season = calculate(room.mode, post.model);
    }
    const game = ownGame();
    const plan = game ? (post.model?.changes[game.id] ?? []).filter(change => change.teamId === actor) : [];
    const active = [...plan].reverse().find(change => change.minute <= live.minute);
    const pending = plan.find(change => change.minute === live.minute + 1);
    clock = {
      round: live.round, minute: live.minute, playing: live.since !== null,
      startsIn: live.startsAt === null ? null : Math.max(0, Math.ceil((live.startsAt - now) / 1000)),
      canChangeTactic: Boolean(post.model && game &&
        live.minute < endMinute(game) && (live.minute > 0 || live.since !== null)),
      currentTactic: active?.tactic ?? ownLineupTactic(post, actor),
      pendingTactic: pending?.tactic,
    };
  }
  const { lineups, live, season, model, ...view } = post;
  const ownLineup = lineups[actor];
  return {
    ...view, season: season ? visibleSeason(season, live) : undefined,
    highlights: season ? phaseHighlights(season, live, post.teams) : [],
    formations, tactics, clock, mode: room.mode, online, you: actor, isHost: actor === host, humans: humans.length,
    formation: ownLineup?.formation ?? own.formation ?? post.formation,
    tactic: ownLineup?.tactic ?? post.tactic,
    lineup: ownLineup?.ids,
    lineupsReady: humans.filter(team => lineups[team.id]).length,
    pendingLineupTeamIds: humans.filter(team => !lineups[team.id]).map(team => team.id),
    kickableMembers: online && actor === host && post.stage === 'lineup'
      ? room.members.filter(member => member.token && member.id !== host)
        .map(member => ({ id: member.id, name: member.name, ref: memberRef(member) }))
      : [],
    auto: Object.fromEntries(Object.entries(formations).map(([name, slots]) =>
      [name, autoLineup(own.players, slots)])),
  };
}
