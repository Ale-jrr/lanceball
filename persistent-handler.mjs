import { isDeepStrictEqual } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { openAuction } from './auction.mjs';
import { catalogInfo, handleRequest, requestUrl } from './demo.mjs';

const sessionDuration = 30 * 60_000;
const gameRoutes = new Set(['/rooms', '/room', '/state', '/start', '/bid', '/pass', '/post-auction']);

function scope(url) {
  if (url.pathname === '/rooms') return { type: 'create' };
  const code = url.searchParams.get('room')?.toUpperCase();
  if (code) return /^[A-F0-9]{8}$/.test(code) ? { type: 'online', code, id: 'room:' + code } : null;
  const id = url.searchParams.get('solo');
  if (id) return /^[0-9a-f-]{36}$/i.test(id) ? { type: 'solo', code: id, id: 'solo:' + id } : null;
  if (url.pathname === '/room' || url.pathname === '/post-auction') return null;
  return { type: 'shared', id: 'shared' };
}

function packRoom(room) {
  const { auction, botWindows, salt, secret, post, ...data } = room;
  let postseason = post;
  if (post?.model) {
    const { season, ...saved } = post;
    postseason = saved;
  }
  return {
    ...data, auction: auction?.snapshot() ?? null, botWindows: [...(botWindows ?? [])],
    salt: salt?.toString('base64') ?? null, secret: secret?.toString('base64') ?? null, post: postseason,
  };
}

function unpackRoom(data) {
  const { auction, botWindows, salt, secret, ...room } = data;
  return {
    ...room, auction: auction ? openAuction(':memory:', Date.now, auction) : undefined,
    botWindows: new Set(botWindows),
    salt: salt ? Buffer.from(salt, 'base64') : null,
    secret: secret ? Buffer.from(secret, 'base64') : null,
  };
}

async function copyRequest(req) {
  const headers = req.headers;
  let body = req.body;
  if (req.method === 'POST') {
    if (body !== undefined && body !== null) {
      body = Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
      if (Buffer.byteLength(body) > 4096) throw Error('Dados acima do limite.');
    } else {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 4096) throw Error('Dados acima do limite.');
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
  }
  return { method: req.method, url: req.url, headers, socket: req.socket, body };
}

function responseBuffer() {
  return {
    status: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.status = status; return this; },
    end(body) { this.body = body; },
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(JSON.stringify(data));
}

function newRuntime(type, code, data, catalog) {
  const runtime = {
    onlineRooms: new Map(), soloRooms: new Map(), sharedAuction: null,
    joinAttempts: new Map(data?.joinAttempts), catalog,
  };
  if (type === 'shared') runtime.sharedAuction = openAuction(':memory:', Date.now, data?.auction);
  if (data?.room) {
    (type === 'online' ? runtime.onlineRooms : runtime.soloRooms).set(code, unpackRoom(data.room));
  }
  return runtime;
}

function capture(runtime, target, previous) {
  if (target.type === 'shared') {
    const auction = runtime.sharedAuction.snapshot();
    return auction ? { payload: { auction }, public_info: null,
      expires_at: previous?.expires_at && Date.parse(previous.expires_at) - Date.now() > sessionDuration - 15_000
        ? previous.expires_at : new Date(Date.now() + sessionDuration).toISOString() } : null;
  }
  const rooms = target.type === 'solo' ? runtime.soloRooms : runtime.onlineRooms;
  const room = target.type === 'create' ? rooms.values().next().value : rooms.get(target.code);
  if (!room) return null;
  return {
    payload: { room: packRoom(room), joinAttempts: [...runtime.joinAttempts] },
    public_info: target.type !== 'solo' && !room.secret && !room.auction
      ? { code: room.code, name: room.name, mode: room.mode, size: room.size, count: room.members.length } : null,
    expires_at: new Date(room.lastSeen + sessionDuration).toISOString(),
  };
}

function sameValue(row, next) {
  if (!row || !next) return !row && !next;
  return Date.parse(row.expires_at) === Date.parse(next.expires_at) &&
    isDeepStrictEqual(row.payload, JSON.parse(JSON.stringify(next.payload))) &&
    isDeepStrictEqual(row.public_info, next.public_info);
}

export function persistentHandler(store) {
  let catalogPromise;
  let catalogExpiry = 0;
  function catalog() {
    if (!catalogPromise || Date.now() >= catalogExpiry) {
      catalogExpiry = Date.now() + 60_000;
      catalogPromise = store.players().then(players => {
        if (players.length < 200) throw Error('Catálogo do Supabase precisa ser importado.');
        return { ...catalogInfo, players };
      }).catch(error => {
        catalogPromise = undefined;
        throw error;
      });
    }
    return catalogPromise;
  }

  return async function handlePersistent(req, res) {
    const url = requestUrl(req);
    if (!gameRoutes.has(url.pathname)) return handleRequest(req, res);
    try {
      if (url.pathname === '/rooms' && req.method === 'GET') return sendJson(res, 200, await store.list());
      const target = scope(url);
      if (!target) return sendJson(res, 400, { error: 'Código de sala ou sessão inválido.' });
      const request = await copyRequest(req);
      const startRoom = url.pathname === '/room' && req.method === 'POST' &&
        Buffer.byteLength(request.body ?? '') > 0 && JSON.parse(request.body.toString()).action === 'start';
      let source;
      for (let attempt = 0; attempt < 8; attempt++) {
        const previous = target.id ? await store.load(target.id) : null;
        const active = previous && Date.parse(previous.expires_at) > Date.now() ? previous : null;
        const needsCatalog = req.method === 'POST' && ((startRoom && active?.payload.room && !active.payload.room.auction) ||
          (url.pathname === '/start' && target.type !== 'online' && !active));
        if (needsCatalog) source ??= await catalog();
        const runtime = newRuntime(target.type, target.code, active ? structuredClone(active.payload) : null, source);
        try {
          const output = responseBuffer();
          await handleRequest(request, output, runtime);
          const next = capture(runtime, target, active);
          const id = target.id ?? (next && 'room:' + next.payload.room.code);
          if (sameValue(previous, next) || await store.save(id, previous, next)) {
            res.writeHead(output.status, output.headers).end(output.body);
            return;
          }
        } finally {
          runtime.sharedAuction?.close();
          for (const room of [...runtime.onlineRooms.values(), ...runtime.soloRooms.values()]) room.auction?.close();
        }
        await setTimeout(8 * (attempt + 1));
      }
      return sendJson(res, 503, { error: 'A sala está ocupada. Tente novamente.' });
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'Dados acima do limite.') {
        return sendJson(res, 400, { error: 'Formato ou tamanho dos dados inválido.' });
      }
      console.error('LANCEBALL:', error.message);
      return sendJson(res, 503, { error: 'O armazenamento do jogo está indisponível.' });
    }
  };
}
