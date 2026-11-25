-- Run once in the Supabase SQL editor as project administrator.
-- No DROP, TRUNCATE or data deletion. Keep the service role secret server-side.
begin;
create table if not exists public.timmy_state (
    storage_id text primary key,
    revision integer not null check (revision > 0),
    payload jsonb not null,
    updated_at timestamptz not null default now()
);
create table if not exists public.timmy_state_history (
    storage_id text not null,
    revision integer not null,
    payload jsonb not null,
    created_at timestamptz not null default now(),
    primary key (storage_id, revision)
);
alter table public.timmy_state enable row level security;
alter table public.timmy_state_history enable row level security;
revoke all on public.timmy_state, public.timmy_state_history from public, anon, authenticated, service_role;
grant select on public.timmy_state, public.timmy_state_history to service_role;

create or replace function public.timmy_commit_state(p_id text, p_expected integer, p_payload jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
    v_revision integer;
    v_previous jsonb;
begin
    if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,80}$' or p_expected is null or p_expected < 0
       or jsonb_typeof(p_payload) is distinct from 'object'
       or p_payload->'version' is distinct from '3'::jsonb
       or jsonb_typeof(p_payload->'guilds') is distinct from 'object'
       or jsonb_typeof(p_payload->'tickets') is distinct from 'object' then
        raise exception 'invalid Timmy state';
    end if;
    if exists (select 1 from jsonb_each(p_payload->'guilds') e where jsonb_typeof(e.value) <> 'object')
       or exists (select 1 from jsonb_each(p_payload->'tickets') e where jsonb_typeof(e.value) <> 'object') then
        raise exception 'invalid Timmy guild or ticket';
    end if;
    if p_expected = 0 then
        insert into public.timmy_state(storage_id, revision, payload)
        values (p_id, 1, p_payload) on conflict (storage_id) do nothing
        returning revision into v_revision;
    else
        select payload into v_previous from public.timmy_state
        where storage_id = p_id and revision = p_expected for update;
        if not found then raise exception 'Timmy revision conflict'; end if;
        -- Guild departure is not permission to erase stored configuration.
        if not ((p_payload->'guilds') ?& array(select jsonb_object_keys(v_previous->'guilds'))) then
            raise exception 'Timmy guild deletion refused';
        end if;
        update public.timmy_state set revision = revision + 1, payload = p_payload, updated_at = now()
        where storage_id = p_id and revision = p_expected returning revision into v_revision;
    end if;
    if v_revision is null then raise exception 'Timmy revision conflict'; end if;
    insert into public.timmy_state_history(storage_id, revision, payload)
    values (p_id, v_revision, p_payload);
    return v_revision;
end;
$$;
revoke all on function public.timmy_commit_state(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.timmy_commit_state(text, integer, jsonb) to service_role;
commit;
