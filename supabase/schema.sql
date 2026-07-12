create extension if not exists pgcrypto;

create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  summary text default '',
  source_files jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  last_reviewed timestamptz
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text not null,
  topic text default 'General',
  status text default 'new' check (status in ('new', 'known', 'unknown')),
  favorite boolean default false,
  flagged boolean default false,
  note text default '',
  position int default 0
);

create table if not exists public.progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp int default 0,
  streak int default 0,
  best_streak int default 0,
  last_active_date date,
  activity jsonb default '{}'::jsonb
);

create index if not exists cards_deck_id_idx on public.cards(deck_id);
create index if not exists decks_user_id_idx on public.decks(user_id);

alter table public.decks enable row level security;
alter table public.cards enable row level security;
alter table public.progress enable row level security;

-- Each user can only read/write their own rows. This is what makes it safe to
-- talk to Supabase directly from the browser with the public anon key.
create policy "own decks" on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own cards" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own progress" on public.progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);