import { playerPortrait } from './player-portraits.mjs';

export function resolveAuctionPlayer(round, reference) {
  const publicId = round?.publicId ?? round?.player.id;
  return publicId === reference ? round.player.id : null;
}

export function publicAuction(state) {
  if (!state) return state;
  const { round, catalog, purchases, passed } = state;
  const known = new Map(passed.map(player => [player.id, player]));
  for (const team of state.teams) {
    for (const player of team.players) known.set(player.id, player);
  }
  if (round && !round.clue) known.set(round.player.id, round.player);
  const current = !round ? null : round.clue ? {
    deadline: round.deadline, highest: round.highest, passed: round.passed, clue: round.clue,
    player: { id: round.publicId, ...(round.clue.position ? { position: round.clue.position } : {}) },
  } : { ...round, portrait: playerPortrait(round.player.id) };
  return {
    complete: state.complete, round: current, purchases, teams: state.teams,
    quotas: state.quotas, rosterSize: state.rosterSize,
    lastClosed: state.lastClosed && { ...state.lastClosed, portrait: playerPortrait(state.lastClosed.player.id) },
    totalPlayers: catalog.players.length,
    roundNumber: state.complete ? catalog.players.length : catalog.players.length - state.queue.length,
    catalog: { players: [...known.values()] },
    bids: state.bids.map(bid => round?.clue && bid.playerId === round.player.id
      ? { ...bid, playerId: round.publicId } : bid),
  };
}
