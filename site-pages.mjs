import { readFile } from 'node:fs/promises';
import { uclClubs, clubCrests } from './supabase/functions/_shared/ucl-clubs.mjs';

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

export const siteAssets = new Map([
  ['/', { content: home, type: 'text/html; charset=utf-8', file: 'index.html' }],
  ['/sala', { content: roomPage, type: 'text/html; charset=utf-8', file: 'sala/index.html' }],
  ['/leilao', { content: page, type: 'text/html; charset=utf-8', file: 'leilao/index.html' }],
  ['/pos-leilao', { content: postPage, type: 'text/html; charset=utf-8', file: 'pos-leilao/index.html' }],
  ['/campeonato', { content: tournamentPage, type: 'text/html; charset=utf-8', file: 'campeonato/index.html' }],
  ['/client-api.mjs', { content: await readFile(new URL('./client-api.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8', file: 'client-api.mjs' }],
  ['/edge-config.mjs', { content: await readFile(new URL('./edge-config.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8', file: 'edge-config.mjs' }],
  ['/health', { content: await readFile(new URL('./health.html', import.meta.url)), type: 'text/html; charset=utf-8', file: 'health/index.html' }],
  ['/arena.css', { content: arenaCss, type: 'text/css; charset=utf-8', file: 'arena.css' }],
  ['/formations.mjs', { content: await readFile(new URL('./supabase/functions/_shared/formations.mjs', import.meta.url)), type: 'text/javascript; charset=utf-8', file: 'formations.mjs' }],
  ['/positions.mjs', { content: positionScript, type: 'text/javascript; charset=utf-8', file: 'positions.mjs' }],
  ['/room-exit.js', { content: roomExitScript, type: 'text/javascript; charset=utf-8', file: 'room-exit.js' }],
  ['/arena-background.png', { content: arenaBackground, type: 'image/png', file: 'arena-background.png' }],
]);
