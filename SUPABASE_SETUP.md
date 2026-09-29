# Discord login + Supabase

## 1. Supabase
Crie um projeto e execute `supabase-schema.sql` no SQL Editor.

Em **Authentication → URL Configuration**:
- Site URL: `https://aion2checklist.github.io/`
- Redirect URLs: adicione `https://aion2checklist.github.io/`

Em **Authentication → Sign In / Providers → Discord**, copie o Callback URL do Supabase.

## 2. Discord Developer Portal
Crie uma Application.
Em **OAuth2 → Redirects**, adicione exatamente o Callback URL fornecido pelo Supabase:
`https://<project-ref>.supabase.co/auth/v1/callback`

Copie o Client ID e o Client Secret para o provider Discord dentro do Supabase.

## 3. Frontend
No Supabase, copie:
- Project URL
- Publishable key (ou anon key)

Preencha esses dois valores em `config.js`.

Nunca coloque a service_role key no GitHub ou no navegador.


## 4. Restringir o site aos amigos

Execute novamente o arquivo `supabase-schema.sql` inteiro no SQL Editor.

Ele cria a tabela `authorized_users` e troca as políticas do checklist para aceitar somente usuários presentes nela.

- Quem já tinha uma conta no Supabase antes dessa migração é autorizado automaticamente.
- Um amigo novo deve tentar entrar com Discord uma vez.
- Se não estiver autorizado, o site mostra o UUID da conta.
- No SQL Editor, libere o amigo com:

```sql
insert into public.authorized_users (user_id, note)
values ('UUID-DO-AMIGO', 'Nome do amigo')
on conflict (user_id) do update set note = excluded.note;
```

Para remover o acesso:

```sql
delete from public.authorized_users
where user_id = 'UUID-DO-AMIGO';
```

A tabela não permite que usuários comuns se adicionem sozinhos. A lista é administrada pelo painel/SQL do Supabase.
