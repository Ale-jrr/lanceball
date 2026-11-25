export const fut7Formations = {
  '2-2-2': ['GK','DEF','DEF','MID','MID','FWD','FWD'],
  '3-2-1': ['GK','DEF','DEF','DEF','MID','MID','FWD'],
  '2-3-1': ['GK','DEF','DEF','MID','MID','MID','FWD'],
  '1-3-2': ['GK','DEF','MID','MID','MID','FWD','FWD'],
  '2-1-3': ['GK','DEF','DEF','MID','FWD','FWD','FWD'],
};

export function autoLineup(players, slots) {
  const available = [...players].sort((a, b) => b.overall - a.overall);
  const ids = slots.map(role => {
    const index = available.findIndex(player => player.position === role);
    return index < 0 ? null : available.splice(index, 1)[0].id;
  });
  return ids.map(id => id ?? available.shift()?.id ?? null);
}
