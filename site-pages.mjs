import { readFile } from 'node:fs/promises';
import { uclClubs, clubCrests } from './supabase/functions/_shared/ucl-clubs.mjs';

async function pageTemplate(file, home = false) {
  const template = await readFile(new URL(file, import.meta.url), 'utf8');
  return template.replace('</title>', '</title>\n<link rel="icon" type="image/png" href="/lanceball-logo.png">')
    .replace('<!-- ARENA_HEADER -->', `
    <header class="arena-header"><div class="arena-nav">
      <a class="arena-brand" href="/"><img class="brand-mark" src="/lanceball-logo.png" width="36" height="36" alt="">LANCEBALL</a>
      <nav aria-label="Navegação principal"><a href="/"${home ? ' aria-current="page"' : ''}>Início</a></nav>
    </div></header>
  `);
}
const [homeTemplate, page, roomTemplate, postPage, arenaCss, roomExitScript, positionScript, arenaBackground] = await Promise.all([
  pageTemplate('./home.html', true),
  pageTemplate('./demo.html'),
  pageTemplate('./room.html'),
  pageTemplate('./post-auction.html'),
  readFile(new URL('./arena.css', import.meta.url)),
  readFile(new URL('./room-exit.js', import.meta.url)),
  readFile(new URL('./positions.mjs', import.meta.url)),
  readFile(new URL('./arena-background.png', import.meta.url)),
]);
function clubOptions(field) {
  return uclClubs.map(club => {
    const initials = club.split(/\s+/).map(word => word[0]).join('').slice(0, 3);
    return `<label class="club-option">
    <input type="radio" name="${field}" value="${club}" required>
    <span class="club-card">
      <span class="club-badge" aria-hidden="true"><span>${initials}</span><img src="${clubCrests.get(club)}" width="38" height="38" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
      <span class="club-name">${club}</span>
    </span>
  </label>`;
  }).join('');
}
const home = homeTemplate.replace('<!-- UCL_CLUBS -->', clubOptions('club'));
const roomPage = roomTemplate.replace('<!-- UCL_CLUBS -->', clubOptions('identity'));

export const siteAssets = new Map([
  ['/', { content: home, type: 'text/html; charset=utf-8', file: 'index.html' }],
  ['/sala', { content: roomPage, type: 'text/html; charset=utf-8', file: 'sala/index.html' }],
  ['/leilao', { content: page, type: 'text/html; charset=utf-8', file: 'leilao/index.html' }],
  ['/pos-leilao', { content: postPage, type: 'text/html; charset=utf-8', file: 'pos-leilao/index.html' }],
  ['/client-api.mjs', { content: await readFile(new URL('./client-api.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8', file: 'client-api.mjs' }],
  ['/edge-config.mjs', { content: await readFile(new URL('./edge-config.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8', file: 'edge-config.mjs' }],
  ['/health', { content: await pageTemplate('./health.html'), type: 'text/html; charset=utf-8', file: 'health/index.html' }],
  ['/arena.css', { content: arenaCss, type: 'text/css; charset=utf-8', file: 'arena.css' }],
  ['/club-badges.mjs', { content: await readFile(new URL('./club-badges.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8', file: 'club-badges.mjs' }],
  ['/formations.mjs', { content: await readFile(new URL('./supabase/functions/_shared/formations.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8', file: 'formations.mjs' }],
  ['/positions.mjs', { content: positionScript, type: 'text/javascript; charset=utf-8', file: 'positions.mjs' }],
  ['/room-exit.js', { content: roomExitScript, type: 'text/javascript; charset=utf-8', file: 'room-exit.js' }],
  ['/lanceball-logo.png', { content: await readFile(new URL('./lanceball-logo.png', import.meta.url)), type: 'image/png', file: 'lanceball-logo.png' }],
  ['/arena-background.png', { content: arenaBackground, type: 'image/png', file: 'arena-background.png' }],
]);
