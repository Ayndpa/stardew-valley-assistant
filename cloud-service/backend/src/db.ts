import postgres from "postgres";

// 建表 SQL（与 schema.sql 保持一致），按语句逐条执行。
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    username text,
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS public.user_settings (
    account_id uuid PRIMARY KEY REFERENCES public.accounts (id) ON DELETE CASCADE,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$`,
  `DROP TRIGGER IF EXISTS accounts_set_updated_at ON public.accounts`,
  `CREATE TRIGGER accounts_set_updated_at
    BEFORE UPDATE ON public.accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()`,
  `DROP TRIGGER IF EXISTS user_settings_set_updated_at ON public.user_settings`,
  `CREATE TRIGGER user_settings_set_updated_at
    BEFORE UPDATE ON public.user_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()`,
  `ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY`,
];

// 建表在单个 Worker 隔离实例内只做一次。
let schemaReady: Promise<void> | null = null;

export function createDB(env: import("./types").Env): postgres.Sql {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? "";
  if (!connectionString) {
    throw new Error("未配置数据库连接（DATABASE_URL 或 HYPERDRIVE 绑定）");
  }
  return postgres(connectionString, {
    // Workers/池化连接（Supavisor、Hyperdrive、PgBouncer）需关闭预编译语句
    prepare: false,
    max: 5,
    connect_timeout: 10,
    idle_timeout: 20,
  });
}

/** 幂等建表，首次调用后按隔离实例缓存结果。 */
export async function ensureSchema(sql: postgres.Sql): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SCHEMA_STATEMENTS) {
        await sql.unsafe(stmt);
      }
      console.log("表结构已就绪");
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}
