import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { busyPorts, busyPortsMessage, runAll } from './dev-runner.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(join(root, '.env'))) throw new Error('Create .env from .env.example and configure private database/secrets before starting.');
const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
// The services read PORT / PAYMENTS_PORT from .env, which this launcher doesn't load, so read them here for the port check.
const dotenv = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).map(l => l.match(/^\s*([A-Z_]+)\s*=\s*["']?([^"'#\s]*)/)).filter(Boolean).map(m => [m[1], m[2]]));
const portOf = (key, fallback) => Number(process.env[key] || dotenv[key]) || fallback;
const ports = { client: 3000, api: portOf('PORT', 4000), payments: portOf('PAYMENTS_PORT', 4100) };
const services = [
  ['api', '@faze/api'], ['payments', '@faze/payments'], ['worker', '@faze/worker'], ['client', '@faze/client'],
].map(([name, workspace]) => ({ name, port: ports[name], cmd: process.execPath, args: [npm, 'run', 'dev', '--workspace', workspace], cwd: root }));

const busy = await busyPorts(services);
if (busy.length) {
  console.error(busyPortsMessage(busy));
  process.exit(1);
}
process.exitCode = await runAll(services);
