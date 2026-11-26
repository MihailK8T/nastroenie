-- Пересоздаёт функцию входа и обновляет кеш PostgREST.
-- Выполнить в SQL Editor, если mc_verify отвечает 404.

drop function if exists public.mc_verify(text, text);

create or replace function public.mc_verify(p_name text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
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

revoke all on function public.mc_verify(text, text) from public;
grant execute on function public.mc_verify(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
