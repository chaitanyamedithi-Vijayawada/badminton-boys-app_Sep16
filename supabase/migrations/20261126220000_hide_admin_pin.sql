-- Hide the admin PIN from the browser. NOT YET APPLIED.
-- Apply only AFTER the pin-auth "verify-admin" action is deployed AND the app
-- version that uses it is live on badmintonboys.net; older app versions
-- compare settings.admin_pin in the browser and would stop unlocking admin mode.

-- 1. Store the current PIN as a SHA-256 hash (the format pin-auth checks first).
insert into public.settings (key, value)
select 'admin_pin_hash', encode(extensions.digest(value, 'sha256'), 'hex')
from public.settings
where key = 'admin_pin' and value is not null and value <> ''
on conflict (key) do update set value = excluded.value;

-- 2. Remove the plain-text copy.
delete from public.settings where key = 'admin_pin';

-- 3. The browser (anon/authenticated) may read every setting except the hash.
--    The pin-auth function uses the service role, which bypasses RLS.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'settings' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.settings', p.policyname);
  end loop;
end $$;

create policy "settings readable except admin secrets"
  on public.settings for select
  to anon, authenticated
  using (key not in ('admin_pin', 'admin_pin_hash'));

-- 4. Stop the browser writing those keys too.
do $$
declare p record;
begin
  for p in
    select policyname, cmd from pg_policies
    where schemaname = 'public' and tablename = 'settings' and cmd in ('INSERT', 'UPDATE')
  loop
    execute format('drop policy %I on public.settings', p.policyname);
  end loop;
end $$;

create policy "settings insert except admin secrets"
  on public.settings for insert
  to anon, authenticated
  with check (key not in ('admin_pin', 'admin_pin_hash'));

create policy "settings update except admin secrets"
  on public.settings for update
  to anon, authenticated
  using (key not in ('admin_pin', 'admin_pin_hash'))
  with check (key not in ('admin_pin', 'admin_pin_hash'));
