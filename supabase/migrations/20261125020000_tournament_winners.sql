create table if not exists public.tournament_winners (
  id uuid primary key default gen_random_uuid(),
  tournament_name text not null,
  played_on date,
  played_month text,                 -- 'YYYY-MM'
  champions text[] not null default '{}',
  runners_up text[] not null default '{}',
  champions_photo text,
  runners_up_photo text,
  final_score text,
  added_by text,
  created_at timestamptz not null default now()
);
alter table public.tournament_winners enable row level security;
-- Same access model as the other club tables (admin checks happen in the app).
create policy "anon can select tournament_winners" on public.tournament_winners for select to anon using (true);
create policy "anon can insert tournament_winners" on public.tournament_winners for insert to anon with check (true);
create policy "anon can update tournament_winners" on public.tournament_winners for update to anon using (id is not null);
create policy "anon can delete tournament_winners" on public.tournament_winners for delete to anon using (id is not null);
grant select, insert, update, delete on public.tournament_winners to anon;
