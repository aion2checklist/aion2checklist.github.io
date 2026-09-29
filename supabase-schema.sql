-- AION 2 Checklist — armazenamento privado por usuário
create table if not exists public.checklist_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.checklist_states enable row level security;

revoke all on table public.checklist_states from anon, authenticated;
grant select, insert, update, delete on table public.checklist_states to authenticated;

drop policy if exists "checklist_select_own" on public.checklist_states;
create policy "checklist_select_own"
on public.checklist_states for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "checklist_insert_own" on public.checklist_states;
create policy "checklist_insert_own"
on public.checklist_states for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "checklist_update_own" on public.checklist_states;
create policy "checklist_update_own"
on public.checklist_states for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "checklist_delete_own" on public.checklist_states;
create policy "checklist_delete_own"
on public.checklist_states for delete
to authenticated
using ((select auth.uid()) = user_id);
