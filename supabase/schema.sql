-- Mock Exam Center: run this once in Supabase → SQL Editor → New query.
-- Every row belongs to one user. Row-level security makes sure people only ever see and change their own rows.

create table if not exists public.attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank_id     text not null,                 -- the exam, derived from the "Exam:" title in the dump
  set_key     text not null,                 -- exam-1, sec:<name>, topic:<section>/<topic>, all
  label       text not null,
  mode        text not null check (mode in ('exam', 'practice')),
  score       int  not null check (score between 0 and 1000),
  pass        boolean not null,
  correct     int  not null,
  total       int  not null,
  created_at  timestamptz not null default now()
);
create index if not exists attempts_user_bank_idx on public.attempts (user_id, bank_id, created_at desc);

create table if not exists public.progress (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank_id     text not null,
  qnum        int  not null,                 -- question position in the dump
  score       real not null check (score between 0 and 1),   -- latest result: 1 correct, 0 wrong, fractions for partial credit
  updated_at  timestamptz not null default now(),
  primary key (user_id, bank_id, qnum)
);

alter table public.attempts enable row level security;
alter table public.progress enable row level security;

drop policy if exists "own attempts" on public.attempts;
create policy "own attempts" on public.attempts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
