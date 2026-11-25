import { randomInt } from 'node:crypto';
import { playSeason } from './tournament.mjs';
import { hostId } from './rooms.mjs';
import { rosterSize } from './fut7.mjs';

import { autoLineup, fut7Formations } from './formations.mjs';

const legacyFormations = {
  '4-3-3': ['GK','DEF','DEF','DEF','DEF','MID','MID','MID','FWD','FWD','FWD'],
  '4-4-2': ['GK','DEF','DEF','DEF','DEF','MID','MID','MID','MID','FWD','FWD'],
  '3-4-3': ['GK','DEF','DEF','DEF','MID','MID','MID','MID','FWD','FWD','FWD'],
};
const tactics = ['Equilibrada', 'Ofensiva', 'Defensiva', 'Contra-ataque', 'Posse de bola', 'Pressão alta'];

function calculate(mode, model) {
  return playSeason(mode, model.teams, undefined, { seed: model.seed, changes: model.changes, fullBracket: model.fullBracket ?? false });
}

function ownLineupTactic(post, actor) {
  return post.lineups[actor]?.tactic ?? post.tactic;
}

function endMinute(game) {
  return game.extraTime ? 120 : 90;
}

function phaseHighlights(season, live) {
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
  if (completed(semifinalEnd)) {
    highlights.push({
      id: 'final', title: 'Grande final', subtitle: 'As equipes que vão disputar o título',
      teams: season.rounds[semifinalEnd].games.map(game => club(game.winner)),
    });
  }
  if (completed(finalIndex)) {
    highlights.push({
      id: 'champion', title: 'Campeão da Champions', subtitle: 'Fim do campeonato',
      teams: [club(season.rounds[finalIndex].games[0].winner)],
    });
  }
  return highlights;
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
  };
}

export function postAuction(room, action, input = {}, actor = 0, now = Date.now()) {
  const state = room.auction.snapshot();
  if (!state?.complete) throw Error('Conclua o leilão antes de continuar.');
  const size = state.teams[0].players.length;
  const formations = size === rosterSize ? fut7Formations : legacyFormations;
  const baseFormation = size === rosterSize ? '2-2-2' : '4-3-3';
  const post = room.post ??= {
    stage: 'trades', teams: state.teams, offers: [], formation: baseFormation, tactic: tactics[0],
  };
  const own = post.teams.find(team => team.id === actor && !team.bot);
  if (!own) throw Error('Equipe indisponível.');
  const online = Boolean(room.members);
  const humans = post.teams.filter(team => !team.bot);
  const host = online ? hostId(room) : 0;
  post.ready ??= [];
  post.lineups ??= {};
  if (action === 'trade') {
    if (post.stage !== 'trades' || post.ready.includes(actor)) throw Error('A janela de trocas foi encerrada.');
    const other = post.teams.find(team => team.bot && team.players.some(player => player.id === input.target));
    const mine = own.players.find(player => player.id === input.offer);
    const target = other?.players.find(player => player.id === input.target);
    if (!mine || !target) throw Error('Escolha dois atletas disponíveis.');
    const accepted = mine.position === target.position && mine.overall >= target.overall;
    if (accepted) {
      own.players[own.players.indexOf(mine)] = target;
      other.players[other.players.indexOf(target)] = mine;
    }
    post.offers.unshift({ mine: mine.name, target: target.name, team: other.name, accepted });
  } else if (action === 'close-trades') {
    if (!online || actor !== host) throw Error('Só o anfitrião pode encerrar as trocas para todos.');
    if (post.stage === 'trades') post.stage = 'lineup';
  } else if (action === 'lineup' && post.stage === 'trades') {
    if (!post.ready.includes(actor)) post.ready.push(actor);
  } else if (action === 'simulate' && post.stage !== 'tournament') {
    if (post.stage !== 'lineup') throw Error('Abra a escalação primeiro.');
    if (!Object.hasOwn(formations, input.formation) || !tactics.includes(input.tactic) ||
        !Array.isArray(input.ids) || input.ids.length !== size || new Set(input.ids).size !== size ||
        input.ids.some(id => !own.players.some(player => player.id === id))) {
      throw Error(`Escolha ${size} atletas diferentes, uma formação e uma tática válidas.`);
    }
    post.lineups[actor] = { formation: input.formation, tactic: input.tactic, ids: input.ids };
  }
  if (post.stage === 'trades' && humans.every(team => post.ready.includes(team.id))) post.stage = 'lineup';
  if (post.stage === 'lineup' && humans.every(team => post.lineups[team.id])) {
    const teams = post.teams.map(team => {
      const selection = post.lineups[team.id];
      const slots = formations[selection?.formation ?? baseFormation];
      const ids = selection?.ids ?? autoLineup(team.players, slots);
      const lineup = ids.map((id, index) => {
        const player = team.players.find(entry => entry.id === id);
        const fit = player.position === slots[index];
        return { ...player, rating: player.overall - (fit ? 0 : 8), role: slots[index] };
      });
      return { ...team, lineup, tactic: selection?.tactic ?? tactics[team.id % tactics.length] };
    });
    post.model = { teams, seed: randomInt(0x1_0000_0000), changes: {}, fullBracket: true };
    post.season = calculate(room.mode, post.model);
    post.stage = 'tournament';
  }
  if (post.model && !post.season) post.season = calculate(room.mode, post.model);
  if (action === 'tactic' && !post.season) throw Error('Inicie o campeonato antes de alterar a tática.');
  let clock;
  if (post.season) {
    const live = post.live ??= { round: 0, minute: 0, since: null };
    const games = () => post.season.rounds[live.round].games;
    const end = () => Math.max(...games().map(endMinute));
    const ownGame = () => games().find(game => game.home.id === actor || game.away.id === actor);
    if (live.since !== null) {
      const elapsed = Math.floor((now - live.since) / 420);
      live.minute = Math.min(end(), live.minute + elapsed);
      live.since = live.minute === end() ? null : live.since + elapsed * 420;
    }
    if (action === 'clock') {
      if (actor !== host) throw Error('Só o anfitrião controla a rodada.');
      if (input.command === 'toggle' && live.minute < end()) live.since = live.since === null ? now : null;
      if (input.command === 'event' && !online) {
        const game = ownGame();
        const source = game && live.minute < endMinute(game) ? [game] : games();
        live.minute = Math.min(end(), ...source.flatMap(entry =>
          entry.events.filter(event => event.minute > live.minute).map(event => event.minute)));
        if (live.minute === end()) live.since = null;
      }
      if (input.command === 'skip') {
        live.minute = end();
        live.since = null;
      }
      if (input.command === 'next' && live.minute >= end() && live.round < post.season.rounds.length - 1) {
        live.round++;
        live.minute = 0;
      }
    }
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
      canChangeTactic: Boolean(post.model && game &&
        live.minute < endMinute(game) && (live.minute > 0 || live.since !== null)),
      currentTactic: active?.tactic ?? ownLineupTactic(post, actor),
      pendingTactic: pending?.tactic,
    };
  }
  const { lineups, ready, live, season, model, ...view } = post;
  const ownLineup = lineups[actor];
  return {
    ...view, season: season ? visibleSeason(season, live) : undefined,
    highlights: season ? phaseHighlights(season, live) : [],
    formations, tactics, clock, online, you: actor, isHost: actor === host, humans: humans.length,
    formation: ownLineup?.formation ?? post.formation,
    tactic: ownLineup?.tactic ?? post.tactic,
    lineup: ownLineup?.ids, tradeReady: ready.includes(actor),
    lineupsReady: humans.filter(team => lineups[team.id]).length,
    pendingLineupTeamIds: humans.filter(team => !lineups[team.id]).map(team => team.id),
    auto: Object.fromEntries(Object.entries(formations).map(([name, slots]) =>
      [name, autoLineup(own.players, slots)])),
  };
}
