export interface GlobalOptions {
  json: boolean;
  baseURL: string;
  adminKey: string;
}

export interface CLIConfig {
  base_url?: string;
  admin_key?: string;
}

export const configFilePath = "admin.json";

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";

/** 配置优先级: 命令行选项 > 环境变量 ADMIN_BASE_URL/ADMIN_KEY > admin.json > 默认值 */
export async function loadCLIConfig(opts: GlobalOptions): Promise<CLIConfig> {
  const cfg = await readConfigFile();
  const envBaseURL = process.env.ADMIN_BASE_URL;
  if (envBaseURL) cfg.base_url = envBaseURL;
  const envAdminKey = process.env.ADMIN_KEY;
  if (envAdminKey) cfg.admin_key = envAdminKey;
  if (opts.baseURL) cfg.base_url = opts.baseURL;
  if (opts.adminKey) cfg.admin_key = opts.adminKey;
  if (!cfg.base_url) cfg.base_url = DEFAULT_BASE_URL;
  return cfg;
}

export async function readConfigFile(): Promise<CLIConfig> {
  try {
    return (await Bun.file(configFilePath).json()) as CLIConfig;
  } catch {
    return {};
  }
}

export async function saveCLIConfig(cfg: CLIConfig): Promise<void> {
  await Bun.write(configFilePath, `${JSON.stringify(cfg, null, 2)}\n`);
}
