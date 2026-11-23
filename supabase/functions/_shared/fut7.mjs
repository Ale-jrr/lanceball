import { randomInt } from 'node:crypto';

export const rosterQuotas = Object.freeze({ GK: 1, DEF: 2, MID: 2, FWD: 2 });
export const rosterSize = Object.values(rosterQuotas).reduce((total, count) => total + count, 0);

function shuffle(values, nextInt) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = nextInt(index + 1);
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

function draftWeight(overall) {
  if (overall >= 90) return 22;
  if (overall >= 88) return 18;
  if (overall >= 85) return 14;
  return 10;
}

function pickPlayers(pool, count, nextInt) {
  const available = pool.map(player => ({ player, weight: draftWeight(player.overall) }));
  let total = available.reduce((sum, entry) => sum + entry.weight, 0);
  return Array.from({ length: Math.min(count, available.length) }, () => {
    let ticket = nextInt(total);
    const index = available.findIndex(entry => {
      ticket -= entry.weight;
      return ticket < 0;
    });
    const [selected] = available.splice(index, 1);
    total -= selected.weight;
    return selected.player;
  });
}

export function draftCatalog(catalog, teams, nextInt = randomInt) {
  const players = Object.entries(rosterQuotas).flatMap(([position, quota]) =>
    pickPlayers(catalog.players.filter(player => player.position === position), quota * teams, nextInt));
  return { ...catalog, players: shuffle(players, nextInt) };
}
