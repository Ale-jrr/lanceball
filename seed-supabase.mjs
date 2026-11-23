import { readFile } from 'node:fs/promises';
import { supabaseStore } from './supabase-store.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY.');

const catalog = JSON.parse((await readFile(new URL('./catalog.json', import.meta.url), 'utf8')).trim());
const store = supabaseStore(url, key);
await store.seed(catalog.players);
const records = await store.players();
const stored = new Map(records.map(player => [player.id, player.overall]));
if (catalog.players.some(player => stored.get(player.id) !== player.overall)) {
  throw Error('Importação incompleta. Confira o catálogo.');
}
console.log(`${catalog.players.length} jogadores conferidos no Supabase.`);
