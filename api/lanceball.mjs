import { handleRequest, requestUrl } from '../demo.mjs';
import { persistentHandler } from '../persistent-handler.mjs';
import { supabaseStore } from '../supabase-store.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const store = url && key ? supabaseStore(url, key) : null;
const persisted = store ? persistentHandler(store) : null;
const gameRoutes = new Set(['/rooms', '/room', '/state', '/start', '/bid', '/pass', '/post-auction']);

function json(response, code, data) {
  return response.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  }).end(JSON.stringify(data));
}

export default async function lanceball(request, response) {
  const { pathname } = requestUrl(request);
  if (request.method === 'GET' && pathname === '/health') {
    if (!store) return json(response, url || key ? 503 : 200, {
      armazenamento: 'memória', status: 'Supabase não configurado',
    });
    try {
      const [players] = await Promise.all([store.players(), store.load('health-check')]);
      const ready = players.length >= 200;
      return json(response, ready ? 200 : 503, {
        armazenamento: 'Supabase', jogadores: players.length,
        status: ready ? 'OK' : 'Catálogo ainda não importado',
      });
    } catch (error) {
      console.error('LANCEBALL storage:', error.message);
      return json(response, 503, {
        armazenamento: 'Supabase', status: 'Sem conexão com o banco ou tabelas indisponíveis',
      });
    }
  }
  if (persisted) return persisted(request, response);
  if ((url || key) && gameRoutes.has(pathname)) {
    return json(response, 503, { error: 'A configuração do Supabase na Vercel está incompleta.' });
  }
  return handleRequest(request, response);
}
