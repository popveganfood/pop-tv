-- POP TV — esquema inicial
-- ponytail: inquilino único (POP Vegan Food). Multi-organização = adicionar organization_id nas tabelas raiz.

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('admin','marketing','manager')),
  all_units boolean not null default false,          -- marketing/gerente com acesso a todas as unidades
  can_manage_screens boolean not null default false, -- liberação extra para gerente
  can_publish boolean not null default false,        -- liberação extra para gerente
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id);

create table collections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text check (kind in ('image','video')),
  mime text,
  storage_key text,               -- arquivo atual (null enquanto o primeiro upload não termina)
  pending_key text,               -- upload em andamento (novo ou substituição)
  pending_mime text,
  thumb_key text,                 -- miniatura de vídeo (opcional)
  size_bytes bigint,
  width int,
  height int,
  duration_ms int,
  codec text,
  compat text check (compat in ('ok','warning','incompatible')),
  compat_notes text,
  tags text[] not null default '{}',
  collection_id uuid references collections(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','ready')),
  file_version int not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index media_assets_live_idx on media_assets(created_at desc) where deleted_at is null;

create table units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  city text not null default '',
  state text not null default '',
  timezone text not null default 'America/Sao_Paulo',
  contact_name text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  image_media_id uuid references media_assets(id) on delete set null,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_units (
  user_id uuid not null references users(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  primary key (user_id, unit_id)
);

create table environments (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index environments_unit_idx on environments(unit_id);

create table screens (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  environment_id uuid references environments(id) on delete set null,
  name text not null,
  manufacturer text not null default '',
  model text not null default '',
  orientation text not null default 'landscape' check (orientation in ('landscape','portrait')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- último estado reportado pela TV (heartbeat). ponytail: só o último; histórico = device_logs (erros).
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  last_ip text,
  user_agent text,
  capabilities jsonb,
  reported_version text,
  playback_state text,
  current_item text,
  last_error text,
  last_error_at timestamptz
);
create index screens_unit_idx on screens(unit_id);

create table screen_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  unit_id uuid references units(id) on delete cascade, -- null = grupo entre unidades
  created_at timestamptz not null default now()
);

create table screen_group_members (
  group_id uuid not null references screen_groups(id) on delete cascade,
  screen_id uuid not null references screens(id) on delete cascade,
  primary key (group_id, screen_id)
);
create index screen_group_members_screen_idx on screen_group_members(screen_id);

create table playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  published_version_id uuid,        -- versão em vigor (fk adicionada abaixo)
  draft_updated_at timestamptz not null default now(),
  archived_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references playlists(id) on delete cascade,
  position int not null,
  media_id uuid not null references media_assets(id) on delete restrict,
  duration_ms int check (duration_ms is null or duration_ms between 1000 and 3600000)
);
create index playlist_items_playlist_idx on playlist_items(playlist_id, position);
create index playlist_items_media_idx on playlist_items(media_id);

-- snapshot imutável do que foi publicado
create table published_versions (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references playlists(id) on delete cascade,
  version int not null,
  items jsonb not null,
  note text not null default '',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (playlist_id, version)
);
alter table playlists add constraint playlists_published_fk
  foreign key (published_version_id) references published_versions(id) on delete set null;

create table organizations (
  id int primary key default 1 check (id = 1),
  name text not null,
  fallback_playlist_id uuid references playlists(id) on delete set null,
  offline_after_seconds int not null default 90 check (offline_after_seconds between 30 and 3600)
);

-- regra de exibição = publicação + agendamento (um conceito só)
create table schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  playlist_id uuid not null references playlists(id) on delete restrict,
  target_type text not null check (target_type in ('all','unit','group','screen')),
  target_id uuid,
  priority int not null default 10 check (priority in (10, 50, 100)), -- Padrão, Campanha, Emergência
  start_at timestamp,   -- hora local da unidade (sem fuso, de propósito)
  end_at timestamp,     -- exclusivo
  time_start time,      -- janela diária (local)
  time_end time,
  weekdays int[],       -- 0=domingo … 6=sábado; null = todos
  enabled boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((target_type = 'all') = (target_id is null)),
  check (priority <> 100 or end_at is not null),
  check (start_at is null or end_at is null or end_at > start_at),
  check ((time_start is null) = (time_end is null)),
  check (time_start is null or time_start <> time_end)
);
create index schedules_playlist_idx on schedules(playlist_id);

create table pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  poll_token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  screen_id uuid references screens(id) on delete cascade,
  consumed_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now()
);
create unique index pairing_sessions_open_code on pairing_sessions(code) where claimed_at is null;

create table device_credentials (
  id uuid primary key default gen_random_uuid(),
  screen_id uuid not null references screens(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index device_credentials_screen_idx on device_credentials(screen_id);

create table device_logs (
  id bigserial primary key,
  screen_id uuid not null references screens(id) on delete cascade,
  level text not null default 'error',
  message text not null,
  created_at timestamptz not null default now()
);
create index device_logs_screen_idx on device_logs(screen_id, created_at desc);

create table audit_logs (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs(created_at desc);
