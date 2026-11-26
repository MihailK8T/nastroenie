-- Вход через VK ID: привязка внешнего аккаунта к игровому нику.
-- Supabase → SQL Editor → Run. Повторный запуск безопасен.
-- Идея: anon-ключ публичный, поэтому прямой доступ к таблице закрыт,
-- а привязка возможна только после подтверждения игрового пароля.

create table if not exists public.mc_oauth (
    provider   text not null,              -- 'vk'
    sub        text not null,              -- user_id из VK ID
    nick       text not null,              -- ник в нижнем регистре
    email      text not null default '',
    created    timestamptz not null default now(),
    last_use   timestamptz,
    primary key (provider, sub)
);

create index if not exists mc_oauth_nick_idx on public.mc_oauth (provider, nick);

alter table public.mc_oauth enable row level security;
revoke all on public.mc_oauth from anon, authenticated;

-- Возвращает ник, привязанный к внешнему аккаунту, или null.
create or replace function public.mc_oauth_nick(p_provider text, p_sub text)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
    select nick
    from mc_oauth
    where provider = lower(btrim(coalesce(p_provider, '')))
      and sub = btrim(coalesce(p_sub, ''))
    limit 1;
$$;

-- Привязка: 'ok' | 'bad' | 'noaccount' | 'linked_other'
create or replace function public.mc_oauth_link(
    p_provider text,
    p_sub      text,
    p_name     text,
    p_password text,
    p_email    text default ''
) returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_provider text := lower(btrim(coalesce(p_provider, '')));
    v_sub      text := btrim(coalesce(p_sub, ''));
    v_nick     text := lower(btrim(coalesce(p_name, '')));
    v_hash     text;
begin
    if v_provider = '' or v_sub = '' or v_nick = '' or length(v_sub) > 64 then
        return 'bad';
    end if;

    select password_hash into v_hash
      from mc_accounts
     where nick_lower = v_nick
     limit 1;

    if v_hash is null then
        return 'noaccount';
    end if;

    if crypt(coalesce(p_password, ''), v_hash) <> v_hash then
        perform crypt(coalesce(p_password, ''), gen_salt('bf', 12));
        return 'bad';
    end if;

    if exists (
        select 1 from mc_oauth
        where provider = v_provider and nick = v_nick and sub <> v_sub
    ) then
        return 'linked_other';
    end if;

    insert into mc_oauth (provider, sub, nick, email)
    values (v_provider, v_sub, v_nick, left(coalesce(p_email, ''), 120))
    on conflict (provider, sub) do update
        set nick = excluded.nick,
            email = excluded.email;

    return 'ok';
end;
$$;

-- Отметка последнего входа через внешний аккаунт.
create or replace function public.mc_oauth_touch(p_provider text, p_sub text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update mc_oauth
       set last_use = now()
     where provider = lower(btrim(coalesce(p_provider, '')))
       and sub = btrim(coalesce(p_sub, ''));
$$;

-- Отвязка без пароля невозможна: только по паре провайдер+sub из доверенного запроса.
create or replace function public.mc_oauth_unlink(p_provider text, p_sub text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    delete from mc_oauth
     where provider = lower(btrim(coalesce(p_provider, '')))
       and sub = btrim(coalesce(p_sub, ''));
    return found;
end;
$$;

revoke all on function public.mc_oauth_nick(text, text) from public;
revoke all on function public.mc_oauth_link(text, text, text, text, text) from public;
revoke all on function public.mc_oauth_touch(text, text) from public;
revoke all on function public.mc_oauth_unlink(text, text) from public;

grant execute on function public.mc_oauth_nick(text, text) to anon, authenticated;
grant execute on function public.mc_oauth_link(text, text, text, text, text) to anon, authenticated;
grant execute on function public.mc_oauth_touch(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
