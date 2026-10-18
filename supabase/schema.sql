-- 牙醫診所管理系統：Supabase 資料表與安全規則（與目前專案設定一致）
-- 病患資料只有「已核准的成員」可以讀寫；第一位註冊的帳號自動成為管理員並核准。

create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.docs (
  col text not null check (col in ('clients', 'appointments', 'orders', 'products', 'services', 'staff', 'settings')),
  id text not null check (char_length(id) between 1 and 100),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (col, id)
);

-- 權限判斷函式放在不對外公開的 private schema
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.user_id = (select auth.uid()) and m.approved);
$$;
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.user_id = (select auth.uid()) and m.approved and m.role = 'admin');
$$;
revoke all on function private.is_member() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_member() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- 新帳號註冊時自動建立成員資料；還沒有管理員時，這位就是管理員
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare first_one boolean;
begin
  select not exists (select 1 from public.members where approved and role = 'admin') into first_one;
  insert into public.members (user_id, email, role, approved)
  values (new.id, new.email, case when first_one then 'admin' else 'staff' end, first_one)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.touch_docs() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := (select auth.uid()); return new; end;
$$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function private.touch_docs();

-- 列層級安全
alter table public.members enable row level security;
alter table public.docs enable row level security;

drop policy if exists "members read self or admin" on public.members;
create policy "members read self or admin" on public.members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
drop policy if exists "admin manages members" on public.members;
create policy "admin manages members" on public.members for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "admin removes members" on public.members;
create policy "admin removes members" on public.members for delete to authenticated
  using ((select private.is_admin()) and user_id <> (select auth.uid()));

drop policy if exists "members read docs" on public.docs;
create policy "members read docs" on public.docs for select to authenticated using ((select private.is_member()));
drop policy if exists "members insert docs" on public.docs;
create policy "members insert docs" on public.docs for insert to authenticated with check ((select private.is_member()));
drop policy if exists "members update docs" on public.docs;
create policy "members update docs" on public.docs for update to authenticated using ((select private.is_member())) with check ((select private.is_member()));
drop policy if exists "members delete docs" on public.docs;
create policy "members delete docs" on public.docs for delete to authenticated using ((select private.is_member()));

-- 即時同步
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
