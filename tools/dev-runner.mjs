// Process supervision for `npm run dev` (tools/dev.mjs). Two problems this fixes:
//  1. On Linux/macOS, Ctrl+C killed only the direct `npm` wrapper, so `next-server` / `tsx watch` underneath survived as orphans
//     and held ports 3000/4000/4100. Every later `npm run dev` then died with EADDRINUSE. Each service now runs in its own
//     process group and the whole group is stopped (SIGTERM, then SIGKILL after a grace period). Windows keeps taskkill /T /F.
//  2. A busy port produced a cascade of npm errors. We now check the ports first and say what to do.
import { spawn } from 'node:child_process';
import net from 'node:net';

/** True if we can bind the port the way Next/Fastify do (dual-stack, no host). */
export function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => resolve(e.code !== 'EADDRINUSE'));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
}

export async function busyPorts(services) {
  const busy = [];
  for (const s of services) if (s.port && !(await portIsFree(s.port))) busy.push(s);
  return busy;
}

export function busyPortsMessage(busy, win = process.platform === 'win32') {
  const lines = busy.map((s) => `  - port ${s.port} (${s.name})`);
  const find = (p) => (win ? `netstat -ano | findstr :${p}` : `lsof -i :${p}   (or: ss -ltnp | grep :${p})`);
  const stop = win ? 'taskkill /PID <pid> /T /F' : 'kill <pid>';
  return [
    'Cannot start: these ports are already in use:',
    ...lines,
    '',
    'This is usually an earlier `npm run dev` that is still running (open the site as it is), or leftovers from one that was stopped.',
    `Find the owner:  ${find(busy[0].port)}`,
    `Stop it:         ${stop}`,
    'Then run `npm run dev` again. Nothing was started.',
  ].join('\n');
}

/** SIGTERM a whole POSIX process group, then SIGKILL it after the grace period. Harmless if the group is already empty. */
function killGroup(pid, graceMs) {
  const signal = (sig) => { try { process.kill(-pid, sig); } catch { /* group already gone */ } };
  signal('SIGTERM');
  setTimeout(() => signal('SIGKILL'), graceMs).unref();
}

/** Stops a service and everything it spawned. */
export function stopTree(child, { win = process.platform === 'win32', graceMs = 4000 } = {}) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else killGroup(child.pid, graceMs);
}

/**
 * Starts every service (each in its own process group on POSIX), forwards stdio, and stops them all on SIGINT/SIGTERM/SIGHUP
 * or when any of them exits non-zero. Resolves with the exit code once everything has stopped.
 */
export function runAll(services, { graceMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const children = services.map((s) => spawn(s.cmd, s.args, { cwd: s.cwd, stdio: 'inherit', env: process.env, detached: !win }));
    let stopping = false;
    let code = 0;
    let alive = children.length;
    const stop = (c = 0) => {
      if (stopping) return;
      stopping = true;
      code = c;
      for (const child of children) stopTree(child, { win, graceMs });
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(0));
    for (const child of children) {
      child.on('error', () => stop(1));
      child.on('exit', (c) => {
        // The wrapper (npm) may exit while the server underneath it lives on: sweep its whole process group either way.
        if (!win && child.pid) killGroup(child.pid, graceMs);
        if (!stopping && c) stop(c);
        if (--alive === 0) resolve(code);
      });
    }
  });
}
