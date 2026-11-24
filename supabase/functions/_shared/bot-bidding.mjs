const maxBotBid = 18;

export function botBidLimit(state, team, player) {
  const remaining = state.rosterSize - team.players.length;
  if (remaining <= 0) return 0;
  const needed = state.quotas[player.position] -
    team.players.filter(entry => entry.position === player.position).length;
  if (needed <= 0) return 0;
  const available = team.balance - (remaining - 1);
  const auctionProgress = 1 - state.queue.length / state.catalog.players.length;
  const urgency = Math.max(0, auctionProgress - team.players.length / state.rosterSize);
  const overall = state.round.clue ? 81 : player.overall;
  const quality = .48 + .064 * Math.max(0, overall - 78);
  const style = [.88, 1, 1.13][team.id % 3];
  const budgetPerSlot = team.balance / remaining;
  const lastVacancy = remaining === 1 ? .3 : 0;
  const value = budgetPerSlot * (quality + .45 * urgency + lastVacancy) * style;
  return Math.max(0, Math.min(maxBotBid, available, Math.floor(value)));
}
