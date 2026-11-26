-- Indexes for foreign keys flagged by the Supabase performance advisor.
-- transactions.player_id matters most: balances sum every row per player.
-- Additive only; no data changes. NOT YET APPLIED to the live project.

create index if not exists transactions_player_id_idx      on public.transactions (player_id);
create index if not exists transactions_misc_charge_id_idx on public.transactions (misc_charge_id);
create index if not exists transactions_session_id_idx     on public.transactions (session_id);
create index if not exists misc_charges_created_by_idx     on public.misc_charges (created_by);
create index if not exists tournament_matches_team_a_idx   on public.tournament_matches (team_a);
create index if not exists tournament_matches_team_b_idx   on public.tournament_matches (team_b);
