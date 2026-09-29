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
