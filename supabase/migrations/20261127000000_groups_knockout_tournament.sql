-- Groups + knockout tournament format (2 groups of 6 → QF → SF → Final).
-- Additive only: existing round-robin tournaments keep working unchanged.

alter table public.tournaments
  add column if not exists semi_best_of  integer not null default 1,
  add column if not exists final_best_of integer not null default 3,
  add column if not exists third_best_of integer not null default 1;

alter table public.tournament_teams
  add column if not exists group_name text;        -- 'A' / 'B' (null for round robin)

alter table public.tournament_matches
  add column if not exists group_name text,        -- 'A' / 'B' for group matches
  add column if not exists label text,             -- 'QF1'..'QF4','SF1','SF2','FINAL','THIRD'
  add column if not exists games jsonb;            -- [[21,18],[19,21],...] for knockout matches

-- Knockout matches in the new format start with no teams (decided later).
alter table public.tournament_matches alter column team_a drop not null;
alter table public.tournament_matches alter column team_b drop not null;
