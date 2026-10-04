-- Anamnesia — configuração do Supabase
-- Rodar uma vez no SQL Editor do projeto (Supabase → SQL Editor → New query → Run).
-- Pode ser rodado de novo sem perder dados.
--
-- O servidor só guarda dados cifrados (AES-GCM no aparelho); iv/data/salt/check_* são base64.

-- ---------- registros (um por paciente) ----------
create table if not exists public.records (
  user_id    uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  id         text   not null,
  iv         text,                         -- nulo quando deleted = true (tombstone)
  data       text,
  deleted    boolean not null default false,
  updated_at bigint not null,              -- carimbo do aparelho (ms desde 1970)
  server_ts  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists records_user_server_ts on public.records (user_id, server_ts);

-- ---------- chave do usuário (sal + verificador; não são segredos) ----------
create table if not exists public.user_keys (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  salt       text    not null,
  iterations integer not null,
  check_iv   text    not null,
  check_data text    not null,
  created_at timestamptz not null default now()
);

-- ---------- Row Level Security: cada usuário só enxerga as próprias linhas ----------
alter table public.records   enable row level security;
alter table public.user_keys enable row level security;

drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;
create policy records_select on public.records for select to authenticated
  using (user_id = (select auth.uid()));
create policy records_insert on public.records for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy records_update on public.records for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- user_keys: só leitura e criação; não há update/delete, para a chave não ser trocada por engano
drop policy if exists user_keys_select on public.user_keys;
drop policy if exists user_keys_insert on public.user_keys;
create policy user_keys_select on public.user_keys for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_keys_insert on public.user_keys for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.records, public.user_keys from anon;
grant select, insert, update on public.records   to authenticated;
grant select, insert         on public.user_keys to authenticated;

-- ---------- gatilho: recusa gravação mais antiga e carimba server_ts ----------
-- Numa atualização com updated_at menor que o já salvo, a linha fica como está
-- (retornar null ignora a alteração sem gerar erro, para não derrubar o lote do upsert).
create or replace function public.records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null;
    end if;
    new.user_id := old.user_id;
    new.id      := old.id;
  end if;
  new.server_ts := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_guard on public.records;
create trigger records_guard
  before insert or update on public.records
  for each row execute function public.records_guard();
