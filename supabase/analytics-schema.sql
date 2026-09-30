-- CreativeConnect — privacy-friendly visitor analytics.
-- Run this ONCE in the Supabase SQL editor (after schema.sql).
--
-- Model: the public site may INSERT a visit and nothing else. Only a signed-in
-- admin may read. No personal data is stored — just a random anonymous visitor
-- id (from a cookie), the page path, and a coarse device/browser label.

create table if not exists public.visits (
  id          bigint generated always as identity primary key,
  visitor_id  text        not null,
  is_new      boolean     not null default false,
  path        text        not null default '/',
  referrer    text,                          -- host only (e.g. "google.com" / "direct")
  device      text,                          -- Mobile / Desktop / Tablet
  browser     text,                          -- Chrome / Safari / Firefox / Edge / Other
  created_at  timestamptz not null default now(),

  constraint visits_vid_len     check (char_length(visitor_id) between 6 and 64),
  constraint visits_path_len    check (char_length(path) <= 300),
  constraint visits_ref_len     check (referrer is null or char_length(referrer) <= 200),
  constraint visits_device_len  check (device is null or char_length(device) <= 20),
  constraint visits_browser_len check (browser is null or char_length(browser) <= 30)
);

create index if not exists visits_created_idx on public.visits (created_at desc);
create index if not exists visits_visitor_idx on public.visits (visitor_id);

-- Never trust a client-supplied timestamp; stamp it on the server.
create or replace function public.visits_normalise()
returns trigger language plpgsql as $$
begin
  new.created_at := now();
  new.path       := left(coalesce(new.path, '/'), 300);
  new.referrer   := nullif(left(coalesce(new.referrer, ''), 200), '');
  return new;
end;
$$;
drop trigger if exists visits_normalise_trg on public.visits;
create trigger visits_normalise_trg
  before insert on public.visits
  for each row execute function public.visits_normalise();

alter table public.visits enable row level security;

-- Public site: insert only. It cannot read the visit log back.
drop policy if exists visits_public_insert on public.visits;
create policy visits_public_insert on public.visits
  for insert to anon with check (true);

-- Signed-in admins: read + delete (e.g. to clear test data).
drop policy if exists visits_admin_select on public.visits;
create policy visits_admin_select on public.visits
  for select to authenticated using (true);

drop policy if exists visits_admin_delete on public.visits;
create policy visits_admin_delete on public.visits
  for delete to authenticated using (true);
