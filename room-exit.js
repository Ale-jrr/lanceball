import { arenaFetch } from '/client-api.mjs';
const button = document.querySelector('[data-leave-room]');
const params = new URLSearchParams(location.search);
const code = params.get('room')?.toUpperCase();
const key = 'arena-member:' + code;

function currentToken() {
  return code ? localStorage.getItem(key) : null;
}

function refresh() {
  const solo = params.has('solo') || params.has('mode');
  button.hidden = !(currentToken() || solo);
  if (!code && solo) button.textContent = 'Sair da partida';
}

refresh();
window.addEventListener('arena-room-membership-changed', refresh);

button.addEventListener('click', async () => {
  if (!window.confirm('Quer sair desta partida?')) return;
  const token = currentToken();
  button.disabled = true;
  try {
    if (token) {
      const response = await arenaFetch('/room?' + new URLSearchParams({ room: code }), {
        method: 'POST', headers: { Authorization: 'Bearer ' + token },
        body: JSON.stringify({ action: 'leave' }),
      });
      if (!response.ok && ![401, 404].includes(response.status)) {
        throw Error((await response.json()).error);
      }
      localStorage.removeItem(key);
    }
    location.replace('/');
  } catch (error) {
    const status = document.querySelector('[role=status]');
    if (status) status.textContent = error.message;
    button.disabled = false;
  }
});
