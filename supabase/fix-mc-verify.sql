-- Исправляет вход: pgcrypto установлен в схеме extensions,
-- поэтому функции должны искать crypt/gen_salt и там.
-- Выполнить целиком в SQL Editor.

create or replace function public.mc_register(p_name text, p_password text, p_email text default '')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nick text := btrim(coalesce(p_name, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  if v_nick !~ '^[A-Za-z0-9_]{3,16}$' then
    return 'bad';
  end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 128 then
    return 'bad';
  end if;
  if exists (select 1 from public.mc_accounts where nick_lower = lower(v_nick)) then
    return 'exists';
  end if;

  insert into public.mc_accounts (nick, nick_lower, email, password_hash)
  values (v_nick, lower(v_nick), v_email, crypt(p_password, gen_salt('bf', 12)));

  return 'ok';
exception
  when unique_violation then
    return 'exists';
end;
$$;

create or replace function public.mc_verify(p_name text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash
    from public.mc_accounts
   where nick_lower = lower(btrim(coalesce(p_name, '')));

  if v_hash is null then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 12));
    return false;
  end if;

  return crypt(coalesce(p_password, ''), v_hash) = v_hash;
end;
$$;

revoke all on function public.mc_register(text, text, text) from public;
grant execute on function public.mc_register(text, text, text) to anon, authenticated;
revoke all on function public.mc_verify(text, text) from public;
grant execute on function public.mc_verify(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
