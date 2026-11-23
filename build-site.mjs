import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { siteAssets } from './site-pages.mjs';

export async function buildSite(directory, env = process.env) {
  const configUrl = (env.LANCEBALL_SUPABASE_URL ?? env.SUPABASE_URL)?.trim();
  const publicKey = env.LANCEBALL_SUPABASE_PUBLISHABLE_KEY?.trim();
  if ((env.VERCEL === '1' || publicKey) && (!configUrl || !publicKey)) {
    throw Error('Configure LANCEBALL_SUPABASE_URL e LANCEBALL_SUPABASE_PUBLISHABLE_KEY na Vercel.');
  }
  if (publicKey && !publicKey.startsWith('sb_publishable_')) {
    throw Error('Use somente a chave pública do Supabase no frontend (sb_publishable_).');
  }
  const config = publicKey ? { url: new URL(configUrl).origin, publicKey } : null;
  for (const [route, asset] of siteAssets) {
    const path = resolve(directory, asset.file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, route === '/edge-config.mjs'
      ? 'export const connection = ' + JSON.stringify(config) + ';\n' : asset.content);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await buildSite(fileURLToPath(new URL('./dist', import.meta.url)));
}
