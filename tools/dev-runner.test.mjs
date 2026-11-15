// Run with: node --test tools/
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { busyPorts, busyPortsMessage, portIsFree } from './dev-runner.mjs';

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const listening = (port) => new Promise((res) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

// A fake service = a wrapper process that spawns the real server underneath (like npm -> next dev).
function fixture(dir, port, { exitAfterMs } = {}) {
  writeFileSync(join(dir, `grand-${port}.mjs`), `import net from 'node:net'; net.createServer().listen(${port}); setInterval(() => {}, 1e6);`);
  writeFileSync(join(dir, `wrap-${port}.mjs`), `import { spawn } from 'node:child_process'; spawn(process.execPath, [${JSON.stringify(join(dir, `grand-${port}.mjs`))}], { stdio: 'inherit' });
    ${exitAfterMs ? `setTimeout(() => process.exit(3), ${exitAfterMs});` : 'setInterval(() => {}, 1e6);'}`);
  return { name: `svc${port}`, port, cmd: process.execPath, args: [join(dir, `wrap-${port}.mjs`)], cwd: dir };
}
function driver(dir, services) {
  const file = join(dir, 'driver.mjs');
  writeFileSync(file, `import { runAll } from ${JSON.stringify(new URL('./dev-runner.mjs', import.meta.url).href)};
    process.exitCode = await runAll(${JSON.stringify(services)}, { graceMs: 1500 });`);
  return spawn(process.execPath, [file], { stdio: 'ignore' });
}
const exited = (p) => new Promise((res) => p.once('exit', (code, sig) => res({ code, sig })));

test('portIsFree / busyPorts detect a listener', async () => {
  const port = await freePort();
  assert.equal(await portIsFree(port), true);
  const srv = net.createServer().listen(port);
  await new Promise((r) => srv.once('listening', r));
  assert.equal(await portIsFree(port), false);
  assert.deepEqual((await busyPorts([{ name: 'x', port }, { name: 'nobody' }])).map((s) => s.name), ['x']);
  srv.close();
});

test('busyPortsMessage names each port and says nothing was started', () => {
  const m = busyPortsMessage([{ name: 'client', port: 3000 }, { name: 'api', port: 4000 }], false);
  assert.match(m, /port 3000 \(client\)/); assert.match(m, /port 4000 \(api\)/); assert.match(m, /lsof -i :3000/); assert.match(m, /Nothing was started/);
  assert.match(busyPortsMessage([{ name: 'client', port: 3000 }], true), /netstat -ano/);
});

test('Ctrl+C stops the wrapper AND the server underneath it (no orphan holds the port)', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'devrun-'));
  const [a, b] = [await freePort(), await freePort()];
  const d = driver(dir, [fixture(dir, a), fixture(dir, b)]);
  const done = exited(d);
  assert.ok(await until(async () => (await listening(a)) && (await listening(b))), 'both servers came up');
  d.kill('SIGINT');
  const r = await done;
  assert.equal(r.code, 0);
  assert.ok(await until(async () => !(await listening(a)) && !(await listening(b))), 'ports are free again after Ctrl+C');
});

test('one service exiting non-zero stops the others and their servers, and propagates the code', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'devrun-'));
  const [a, b] = [await freePort(), await freePort()];
  const d = driver(dir, [fixture(dir, a, { exitAfterMs: 700 }), fixture(dir, b)]);
  const r = await exited(d);
  assert.equal(r.code, 3);
  assert.ok(await until(async () => !(await listening(a)) && !(await listening(b))), 'ports are free after a crash');
});
