-- AION 2 Checklist — armazenamento privado por usuário + allowlist
-- Execute este arquivo inteiro no SQL Editor do Supabase.
-- Usuários Discord que já existiam antes da migração são autorizados automaticamente.

create table if not exists public.authorized_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.authorized_users enable row level security;

revoke all on table public.authorized_users from anon, authenticated;
grant select on table public.authorized_users to authenticated;

drop policy if exists "authorized_users_select_self" on public.authorized_users;
create policy "authorized_users_select_self"
on public.authorized_users for select
to authenticated
using ((select auth.uid()) = user_id);

-- Preserva acesso de quem já tinha autenticado antes da allowlist existir.
insert into public.authorized_users (user_id, note)
select id, 'Usuário existente antes da allowlist'
from auth.users
on conflict (user_id) do nothing;


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
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.authorized_users au
    where au.user_id = (select auth.uid())
  )
);

drop policy if exists "checklist_insert_own" on public.checklist_states;
create policy "checklist_insert_own"
on public.checklist_states for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.authorized_users au
    where au.user_id = (select auth.uid())
  )
);

drop policy if exists "checklist_update_own" on public.checklist_states;
create policy "checklist_update_own"
on public.checklist_states for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.authorized_users au
    where au.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.authorized_users au
    where au.user_id = (select auth.uid())
  )
);

drop policy if exists "checklist_delete_own" on public.checklist_states;
create policy "checklist_delete_own"
on public.checklist_states for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.authorized_users au
    where au.user_id = (select auth.uid())
  )
);

-- Para liberar um amigo depois que ele tentar entrar uma vez:
-- 1) Copie o UUID mostrado no site ou em Authentication > Users.
-- 2) Rode, trocando os valores:
-- insert into public.authorized_users (user_id, note)
-- values ('UUID-DO-AMIGO', 'Nome do amigo')
-- on conflict (user_id) do update set note = excluded.note;
