import { Client } from "./client";
import { loadCLIConfig, type GlobalOptions } from "./config";
import { dispatch, printUsage, setJSONOutput } from "./ops";

interface ParsedFlags {
  json: boolean;
  baseURL: string;
  adminKey: string;
  rest: string[];
}

/** 解析全局选项 -j/--json、-b/--base-url、-k/--key，直到第一个非选项参数。 */
function parseGlobalFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = { json: false, baseURL: "", adminKey: "", rest: [] };
  while (args.length > 0) {
    const arg = args[0]!;
    if (arg === "-j" || arg === "--json") {
      flags.json = true;
      args = args.slice(1);
    } else if (arg === "-b" || arg === "--base-url") {
      const value = args[1];
      if (value === undefined) throw new Error("--base-url 需要参数");
      flags.baseURL = value.replace(/\/+$/, "");
      args = args.slice(2);
    } else if (arg === "-k" || arg === "--key") {
      const value = args[1];
      if (value === undefined) throw new Error("--key 需要参数");
      flags.adminKey = value;
      args = args.slice(2);
    } else {
      break;
    }
  }
  flags.rest = args;
  return flags;
}

async function main(): Promise<void> {
  let args = process.argv.slice(2);
  let flags: ParsedFlags;
  try {
    flags = parseGlobalFlags(args);
  } catch (err) {
    console.error("错误:", err instanceof Error ? err.message : err);
    process.exit(2);
  }
  args = flags.rest;
  setJSONOutput(flags.json);

  const opts: GlobalOptions = { json: flags.json, baseURL: flags.baseURL, adminKey: flags.adminKey };
  const cfg = await loadCLIConfig(opts);
  const c = new Client(cfg);

  if (args.length === 0) {
    printUsage();
    process.exit(2);
  }

  try {
    await dispatch(c, args);
  } catch (err) {
    console.error("错误:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

await main();
