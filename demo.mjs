import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalogDatabase } from './catalog-db.mjs';
import { openAuction } from './auction.mjs';
import { publicAuction, resolveAuctionPlayer } from './auction-view.mjs';
import { draftCatalog, rosterQuotas } from './fut7.mjs';
import { previewTournament, restoreSeason } from './tournament.mjs';
import { postAuction } from './post-auction.mjs';
import { uclClubs, clubCrests } from './ucl-clubs.mjs';
import { onlineRooms, publicRooms, lobby, authorize, createRoom, joinRoom, roomIdentities, hostId, leaveRoom } from './rooms.mjs';

async function pageTemplate(file, active) {
  const template = await readFile(new URL(file, import.meta.url), 'utf8');
  const links = [['/', 'Início'], ['/leilao', 'Leilão'], ['/campeonato', 'Campeonato']];
  const navigation = links.map(([path, title]) =>
    `<a href="${path}"${path === active ? ' aria-current="page"' : ''}>${title}</a>`).join('');
  return template.replace('<!-- ARENA_HEADER -->', `
    <header class="arena-header"><div class="arena-nav">
      <a class="arena-brand" href="/"><span class="brand-mark" aria-hidden="true"></span>LANCEBALL</a>
      <nav aria-label="Navegação principal">${navigation}</nav>
    </div></header>
  `);
}
const [homeTemplate, page, roomPage, postPage, tournamentPage, arenaCss, roomExitScript, positionScript, arenaBackground] = await Promise.all([
  pageTemplate('./home.html', '/'),
  pageTemplate('./demo.html', '/leilao'),
  pageTemplate('./room.html'),
  pageTemplate('./post-auction.html'),
  pageTemplate('./tournament.html', '/campeonato'),
  readFile(new URL('./arena.css', import.meta.url)),
  readFile(new URL('./room-exit.js', import.meta.url)),
  readFile(new URL('./positions.mjs', import.meta.url)),
  readFile(new URL('./arena-background.png', import.meta.url)),
]);
const clubOptions = uclClubs.map(club => {
  const initials = club.split(/\s+/).map(word => word[0]).join('').slice(0, 3);
  return `<label class="club-option">
    <input type="radio" name="club" value="${club}" required>
    <span class="club-card">
      <span class="club-badge" aria-hidden="true"><span>${initials}</span><img src="${clubCrests.get(club)}" width="38" height="38" alt="" loading="lazy"></span>
      <span class="club-name">${club}</span>
    </span>
  </label>`;
}).join('');
const home = homeTemplate.replace('<!-- UCL_CLUBS -->', clubOptions);
const sharedAuction = openAuction(':memory:');
const soloRooms = new Map();
const roles = { GK: 'Goleiro', DEF: 'Defensor', MID: 'Meio-campista', FWD: 'Atacante' };
const syntheticCatalog = {
  edition: 'demo-v1',
  source: 'Catálogo sintético',
  players: Array.from({ length: 16 }, (_, index) =>
    Object.entries(rosterQuotas).flatMap(([position, count]) =>
      index >= count * 8 ? [] : [{
        id: `${position}-${index}`,
        name: `${roles[position]} ${index + 1}`,
        position,
        overall: 78 + (index * 7 % 14),
      }])).flat(),
};

const catalogPath = process.env.AUCTION_CATALOG ?? new URL('./catalog.json', import.meta.url);
let catalog = syntheticCatalog;
try {
  catalog = JSON.parse((await readFile(catalogPath, 'utf8')).replace(/^\uFEFF/, ''));
} catch (error) {
  if (process.env.AUCTION_CATALOG || error.code !== 'ENOENT') throw error;
}
const databasePath = process.env.AUCTION_CATALOG_DB ?? (process.env.AUCTION_CATALOG
  ? ':memory:' : fileURLToPath(new URL('./catalog.sqlite', import.meta.url)));
catalog = loadCatalogDatabase(databasePath, catalog);
const catalogInfo = { source: catalog.source, edition: catalog.edition, url: catalog.url, license: catalog.license };
function createSoloRoom(params) {
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
  return startAuction(mode, identities);
}

function seedAuction(auction, size, identities) {
  const draft = draftCatalog(catalog, size);
  auction.start(draft, undefined, identities, { surpriseAt: randomInt(1, draft.players.length - 1) });
}

function startAuction(mode, identities) {
  const auction = openAuction(':memory:');
  try {
    seedAuction(auction, identities.length, identities);
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
  if (!window || room.botWindows.has(window)) return;
  room.botWindows.add(window);
  const contenders = state.teams.filter(team => team.bot && team.id !== highest?.teamId && !state.round.passed?.includes(team.id));
  if (!contenders.length) return;
  const offset = randomInt(contenders.length);
  const amount = (highest?.amount ?? 0) + 1;
  const limit = Math.max(2, Math.floor((player.overall - 68) / 4));
  if (amount > limit || (highest && randomInt(100) < 22)) return;
  for (let index = 0; index < contenders.length; index++) {
    const team = contenders[(index + offset) % contenders.length];
    try {
      auction.bid(team.id, player.id, amount);
      return;
    } catch (error) {
      if (!['Lance inválido', 'Posição preenchida', 'Rodada indisponível'].includes(error.message)) throw error;
    }
  }
}

async function readBody(req, limit = 4096) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('Dados acima do limite.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const joinAttempts = new Map();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/arena-background.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' }).end(arenaBackground);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/positions.mjs') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(positionScript);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/room-exit.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(roomExitScript);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/arena.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }).end(arenaCss);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/sala') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(roomPage);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/pos-leilao') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(postPage);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/campeonato') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(tournamentPage);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(home);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/leilao') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
    return;
  }
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
      if (req.method === 'POST') return send(201, createRoom(await readBody(req)));
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
          leaveRoom(online, member);
          return send(200, { left: true });
        }
        if (input.action === 'start') {
          if (!member || member.id !== hostId(online)) return send(403, { error: 'Só o anfitrião pode iniciar.' });
          if (!online.auction) {
            Object.assign(online, startAuction(online.mode, roomIdentities(online)));
            online.auction.tick();
          }
          return send(200, lobby(online, member));
        }
        return send(400, { error: 'Ação inválida.' });
      }
    }
    if (code && !member) return send(401, { error: 'Entre na sala antes de acessar a partida.' });
    if (code && !online.auction) return send(409, { error: 'O anfitrião ainda não iniciou o leilão.' });
    const roomId = url.searchParams.get('solo');
    if (roomId !== null && !/^[0-9a-f-]{36}$/i.test(roomId)) throw Error('Sessão inválida.');
    let room = online ?? soloRooms.get(roomId);
    if (!room && roomId && req.method === 'POST' && url.pathname === '/start') {
      if (soloRooms.size >= 32) return send(503, { error: 'Limite de leilões locais atingido.' });
      room = createSoloRoom(url.searchParams);
      soloRooms.set(roomId, room);
    }
    const previousPort = url.searchParams.get('previous');
    if (!room && roomId && req.method === 'GET' && url.pathname === '/post-auction' &&
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
    if (room) room.lastSeen = Date.now();
    const auction = roomId || code ? room?.auction : sharedAuction;
    if (url.pathname === '/post-auction' && ['GET', 'POST'].includes(req.method)) {
      if (!room) return send(404, { error: 'Sessão de leilão indisponível.' });
      if (req.method === 'GET') return send(200, postAuction(room, 'read', {}, member?.id ?? 0));
      let payload = '';
      for await (const chunk of req) {
        payload += chunk;
        if (payload.length > 4096) return send(413, { error: 'Dados acima do limite.' });
      }
      if (member && !member.token) return send(401, { error: 'Você não está nesta sala.' });
      const { action, ...input } = JSON.parse(payload);
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
      if (!auction.snapshot()) seedAuction(auction, 8);
      return send(200, { state: publicAuction(auction.tick()), catalogInfo, time: Date.now(), mode: room?.mode });
    }
    if (req.method === 'POST' && ['/bid', '/pass'].includes(url.pathname)) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024) return send(413, { error: 'Lance muito grande.' });
      }
      if (member && !member.token) return send(401, { error: 'Você não está nesta sala.' });
      const { teamId, playerId, amount } = JSON.parse(body);
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
});
setInterval(() => {
  const now = Date.now();
  const state = sharedAuction.snapshot();
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
}, 200).unref();

const port = Number(process.env.AUCTION_DEMO_PORT ?? 4173);
server.listen(port, process.env.AUCTION_DEMO_HOST ?? '127.0.0.1', () => {
  console.log(`LANCEBALL: http://127.0.0.1:${server.address().port}`);
});
