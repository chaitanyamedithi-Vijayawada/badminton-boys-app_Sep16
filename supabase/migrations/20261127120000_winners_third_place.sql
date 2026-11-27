-- Winners board: 3rd place names + photo. Additive only; existing rows get an
-- empty list and no photo. Two teams can share 3rd (both semifinal losers).
alter table public.tournament_winners
  add column if not exists third_place text[] not null default '{}',
  add column if not exists third_place_photo text;
