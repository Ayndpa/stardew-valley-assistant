-- 账户系统数据库迁移（Go 后端直接连接现有 Supabase PostgreSQL 数据库时执行）
-- 复用现有数据库，新建账户相关的表；由 Go 后端自管（bcrypt + JWT），不依赖 Supabase Auth。

-- 账户表
create table if not exists public.accounts (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    password_hash text not null,
    username text,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.accounts is '账户系统：邮箱 + bcrypt 密码，Go 后端管理';

-- 用户设置表：后续「手机电脑互通」云同步的配置/数据挂在这里。
create table if not exists public.user_settings (
    account_id uuid primary key references public.accounts (id) on delete cascade,
    settings jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

comment on table public.user_settings is '账户设置（jsonb 载体），按账户云同步';

-- updated_at 自动维护
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
    before update on public.accounts
    for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
    before update on public.user_settings
    for each row execute function public.set_updated_at();

-- 最佳实践：即使 PostgREST 未暴露这些表，也开启 RLS 兜底。
-- Go 后端以数据库 owner 直连会绕过 RLS，不受影响。
alter table public.accounts enable row level security;
alter table public.user_settings enable row level security;