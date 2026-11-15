import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(join(root, '.env'))) throw new Error('Create .env from .env.example and configure private database/secrets before starting.');
const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const children = ['@faze/api', '@faze/payments', '@faze/worker', '@faze/client'].map(workspace => spawn(process.execPath, [npm, 'run', 'dev', '--workspace', workspace], { cwd: root, stdio: 'inherit', env: process.env }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) child.on('exit', code => { if (!stopping && code) stop(code); });
