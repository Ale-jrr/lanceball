import { arenaFetch, liveUpdates } from '/client-api.mjs';

const room = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (room) setupChat(room);

function setupChat(room) {
  const tokenKey = 'arena-member:' + room;
  const seenKey = 'lanceball-chat-seen:' + room;
  const wrapper = document.createElement('div');
  wrapper.className = 'room-chat';
  wrapper.hidden = true;
  wrapper.innerHTML = `
    <button type="button" class="chat-toggle" aria-controls="room-chat-panel" aria-expanded="false">
      Chat <span class="chat-count" hidden></span>
    </button>
    <dialog id="room-chat-panel" class="chat-panel" aria-labelledby="chat-title">
      <header><h2 id="chat-title">Chat da sala</h2><button type="button" class="quiet chat-close">Fechar</button></header>
      <ol class="chat-messages" aria-label="Mensagens" tabindex="0"></ol>
      <p class="chat-status" role="status"></p>
      <form class="chat-compose">
        <input aria-label="Mensagem" placeholder="Escreva uma mensagem" maxlength="280" required autocomplete="off">
        <button type="submit" class="primary">Enviar</button>
      </form>
    </dialog>`;
  document.body.append(wrapper);

  const find = selector => wrapper.querySelector(selector);
  const panel = find('dialog');
  const toggle = find('.chat-toggle');
  const launcher = document.querySelector('[data-room-chat-launcher]');
  if (launcher) launcher.append(toggle);
  toggle.hidden = true;
  const badge = find('.chat-count');
  const list = find('ol');
  const status = find('.chat-status');
  const input = find('input');
  const submit = find('[type=submit]');
  const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
  let token;
  let stop;
  let messages = [];
  let version = 0;
  let sending = false;
  let seen = sessionStorage.getItem(seenKey);

  function updateBadge() {
    const lastSeen = messages.findLastIndex(message => message.id === seen);
    const unread = panel.open ? 0 : messages.length - lastSeen - 1;
    badge.hidden = !unread;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    toggle.setAttribute('aria-label', unread ? 'Chat da sala, ' + unread + ' mensagens novas' : 'Chat da sala');
  }

  function markSeen() {
    if (!messages.length) return;
    seen = messages.at(-1).id;
    sessionStorage.setItem(seenKey, seen);
  }

  function render(next) {
    if (next.length === messages.length && next.at(-1)?.id === messages.at(-1)?.id && list.childElementCount) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 42;
    messages = next;
    list.replaceChildren(...(next.length ? next.map(message => {
      const row = document.createElement('li');
      const byline = document.createElement('div');
      byline.className = 'chat-byline';
      const author = document.createElement('strong');
      const time = document.createElement('time');
      const body = document.createElement('p');
      author.textContent = message.name;
      if (message.crestUrl) {
        const crest = document.createElement('img');
        crest.src = message.crestUrl;
        crest.alt = message.club ?? '';
        crest.width = 20;
        crest.height = 20;
        crest.addEventListener('error', () => crest.remove(), { once: true });
        byline.append(crest);
      }
      time.dateTime = new Date(message.time).toISOString();
      time.textContent = clock.format(message.time);
      body.textContent = message.text;
      byline.append(author, time);
      row.append(byline, body);
      return row;
    }) : [Object.assign(document.createElement('li'), { textContent: 'A conversa começa aqui.' })]));
    if (atBottom) list.scrollTop = list.scrollHeight;
    if (panel.open) markSeen();
    updateBadge();
  }

  async function request(body) {
    const requestToken = token;
    const response = await arenaFetch('/chat?' + new URLSearchParams({ room }), {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + requestToken },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (response.status === 401 || response.status === 404) {
      if (token === requestToken) deactivate();
      return null;
    }
    if (!response.ok) throw Error(result.error);
    return result.messages;
  }

  async function refresh() {
    if (!token || sending) return;
    const requestVersion = version;
    try {
      const next = await request();
      if (next && requestVersion === version) {
        render(next);
        status.textContent = '';
      }
    } catch {
      if (panel.open && requestVersion === version) status.textContent = 'Não foi possível atualizar o chat.';
    }
  }

  function deactivate() {
    version++;
    stop?.();
    stop = undefined;
    token = null;
    if (panel.open) panel.close();
    messages = [];
    list.replaceChildren();
    wrapper.hidden = true;
    toggle.hidden = true;
  }

  function connect() {
    const nextToken = localStorage.getItem(tokenKey);
    if (nextToken === token) return;
    deactivate();
    if (!nextToken) return;
    token = nextToken;
    wrapper.hidden = false;
    toggle.hidden = false;
    updateBadge();
    stop = liveUpdates(room, refresh, connected => panel.open ? 1000 : connected ? 3000 : 1800, 'chat');
  }

  toggle.onclick = () => {
    if (panel.open) { panel.close(); return; }
    if (matchMedia('(max-width: 720px)').matches) panel.showModal();
    else panel.show();
    toggle.setAttribute('aria-expanded', 'true');
    markSeen();
    updateBadge();
    list.scrollTop = list.scrollHeight;
    refresh();
  };
  find('.chat-close').onclick = () => panel.close();
  panel.addEventListener('close', () => {
    toggle.setAttribute('aria-expanded', 'false');
    updateBadge();
    if (!wrapper.hidden) toggle.focus();
  });
  find('form').onsubmit = async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sending || !token) return;
    const requestVersion = ++version;
    sending = submit.disabled = true;
    try {
      const next = await request({ text });
      if (next && requestVersion === version) {
        render(next);
        if (input.value.trim() === text) input.value = '';
        list.scrollTop = list.scrollHeight;
        status.textContent = '';
      }
    } catch (error) {
      if (requestVersion === version) status.textContent = error.message;
    } finally {
      sending = submit.disabled = false;
    }
  };
  window.addEventListener('arena-room-membership-changed', connect);
  window.addEventListener('storage', event => { if (event.key === tokenKey) connect(); });
  connect();
}
