import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCatalogDatabase } from './catalog-db.mjs';
import { openAuction } from './auction.mjs';
import { rosterQuotas } from './supabase/functions/_shared/fut7.mjs';
import { onlineRooms } from './supabase/functions/_shared/rooms.mjs';
import { handleGameRequest, maintainRooms, requestUrl } from './supabase/functions/_shared/game-api.mjs';
import { siteAssets } from './site-pages.mjs';

export { requestUrl };

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
const standalone = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
const databasePath = process.env.AUCTION_CATALOG_DB ?? (!standalone || process.env.AUCTION_CATALOG
  ? ':memory:' : fileURLToPath(new URL('./catalog.sqlite', import.meta.url)));
catalog = loadCatalogDatabase(databasePath, catalog);
export const catalogInfo = { source: catalog.source, edition: catalog.edition, url: catalog.url, license: catalog.license };

const localRuntime = { onlineRooms, soloRooms, sharedAuction, joinAttempts: new Map(),
  openAuction, catalog, catalogInfo, restoreLocal: standalone, maintain: !standalone };

export async function handleRequest(req, res) {
  const asset = req.method === 'GET' && siteAssets.get(requestUrl(req).pathname);
  if (asset) return res.writeHead(200, { 'Content-Type': asset.type }).end(asset.content);
  return handleGameRequest(req, res, localRuntime);
}

if (standalone) {
  const server = createServer(handleRequest);
  setInterval(() => maintainRooms(localRuntime), 200).unref();
  const port = Number(process.env.PORT ?? process.env.AUCTION_DEMO_PORT ?? 4173);
  server.listen(port, process.env.AUCTION_DEMO_HOST ?? '127.0.0.1', () => {
    console.log(`LANCEBALL: http://127.0.0.1:${server.address().port}`);
  });
}
