import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { clubCrests } from './ucl-clubs.mjs';

export const onlineRooms = new Map();

function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw Error('Confira os nomes e as opções da sala.');
  }
  return value.trim();
}

function passwordHash(password, salt) {
  return scryptSync(password, salt, 32);
}

function addMember(room, input) {
  const name = text(input.team, 30);
  const identity = text(input.identity, 40);
  const choices = clubCrests;
  if (!choices.has(identity)) throw Error('Escolha um clube ou seleção disponível.');
  if (room.members.some(member => member.identity === identity)) throw Error('Esta equipe já foi escolhida.');
  if (room.members.length >= room.size) throw Error('A sala está cheia.');
  const member = {
    id: room.members.length, name, identity, crestUrl: choices.get(identity),
    token: randomBytes(24).toString('hex'),
  };
  room.members.push(member);
  room.lastSeen = Date.now();
  return member;
}

export function publicRooms() {
  return [...onlineRooms.values()].filter(room => !room.secret && !room.auction).map(room => ({
    code: room.code, name: room.name, mode: room.mode, size: room.size, count: room.members.length,
  }));
}

export function hostId(room) {
  return room.members.find(member => member.token)?.id;
}

export function leaveRoom(room, member) {
  if (!room.auction) {
    room.members.splice(room.members.indexOf(member), 1);
    room.members.forEach((entry, id) => { entry.id = id; });
  } else {
    room.auction.handOverToBot(member.id);
    if (room.post) room.post.teams[member.id].bot = true;

  }
  member.token = null;
  if (hostId(room) === undefined) {
    room.auction?.close();
    onlineRooms.delete(room.code);
  }
}

export function lobby(room, member) {
  return {
    code: room.code, name: room.name, mode: room.mode, size: room.size,
    private: Boolean(room.secret), started: Boolean(room.auction), you: member?.id ?? null, host: hostId(room),
    members: room.members.map(({ id, name, identity }) => ({ id, name, identity })),
    choices: [...clubCrests.keys()],
  };
}

export function authorize(room, header) {
  const member = room?.members.find(entry => entry.token && header === 'Bearer ' + entry.token);
  if (member) room.lastSeen = Date.now();
  return member;
}

export function createRoom(input) {
  if (onlineRooms.size >= 64) throw Error('Limite de salas atingido.');
  const name = text(input.name, 40);
  const { mode, size } = input;
  if (mode !== 'ucl' || ![4, 6, 8].includes(size)) throw Error('Competição ou número de equipes inválido.');
  const password = input.password ?? '';
  if (typeof password !== 'string' || password.length > 64) throw Error('Senha inválida.');
  let code;
  do { code = randomBytes(4).toString('hex').toUpperCase(); } while (onlineRooms.has(code));
  const salt = password ? randomBytes(16) : null;
  const room = { code, name, mode, size, salt, secret: salt ? passwordHash(password, salt) : null, members: [] };
  const member = addMember(room, input);
  onlineRooms.set(code, room);
  return { ...lobby(room, member), token: member.token };
}

export function joinRoom(room, input) {
  if (room.auction) throw Error('O leilão desta sala já começou.');
  const password = input.password ?? '';
  if (room.secret && (typeof password !== 'string' || password.length > 64 ||
      !timingSafeEqual(room.secret, passwordHash(password, room.salt)))) throw Error('Senha incorreta.');
  const member = addMember(room, input);
  return { ...lobby(room, member), token: member.token };
}

export function roomIdentities(room) {
  const members = room.members.map(({ name, identity, crestUrl }) => ({ name, identity, crestUrl }));
  const used = new Set(members.map(member => member.identity));
  const bots = [...clubCrests].filter(([name]) => !used.has(name))
    .slice(0, room.size - members.length).map(([name, crestUrl]) => ({
      name, identity: name, crestUrl, bot: true,
    }));
  return [...members, ...bots];
}
