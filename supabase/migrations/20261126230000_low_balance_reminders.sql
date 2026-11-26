-- Low-balance reminders: tracking table + daily schedule.
-- Reminders stay OFF until an admin sets settings.low_balance_reminders = 'on'.

create table if not exists public.low_balance_reminders (
  player_id uuid primary key references public.players(id) on delete cascade,
  last_sent_at timestamptz not null default now(),
  balance_at_send numeric
);
comment on table public.low_balance_reminders is
  'Last low-balance reminder per player; cleared when the balance goes back above the threshold. Server-only.';

-- Server-only: RLS on with no policies (the edge function uses the service role).
alter table public.low_balance_reminders enable row level security;

-- Daily at 18:00 UTC (10:00 PST / 11:00 PDT). Reuses the Authorization header
-- of the existing session-reminders job so no key is written here.
do $$
declare
  auth_header text;
begin
  select substring(command from 'Bearer [A-Za-z0-9_\-\.]+') into auth_header
  from cron.job where jobname = 'session-reminders';
  if auth_header is null then
    raise exception 'session-reminders cron job not found; cannot copy its Authorization header';
  end if;

  if exists (select 1 from cron.job where jobname = 'low-balance-reminders') then
    perform cron.unschedule('low-balance-reminders');
  end if;

  perform cron.schedule(
    'low-balance-reminders',
    '0 18 * * *',
    format($cmd$
  select net.http_post(
    url := 'https://xiewyjefyuwumnznbftr.supabase.co/functions/v1/low-balance-reminders',
    headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$cmd$, auth_header)
  );
end $$;
