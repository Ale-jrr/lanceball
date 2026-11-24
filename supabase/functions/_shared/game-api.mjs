import { botBidLimit } from './bot-bidding.mjs';
import { Buffer } from 'node:buffer';
import { randomInt } from 'node:crypto';
import { publicAuction, resolveAuctionPlayer } from './auction-view.mjs';
import { draftCatalog } from './fut7.mjs';
import { previewTournament, restoreSeason } from './tournament.mjs';
import { postAuction } from './post-auction.mjs';
import { uclClubs, clubCrests } from './ucl-clubs.mjs';
import { publicRooms, lobby, authorize, createRoom, joinRoom, roomIdentities, hostId, leaveRoom, touchRoom } from './rooms.mjs';

function createSoloRoom(params, source, openAuction) {
  const mode = params.get('mode');
  const name = params.get('team')?.trim();
  const size = Number(params.get('size'));
  const identity = params.get('club');
  const choices = clubCrests;
  if (mode !== 'ucl' || ![4, 6, 8].includes(size) ||
      !name || name.length > 30 || !choices.has(identity)) {
    throw Error('Configure a equipe na tela inicial antes de iniciar.');
  }
  const opponents = [...choices.keys()].filter(entry => entry !== identity);
  const identities = [
    { name, identity, crestUrl: choices.get(identity) },
    ...opponents.slice(0, size - 1).map(entry => ({
      name: entry, identity: entry, crestUrl: choices.get(entry), bot: true,
    })),
  ];
  return startAuction(mode, identities, source, openAuction);
}

function seedAuction(auction, size, identities, source) {
  const draft = draftCatalog(source, size);
  auction.start(draft, undefined, identities, { surpriseAt: randomInt(1, draft.players.length - 1) });
}

function startAuction(mode, identities, source, openAuction) {
  const auction = openAuction(':memory:');
  try {
    seedAuction(auction, identities.length, identities, source);
    return { auction, mode, lastSeen: Date.now(), botRound: null, botWindows: new Set() };
  } catch (error) {
    auction.close();
    throw error;
  }
}

function advanceSolo(room, now) {
  const { auction } = room;
  const state = auction.snapshot();
  if (!state.round || state.complete) return;
  const { player, highest, deadline } = state.round;
  if (now >= deadline) {
    auction.tick();
    return;
  }
  const seconds = deadline - now;
  const window = seconds <= 2_000 ? 'late' : seconds <= 6_000 ? 'early' : null;
  if (room.botRound !== player.id) {
    room.botRound = player.id;
    room.botWindows.clear();
  }
  if (!window) return;
  const humanBid = highest && !state.teams[highest.teamId].bot ? highest.amount : null;
  const decision = humanBid === null ? window : window + ':human:' + humanBid;
  if (room.botWindows.has(decision)) return;
  room.botWindows.add(decision);
  if (humanBid === null && [...room.botWindows].some(key => key.startsWith(window + ':human:'))) return;
  const minimum = (highest?.amount ?? 0) + 1;
  const candidates = state.teams
    .filter(team => team.bot && team.id !== highest?.teamId && !state.round.passed?.includes(team.id))
    .map(team => ({ team, limit: botBidLimit(state, team, player), variation: randomInt(5) }))
    .filter(candidate => candidate.limit >= minimum)
    .sort((a, b) => (b.limit + b.variation) - (a.limit + a.variation));
  const candidate = candidates[0];
  if (!candidate) return;
  const { team, limit } = candidate;
  if (window === 'early' && player.overall < 83 && !state.round.clue && randomInt(100) < 20) return;
  const extra = highest && limit - minimum >= 5 ? randomInt(3) : 0;
  auction.bid(team.id, player.id, minimum + extra);
}

async function readBody(req, limit = 4096) {
  if (req.body !== undefined && req.body !== null) {
    const body = typeof req.body === 'string' || Buffer.isBuffer(req.body)
      ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(body) > limit) throw Error('Dados acima do limite.');
    return JSON.parse(body.toString());
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('Dados acima do limite.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function requestUrl(request) {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/lanceball') {
    url.pathname = url.searchParams.get('__arena_path') ?? '/';
    url.searchParams.delete('__arena_path');
  }
  return url;
}

export async function handleGameRequest(req, res, runtime) {
  const { onlineRooms, soloRooms, sharedAuction, joinAttempts, catalog: source,
    openAuction, catalogInfo, restoreLocal = false, maintain = true } = runtime;
  if (maintain) maintainRooms(runtime);
  const url = requestUrl(req);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, data) => res.writeHead(status).end(JSON.stringify(data));
  try {
    if (req.method === 'GET' && url.pathname === '/tournament-preview') {
      if (url.searchParams.get('mode') !== 'ucl') return send(400, { error: 'A competição disponível é a Champions League.' });
      return send(200, previewTournament(url.searchParams.get('mode'), Number(url.searchParams.get('humans')), undefined, { size: Number(url.searchParams.get('size')) || 4, team: url.searchParams.get('team'), crest: url.searchParams.get('crest'), club: url.searchParams.get('club') }));
    }
    const code = url.searchParams.get('room')?.toUpperCase();
    const online = onlineRooms.get(code);
    const member = authorize(online, req.headers.authorization);
    if (url.pathname === '/rooms') {
      if (req.method === 'GET') return send(200, publicRooms());
      if (req.method === 'POST') return send(201, createRoom(await readBody(req), onlineRooms));
    }
    if (url.pathname === '/room') {
      if (!online) return send(404, { error: 'Sala indisponível.' });
      if (req.method === 'GET') return send(200, lobby(online, member));
      if (req.method === 'POST') {
        const input = await readBody(req);
        if (onlineRooms.get(code) !== online) return send(404, { error: 'Sala indisponível.' });
        if (member && !member.token) return send(401, { error: 'Você não está nesta sala.' });
        if (input.action === 'join') {
          if (member) return send(200, lobby(online, member));
          if (online.secret) {
            const key = online.code + ':' + req.socket.remoteAddress;
            const now = Date.now();
            const attempt = joinAttempts.get(key);
            const current = attempt?.expires > now ? attempt : { count: 0, expires: now + 60_000 };
            if (current.count >= 8) return send(429, { error: 'Muitas tentativas. Aguarde um minuto.' });
            current.count++;
            joinAttempts.set(key, current);
          }
          return send(200, joinRoom(online, input));
        }
        if (input.action === 'leave') {
          if (!member) return send(401, { error: 'Você não está nesta sala.' });
          leaveRoom(online, member, onlineRooms);
          return send(200, { left: true });
        }
        if (input.action === 'start') {
          if (!member || member.id !== hostId(online)) return send(403, { error: 'Só o anfitrião pode iniciar.' });
          if (!online.auction) {
            Object.assign(online, startAuction(online.mode, roomIdentities(online), source, openAuction));
            online.auction.tick();
          }
          return send(200, lobby(online, member));
        }
        return send(400, { error: 'Ação inválida.' });
      }
    }
    if (code && !online) return send(404, { error: 'A sala não está mais disponível. Abra um convite novo.' });
    if (code && !member) return send(401, { error: 'Seu acesso à sala não foi reconhecido. Volte ao lobby para verificar o convite.' });
    if (code && !online.auction) return send(409, { error: 'O anfitrião ainda não iniciou o leilão.' });
    const roomId = url.searchParams.get('solo');
    if (roomId !== null && !/^[0-9a-f-]{36}$/i.test(roomId)) throw Error('Sessão inválida.');
    let room = online ?? soloRooms.get(roomId);
    if (!room && roomId && req.method === 'POST' && url.pathname === '/start') {
      if (soloRooms.size >= 32) return send(503, { error: 'Limite de leilões locais atingido.' });
      room = createSoloRoom(url.searchParams, source, openAuction);
      soloRooms.set(roomId, room);
    }
    const previousPort = url.searchParams.get('previous');
    if (restoreLocal && !room && roomId && req.method === 'GET' && url.pathname === '/post-auction' &&
        ['4182', '4184'].includes(previousPort)) {
      let mode = url.searchParams.get('mode');
      if (soloRooms.size >= 32) return send(503, { error: 'Limite de leilões locais atingido.' });
      const isPostAuction = previousPort === '4184';
      const oldRoute = isPostAuction ? '/post-auction' : '/state';
      const oldUrl = 'http://127.0.0.1:' + previousPort + oldRoute + '?' + new URLSearchParams({ solo: roomId });
      const response = await fetch(oldUrl, { signal: AbortSignal.timeout(2500) }).catch(() => null);
      const payload = response?.ok ? await response.json() : null;
      const previous = isPostAuction && payload ? { complete: true, teams: payload.teams } : payload?.state;
      if (!previous?.complete || !previous.teams[0] || previous.teams.some(team => ![7, 11].includes(team.players.length) ||
          team.players.length !== previous.teams[0].players.length)) {
        return send(404, { error: 'Partida anterior indisponível. A sessão precisa estar ativa e com o leilão encerrado.' });
      }
      if (isPostAuction && payload.season) mode = payload.season.tables.length === 2 ? 'world' : 'ucl';
      if (mode !== 'ucl') throw Error('Informe a competição da sessão anterior.');
      let post;
      if (isPostAuction) {
        const { formations, tactics, auto, ...saved } = payload;
        post = saved;
        if (post.season) post.season = restoreSeason(post.season, post.teams, mode);
      }
      room = soloRooms.get(roomId) ?? {
        mode, post, lastSeen: Date.now(), auction: { snapshot: () => previous, close() {} },
      };
      soloRooms.set(roomId, room);
    }
    if (room) touchRoom(room);
    const auction = roomId || code ? room?.auction : sharedAuction;
    if (url.pathname === '/post-auction' && ['GET', 'POST'].includes(req.method)) {
      if (!room) return send(404, { error: 'Sessão de leilão indisponível.' });
      if (req.method === 'GET') return send(200, postAuction(room, 'read', {}, member?.id ?? 0));
      const { action, ...input } = await readBody(req);
      if (member && !member.token) return send(401, { error: 'Você não está nesta sala.' });
      if (!['trade', 'lineup', 'simulate', 'clock', 'tactic'].includes(action)) throw Error('Ação inválida.');
      return send(200, postAuction(room, action, input, member?.id ?? 0));
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      const current = auction?.snapshot();
      const state = current && (!current.round || Date.now() >= current.round.deadline) && !current.complete
        ? auction.tick() : current;
      return send(200, { state: publicAuction(state), catalogInfo, time: Date.now(), yourTeamId: member?.id, mode: room?.mode, roomName: online?.name });
    }
    if (req.method === 'POST' && url.pathname === '/start') {
      if (code) return send(403, { error: 'Use o lobby para iniciar.' });
      if (!auction.snapshot()) seedAuction(auction, 8, undefined, source);
      return send(200, { state: publicAuction(auction.tick()), catalogInfo, time: Date.now(), mode: room?.mode });
    }
    if (req.method === 'POST' && ['/bid', '/pass'].includes(url.pathname)) {
      const { teamId, playerId, amount } = await readBody(req, 1024);
      if (member && !member.token) return send(401, { error: 'Você não está nesta sala.' });
      if (!Number.isInteger(teamId) || teamId < 0 || teamId > 7 || typeof playerId !== 'string') {
        return send(400, { error: 'Equipe ou atleta inválido.' });
      }
      if (!auction || (room && teamId !== (member?.id ?? 0))) throw Error('Equipe indisponível nesta sessão.');
      const player = resolveAuctionPlayer(auction.snapshot()?.round, playerId);
      if (!player) throw Error('Rodada indisponível');
      if (url.pathname === '/pass') auction.pass(teamId, player);
      else auction.bid(teamId, player, amount);
      return send(200, { state: publicAuction(auction.snapshot()), catalogInfo, time: Date.now(), yourTeamId: member?.id, mode: room?.mode, roomName: online?.name });
    }
    return send(404, { error: 'Rota indisponível.' });
  } catch (error) {
    return send(400, { error: error.message });
  }
}

export function maintainRooms({ sharedAuction, joinAttempts, onlineRooms, soloRooms }) {
  const now = Date.now();
  const state = sharedAuction?.snapshot();
  if (state?.round && now >= state.round.deadline) sharedAuction.tick();
  for (const [key, attempt] of joinAttempts) {
    if (attempt.expires <= now) joinAttempts.delete(key);
  }
  for (const [id, room] of onlineRooms) {
    if (now - room.lastSeen > 30 * 60_000) {
      room.auction?.close();
      onlineRooms.delete(id);
    } else if (room.auction) {
      try { advanceSolo(room, now); }
      catch (error) { console.error(error); }
    }
  }
  for (const [id, room] of soloRooms) {
    if (now - room.lastSeen > 30 * 60_000) {
      room.auction.close();
      soloRooms.delete(id);
    } else {
      try { advanceSolo(room, now); }
      catch (error) { console.error(error); }
    }
  }
}
