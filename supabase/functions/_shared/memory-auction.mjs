import { auctionEngine } from './auction-core.mjs';

export function openMemoryAuction(_path, now = Date.now, saved = null) {
  let state = saved ? structuredClone(saved) : null;
  return auctionEngine({
    mutate(action) {
      const { state: next, value } = action(structuredClone(state));
      state = next;
      return value;
    },
    snapshot() { return structuredClone(state); },
    close() {},
  }, now);
}
