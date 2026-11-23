create table if not exists public.lanceball_sessions (
  id text primary key,
  revision uuid not null,
  payload jsonb not null,
  public_info jsonb,
  expires_at timestamptz not null
);

create index if not exists lanceball_sessions_expiry
  on public.lanceball_sessions (expires_at);
create index if not exists lanceball_public_rooms
  on public.lanceball_sessions (expires_at desc) where public_info is not null;

create table if not exists public.lanceball_players (
  id text primary key,
  name text not null,
  position text not null check (position in ('GK', 'DEF', 'MID', 'FWD')),
  overall smallint not null check (overall between 78 and 100),
  club text,
  nationality text,
  "primaryPosition" text
);

alter table public.lanceball_sessions enable row level security;
alter table public.lanceball_players enable row level security;
revoke all on public.lanceball_sessions, public.lanceball_players from public, anon, authenticated;
grant select, insert, update, delete on public.lanceball_sessions, public.lanceball_players to service_role;
