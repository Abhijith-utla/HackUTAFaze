// Global setup: start services/api and services/payments as real processes against Postgres
// (DATABASE_URL), or reuse a running stack if API_URL + PAYMENTS_URL are set.
// Payments runs with PAYMENTS_SIMULATE=1 (test-only simulated chain; see services/payments/src/solana.ts).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GlobalSetupContext } from "vitest/node";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const TREASURY = "11111111111111111111111111111112"; // any valid pubkey; simulated chain only

declare module "vitest" {
  export interface ProvidedContext {
    apiUrl: string;
    paymentsUrl: string;
    treasury: string;
    seeded: boolean;
  }
}

const procs: ChildProcess[] = [];

function run(cwd: string, script: string, env: NodeJS.ProcessEnv, name: string): ChildProcess {
  const child = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), script], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = (b: Buffer) => process.env.STACK_LOGS === "1" && process.stdout.write(`[${name}] ${b}`);
  child.stdout?.on("data", log);
  child.on("error", error => process.stderr.write(`[${name}] ${error.message}\n`));
  child.stderr?.on("data", (b: Buffer) => process.stderr.write(`[${name}] ${b}`));
  return child;
}

async function waitFor(url: string, child?: ChildProcess, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child && child.exitCode !== null) throw new Error(`${url}: process exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function runOnce(cwd: string, script: string, env: NodeJS.ProcessEnv) {
  const child = run(cwd, script, env, path.basename(script));
  const code: number = await new Promise((r) => child.on("exit", (c) => r(c ?? 1)).on("error", () => r(1)));
  if (code !== 0) throw new Error(`${script} failed with exit code ${code}`);
}

export default async function setup({ provide }: GlobalSetupContext) {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must identify an isolated test database; no application database fallback");
  const env = {
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret",
    INTERNAL_SECRET: process.env.INTERNAL_SECRET ?? "test-internal-secret",
    NODE_ENV: "test",
  };
  const apiPort = 4400;
  const payPort = 4500;
  const apiUrl = `http://localhost:${apiPort}`;
  const paymentsUrl = `http://localhost:${payPort}`;
  const apiDir = path.join(root, "services/api");

  const api = run(apiDir, "src/server.ts", { ...env, PORT: String(apiPort) }, "api");
  procs.push(api);
  await waitFor(`${apiUrl}/health`, api);

  // Agent A's demo seed (labelled demo). Optional until it lands.
  let seeded = false;
  if (existsSync(path.join(apiDir, "src/seed.ts"))) {
    await runOnce(apiDir, "src/seed.ts", env);
    seeded = true;
  }

  const pay = run(
    path.join(root, "services/payments"),
    "src/server.ts",
    {
      ...env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      PAYMENTS_PORT: String(payPort),
      API_URL: apiUrl,
      SOLANA_CLUSTER: "devnet",
      SOLANA_TREASURY_PUBKEY: TREASURY,
      PAYMENTS_SIMULATE: "1",
    },
    "payments",
  );
  procs.push(pay);
  await waitFor(`${paymentsUrl}/health`, pay);

  provide("apiUrl", apiUrl);
  provide("paymentsUrl", paymentsUrl);
  provide("treasury", TREASURY);
  provide("seeded", seeded);

  return async () => {
    for (const p of procs) p.kill("SIGTERM");
  };
}
