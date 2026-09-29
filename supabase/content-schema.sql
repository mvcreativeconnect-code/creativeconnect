-- CreativeConnect — editable site content for the self-service admin.
-- Run this ONCE in the Supabase SQL editor (after schema.sql).
-- One JSON row holds all editable content: business info, hero text, trust
-- items, packages and portfolio. Public can READ it (the site renders from it);
-- only a signed-in admin can WRITE it.

create table if not exists public.site_config (
  id         int primary key default 1,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  constraint site_config_singleton check (id = 1)
);

alter table public.site_config enable row level security;

drop policy if exists site_config_public_read on public.site_config;
create policy site_config_public_read on public.site_config
  for select to anon using (true);

drop policy if exists site_config_admin_all on public.site_config;
create policy site_config_admin_all on public.site_config
  for all to authenticated using (true) with check (true);

create or replace function public.site_config_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists site_config_touch_trg on public.site_config;
create trigger site_config_touch_trg before update on public.site_config
  for each row execute function public.site_config_touch();

-- Seed with your current site content (only inserts if the row doesn't exist).
insert into public.site_config (id, data) values (1, '{"businessName":"CreativeConnect","hero":{"eyebrow":"Photo & video studio · Maldives","title":"Your story, shot like art.","subtitle":"Weddings, events and brand films across the islands — captured with an artist’s eye and delivered in days."},"trust":["Reply within 24 hours","Photo + video in one team","Island-wide travel"],"footerAbout":"Photo and video production across the Maldives. We help couples and brands turn moments into work they''re proud to share.","instagramHandle":"mvcreativeconnect","whatsapp":"9607428224","email":"mvcreativeconnect@gmail.com","ga4MeasurementId":"G-5SC0HPEY5J","packages":[{"id":"essentials","name":"Essentials","price":"MVR 2,500","popular":false,"image":"package-essentials","includes":["2 hours of photography","30 edited photos","Online gallery","Delivery in 5 days"]},{"id":"story","name":"Story","price":"MVR 5,500","popular":true,"image":"package-story","includes":["Half-day photography","60-second highlight reel","80 edited photos","Online gallery","Delivery in 7 days"]},{"id":"brand","name":"Brand","price":"MVR 9,500","popular":false,"image":"package-brand","includes":["Full-day photo + video","3 social cut-downs (reels)","120 edited photos","Usage rights for marketing","Delivery in 10 days"]},{"id":"going-big","name":"Going Big","price":"Custom price","popular":false,"image":"package-goingbig","includes":["Full weddings, resort campaigns and multi-location events","Crew, schedule and deliverables planned around your brief","Drone, talent and styling quoted as needed","No fixed hours or deliverable counts","Timeline agreed in the quote"]}],"portfolio":[{"title":"Beach wedding ceremony","category":"Weddings & Events","image_url":"https://picsum.photos/seed/wedding-1/600/600","full_url":"https://picsum.photos/seed/wedding-1/1200/1200","alt":"Beach wedding ceremony at sunset"},{"title":"Couple portrait by the water","category":"Weddings & Events","image_url":"https://picsum.photos/seed/wedding-2/600/600","full_url":"https://picsum.photos/seed/wedding-2/1200/1200","alt":"Couple portrait by the water"},{"title":"Event celebration with guests","category":"Weddings & Events","image_url":"https://picsum.photos/seed/wedding-3/600/600","full_url":"https://picsum.photos/seed/wedding-3/1200/1200","alt":"Event celebration with guests"},{"title":"Resort brand lifestyle shot","category":"Brand & Product","image_url":"https://picsum.photos/seed/brand-1/600/600","full_url":"https://picsum.photos/seed/brand-1/1200/1200","alt":"Resort brand lifestyle shot"},{"title":"Product flat-lay for social","category":"Brand & Product","image_url":"https://picsum.photos/seed/brand-2/600/600","full_url":"https://picsum.photos/seed/brand-2/1200/1200","alt":"Product flat-lay for social media"},{"title":"Café interior brand photo","category":"Brand & Product","image_url":"https://picsum.photos/seed/brand-3/600/600","full_url":"https://picsum.photos/seed/brand-3/1200/1200","alt":"Café interior brand photography"},{"title":"Sunset portrait session","category":"Portraits","image_url":"https://picsum.photos/seed/portrait-4/600/600","full_url":"https://picsum.photos/seed/portrait-4/1200/1200","alt":"Sunset portrait session on the beach"},{"title":"Studio headshot","category":"Portraits","image_url":"https://picsum.photos/seed/portrait-2/600/600","full_url":"https://picsum.photos/seed/portrait-2/1200/1200","alt":"Studio headshot on dark background"},{"title":"Family portrait on the beach","category":"Portraits","image_url":"https://picsum.photos/seed/portrait-3/600/600","full_url":"https://picsum.photos/seed/portrait-3/1200/1200","alt":"Family portrait on the beach"}]}'::jsonb)
  on conflict (id) do nothing;
