create table if not exists public.player_passkeys (
  id text primary key,                       -- credential id (base64url)
  player_name text not null,
  public_key text not null,                  -- base64url COSE public key (not secret)
  counter bigint not null default 0,
  transports text[] default '{}',
  device_label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists player_passkeys_player_idx on public.player_passkeys (player_name);

create table if not exists public.passkey_challenges (
  player_name text not null,
  kind text not null check (kind in ('register','login')),
  challenge text not null,
  created_at timestamptz not null default now(),
  primary key (player_name, kind)
);

-- Server-only: RLS on with NO policies, so anon/authenticated can't touch these.
alter table public.player_passkeys enable row level security;
alter table public.passkey_challenges enable row level security;
revoke all on public.player_passkeys from anon, authenticated;
revoke all on public.passkey_challenges from anon, authenticated;
