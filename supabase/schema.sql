-- CreativeConnect — lead store for the static (GitHub Pages) build.
-- Run this once in the Supabase SQL editor.
--
-- Model: the public site may INSERT a lead and nothing else. Only a signed-in
-- admin may read, update or delete. Validation is enforced by the database,
-- not by the browser, so a hand-crafted request cannot bypass it.

-- ---------------------------------------------------------------- table
create table if not exists public.leads (
  id               bigint generated always as identity primary key,
  name             text        not null,
  email            text        not null,
  phone            text,
  shoot_type       text        not null,
  package_slug     text        not null,
  preferred_date   date,
  project_details  text,
  locations        text,
  budget_range     text,
  consent          boolean     not null default false,
  status           text        not null default 'new',
  source           text        not null default 'website',
  notes            text        not null default '',
  is_test          boolean     not null default false,
  created_at       timestamptz not null default now(),

  -- server-side validation (mirrors the Node API route)
  constraint leads_name_len     check (char_length(btrim(name))  between 2 and 120),
  constraint leads_email_fmt    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint leads_email_len    check (char_length(email) <= 200),
  constraint leads_phone_len    check (phone is null or char_length(phone) <= 40),
  constraint leads_shoot_type   check (shoot_type in
                                  ('Wedding','Event','Brand / Product','Portrait / Graduation','Other')),
  constraint leads_package      check (package_slug in
                                  ('essentials','story','brand','going-big')),
  constraint leads_status       check (status in
                                  ('new','contacted','quoted','booked','lost','archived')),
  constraint leads_details_len  check (project_details is null or char_length(project_details) <= 4000),
  constraint leads_locations_len check (locations is null or char_length(locations) <= 300),
  constraint leads_budget_len   check (budget_range is null or char_length(budget_range) <= 100),
  constraint leads_notes_len    check (char_length(notes) <= 8000),
  constraint leads_consent_req  check (consent = true),
  constraint leads_date_sane    check (preferred_date is null
                                  or preferred_date >= current_date - 1),
  -- "Going Big" is quote-only, so it must arrive with a brief
  constraint leads_brief_req    check (
                                  package_slug <> 'going-big'
                                  or char_length(btrim(coalesce(project_details,''))) >= 20)
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx     on public.leads (status);

-- -------------------------------------------------- normalise on the server
-- Trim whitespace and lowercase the email regardless of what the browser sent.
create or replace function public.leads_normalise()
returns trigger
language plpgsql
as $$
begin
  new.name       := btrim(new.name);
  new.email      := lower(btrim(new.email));
  new.phone      := nullif(btrim(coalesce(new.phone, '')), '');
  new.locations  := nullif(btrim(coalesce(new.locations, '')), '');
  new.created_at := now();          -- never trust a client-supplied timestamp
  return new;
end;
$$;

drop trigger if exists leads_normalise_trg on public.leads;
create trigger leads_normalise_trg
  before insert on public.leads
  for each row execute function public.leads_normalise();

-- Stop a public insert from pre-setting fields it has no business setting.
create or replace function public.leads_public_defaults()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'anon' then
    new.status := 'new';
    new.notes  := '';
    new.source := coalesce(nullif(btrim(new.source), ''), 'website');
  end if;
  return new;
end;
$$;

drop trigger if exists leads_public_defaults_trg on public.leads;
create trigger leads_public_defaults_trg
  before insert on public.leads
  for each row execute function public.leads_public_defaults();

-- ---------------------------------------------------------------- row security
alter table public.leads enable row level security;

-- The public site: insert only. It cannot read back what it wrote.
drop policy if exists leads_public_insert on public.leads;
create policy leads_public_insert
  on public.leads for insert
  to anon
  with check (true);

-- Signed-in admins: full access.
drop policy if exists leads_admin_select on public.leads;
create policy leads_admin_select
  on public.leads for select
  to authenticated
  using (true);

drop policy if exists leads_admin_update on public.leads;
create policy leads_admin_update
  on public.leads for update
  to authenticated
  using (true) with check (true);

drop policy if exists leads_admin_delete on public.leads;
create policy leads_admin_delete
  on public.leads for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------- rate limit
-- Cheap abuse guard: at most 5 inserts per hour from one email address.
-- SECURITY DEFINER so the internal COUNT runs as the function owner and can see
-- existing rows; otherwise RLS (anon has no SELECT policy) makes the count
-- always 0 and the guard never triggers. Fixed search_path per Postgres advice.
create or replace function public.leads_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  select count(*) into recent
    from public.leads
   where email = lower(btrim(new.email))
     and created_at > now() - interval '1 hour';
  if recent >= 5 then
    raise exception 'Too many requests from this address. Please try again later.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_rate_limit_trg on public.leads;
create trigger leads_rate_limit_trg
  before insert on public.leads
  for each row execute function public.leads_rate_limit();
