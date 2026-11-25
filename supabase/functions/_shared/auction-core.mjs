import { randomInt, randomUUID } from 'node:crypto';

import { rosterQuotas as quotas, rosterSize, validCompetitionSize } from './fut7.mjs';

const reserve = 1;
const bidExtensionMs = 3000;
const bidExtensionLimitMs = 6000;

export function auctionEngine({ mutate, snapshot, close }, now = Date.now) {
  function purchase(state, team, player, amount, method) {
    team.balance -= amount;
    team.players.push(player);
    state.purchases.push({ teamId: team.id, playerId: player.id, amount, method });
  }

  return {
    start(catalog, budget = 100, identities = Array.from({ length: 8 }, (_, id) => ({
      name: `Equipe ${id + 1}`,
    })), { surpriseAt = null } = {}) {
      const teams = identities.length;
      if (!validCompetitionSize('ucl', teams) && !validCompetitionSize('league', teams)) throw Error('Quantidade de equipes inválida');
      if (!Number.isSafeInteger(budget) || budget < rosterSize) throw Error('Orçamento insuficiente');
      const ids = new Set();
      for (const player of catalog.players) {
        if (!player.id || ids.has(player.id) || !player.name?.trim() ||
            !Object.hasOwn(quotas, player.position) ||
            !Number.isInteger(player.overall) || player.overall < 1 || player.overall > 100) {
          throw Error('Catálogo inválido');
        }
        ids.add(player.id);
      }
      if (!catalog.edition?.trim() || !catalog.source?.trim()) throw Error('Edição e origem obrigatórias');
      for (const [position, count] of Object.entries(quotas)) {
        if (catalog.players.filter(player => player.position === position).length < teams * count) {
          throw Error(`Catálogo insuficiente para ${position}`);
        }
      }
      return mutate(state => {
        if (state) throw Error('Sala já iniciou');
        return { state: {
          catalog, quotas, rosterSize,
          queue: [...catalog.players],
          passed: [],
          round: null, surpriseAt, lastClosed: null,
          bids: [],
          purchases: [],
          teams: identities.map((identity, id) => ({ ...identity, id, balance: budget, players: [] })),
          complete: false,
        } };
      });
    },

    tick() {
      return mutate(state => {
        if (!state) throw Error('Sala não iniciada');
        const time = now();
        if (state.round && time >= state.round.deadline) {
          const { player, highest, clue } = state.round;
          state.lastClosed = clue ? { player, highest } : null;
          if (highest) purchase(state, state.teams[highest.teamId], player, highest.amount, 'bid');
          else state.passed.push(player);
          state.round = null;
        }
        if (!state.round && !state.complete) {
          const full = state.teams.every(team => team.players.length === rosterSize);
          const index = state.catalog.players.length - state.queue.length;
          const player = full ? null : state.queue.shift();
          if (player) {
            const surprise = index === state.surpriseAt;
            const clue = surprise ? (player.club?.trim() && randomInt(2) === 1
              ? { label: 'Clube', value: player.club }
              : { label: 'Posição', position: player.position, detail: player.primaryPosition ?? player.position }) : null;
            state.round = { player, deadline: time + 10_000, highest: null, passed: [],
              ...(surprise ? { clue, publicId: randomUUID() } : {}) };
          } else {
            for (const team of state.teams) {
              for (const [position, count] of Object.entries(quotas)) {
                while (team.players.filter(player => player.position === position).length < count) {
                  const index = state.passed.findIndex(player => player.position === position);
                  if (index < 0 || team.balance < reserve) throw Error('Invariante de regularização violada');
                  const [player] = state.passed.splice(index, 1);
                  purchase(state, team, player, reserve, 'allocation');
                }
              }
            }
            state.complete = true;
          }
        }
        return { state, value: state };
      });
    },

    bid(teamId, playerId, amount) {
      return mutate(state => {
        const team = state?.teams[teamId];
        const round = state?.round;
        const time = now();
        if (!team || !round || round.player.id !== playerId || time >= round.deadline) {
          throw Error('Rodada indisponível');
        }
        if (round.passed?.includes(teamId)) throw Error('Você já passou esta rodada');
        if (round.highest?.teamId === teamId) throw Error('Seu lance já está na frente');
        const position = round.player.position;
        if (team.players.filter(player => player.position === position).length >= quotas[position]) {
          throw Error('Posição preenchida');
        }
        const minimum = (round.highest?.amount ?? 0) + 1;
        const remainingAfterPurchase = rosterSize - 1 - team.players.length;
        if (!Number.isSafeInteger(amount) || amount < minimum ||
            amount > team.balance - reserve * remainingAfterPurchase) {
          throw Error('Lance inválido');
        }
        round.highest = { teamId, amount };
        round.deadline = Math.max(round.deadline, Math.min(
          round.deadline + bidExtensionMs, time + bidExtensionLimitMs,
        ));
        state.bids.push({ playerId, teamId, amount, time });
        return { state, value: round.highest };
      });
    },

    pass(teamId, playerId) {
      return mutate(state => {
        const round = state?.round;
        if (!state?.teams[teamId] || !round || round.player.id !== playerId || now() >= round.deadline) {
          throw Error('Rodada indisponível');
        }
        round.passed ??= [];
        if (!round.passed.includes(teamId)) round.passed.push(teamId);
        return { state, value: state };
      });
    },

    handOverToBot(teamId) {
      mutate(state => {
        const team = state?.teams[teamId];
        if (!team) throw Error('Equipe indisponível');
        team.bot = true;
        return { state };
      });
    },

    snapshot,
    close,
  };
}
