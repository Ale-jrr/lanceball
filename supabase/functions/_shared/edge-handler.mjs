import { Buffer } from 'node:buffer';
import { persistentHandler, sendJson } from './persistent-handler.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-lanceball-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
};

export function edgeHandler(store, defer) {
  const game = persistentHandler(store, defer);
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const incoming = new URL(request.url);
    const path = incoming.searchParams.get('route') ?? '/health';
    incoming.searchParams.delete('route');
    if (!/^\/[a-z-]+$/.test(path)) return Response.json({ error: 'Rota inválida.' }, { status: 404, headers: cors });
    if (path === '/health') {
      try {
        const [players] = await Promise.all([store.players(), store.load('health-check')]);
        return Response.json({
          armazenamento: 'Supabase', servidor: 'Edge Function', jogadores: players.length,
          status: players.length >= 200 ? 'OK' : 'Catálogo ainda não importado',
        }, { status: players.length >= 200 ? 200 : 503, headers: cors });
      } catch {
        return Response.json({ armazenamento: 'Supabase', status: 'Banco indisponível' }, { status: 503, headers: cors });
      }
    }
    const token = request.headers.get('x-lanceball-token');
    const req = {
      method: request.method, url: path + incoming.search, headers: {
        authorization: token ? 'Bearer ' + token : undefined,
      },
      socket: { remoteAddress: request.headers.get('cf-connecting-ip') ??
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown' },
      async *[Symbol.asyncIterator]() {
        if (!request.body) return;
        for await (const chunk of request.body) yield Buffer.from(chunk);
      },
    };
    const headers = new Headers(cors);
    let status = 500;
    let body = '';
    const res = {
      setHeader(name, value) { headers.set(name, value); },
      writeHead(code, values = {}) {
        status = code;
        for (const [name, value] of Object.entries(values)) headers.set(name, value);
        return this;
      },
      end(result) { body = result; },
    };
    try {
      await game(req, res);
    } catch {
      sendJson(res, 503, { error: 'Servidor da partida indisponível.' });
    }
    return new Response(body, { status, headers });
  };
}
