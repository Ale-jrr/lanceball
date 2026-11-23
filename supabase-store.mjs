import { randomUUID } from 'node:crypto';

const sessionTable = 'lanceball_sessions';
const playerTable = 'lanceball_players';

export function supabaseStore(url, key, fetcher = fetch) {
  const endpoint = new URL('/rest/v1/', url);
  const authorization = key.startsWith('sb_secret_') ? {} : { Authorization: 'Bearer ' + key };

  function request(table, query, method = 'GET', body, prefer) {
    const resource = new URL(table, endpoint);
    resource.search = new URLSearchParams(query);
    return fetcher(resource, {
      method, cache: 'no-store', signal: AbortSignal.timeout(7000),
      headers: {
        apikey: key, ...authorization,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function rows(response, operation) {
    if (!response.ok) throw Error(operation + ' Supabase HTTP ' + response.status);
    return response.json();
  }

  return {
    async load(id) {
      const response = await request(sessionTable, { id: 'eq.' + id, select: 'revision,payload,public_info,expires_at' });
      return (await rows(response, 'Leitura da sessão'))[0] ?? null;
    },
    async list() {
      const response = await request(sessionTable, {
        public_info: 'not.is.null', expires_at: 'gt.' + new Date().toISOString(),
        select: 'public_info', order: 'expires_at.desc', limit: 64,
      });
      return (await rows(response, 'Listagem de salas')).map(row => row.public_info);
    },
    async save(id, previous, next) {
      const query = previous ? { id: 'eq.' + id, revision: 'eq.' + previous.revision, select: 'id' } : { select: 'id' };
      if (!next && !previous) return true;
      const method = !next ? 'DELETE' : previous ? 'PATCH' : 'POST';
      const body = next && {
        ...next, ...(previous ? {} : { id }), revision: randomUUID(),
      };
      const response = await request(sessionTable, query, method, body, 'return=representation');
      if (!previous && response.status === 409) return false;
      return (await rows(response, 'Gravação da sessão')).length === 1;
    },
    async players() {
      const result = [];
      const limit = 200;
      for (let offset = 0; ; offset += limit) {
        const response = await request(playerTable, { select: '*', order: 'id', limit, offset });
        const batch = await rows(response, 'Leitura do catálogo');
        result.push(...batch);
        if (batch.length < limit) return result;
      }
    },
    async seed(players) {
      for (let position = 0; position < players.length; position += 200) {
        const response = await request(playerTable, { on_conflict: 'id' }, 'POST',
          players.slice(position, position + 200), 'resolution=merge-duplicates,return=minimal');
        if (!response.ok) throw Error('Importação do catálogo Supabase HTTP ' + response.status);
      }
    },
  };
}
