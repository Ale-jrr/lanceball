export function botBidLimit(state, team, player) {
  const remaining = state.rosterSize - team.players.length;
  if (remaining <= 0) return 0;
  const needed = state.quotas[player.position] -
    team.players.filter(entry => entry.position === player.position).length;
  if (needed <= 0) return 0;
  const available = team.balance - (remaining - 1);
  const auctionProgress = 1 - state.queue.length / state.catalog.players.length;
  const urgency = Math.max(0, auctionProgress - team.players.length / state.rosterSize);
  const positionSupply = state.queue.filter(entry => entry.position === player.position).length;
  const positionDemand = state.teams?.reduce((total, entry) => total + Math.max(0,
    state.quotas[player.position] - entry.players.filter(signed => signed.position === player.position).length), 0) ?? 0;
  const scarcity = positionDemand > positionSupply ? .10 : 0;
  const overall = state.round.clue ? 81 : player.overall;
  const quality = .48 + .064 * Math.max(0, overall - 78);
  const squadAverage = team.players.length
    ? team.players.reduce((sum, signed) => sum + signed.overall, 0) / team.players.length
    : overall;
  const squadUpgrade = state.round.clue ? 0 : Math.max(-.10, Math.min(.10, (overall - squadAverage) * .02));
  const style = [.88, 1, 1.13][team.id % 3];
  const budgetPerSlot = team.balance / Math.max(3, remaining);
  const lastVacancy = remaining === 1 ? .3 : 0;
  const value = budgetPerSlot * (quality + .45 * urgency + lastVacancy + scarcity + squadUpgrade) * style;
  return Math.max(0, Math.min(available, Math.floor(value)));
}
