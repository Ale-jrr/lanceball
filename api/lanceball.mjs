import { handleRequest } from '../demo.mjs';
import { persistentHandler } from '../persistent-handler.mjs';
import { supabaseStore } from '../supabase-store.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const persisted = url && key ? persistentHandler(supabaseStore(url, key)) : null;

export default function lanceball(request, response) {
  if (persisted) return persisted(request, response);
  if (url || key) {
    response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
      .end(JSON.stringify({ error: 'Configure a URL e a chave do Supabase.' }));
    return;
  }
  return handleRequest(request, response);
}
