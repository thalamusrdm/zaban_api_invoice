'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(process.argv[2]);
  assert.ok(fs.existsSync(path.join(root, 'runtime/node.exe')));
  assert.ok(fs.existsSync(path.join(root, '.env')));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const system32 = path.join(process.env.SystemRoot, 'System32');
  const child = spawn(path.join(system32, 'cmd.exe'), ['/d', '/c', 'start-server.bat'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PATH: system32, NODE_PATH: '', NODE_OPTIONS: '', PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Portable BAT startup timed out: ' + output)), 15000);
      child.on('error', err => { clearTimeout(timer); reject(err); });
      const check = data => {
        if (data.toString().includes('Invoice UI running:')) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', check);
    });
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('useBoiRates') && html.includes('goldStatus'));
    console.log('PASS: extracted BAT starts with only System32 in PATH; bundled runtime serves current invoice UI.');
  } finally {
    if (child.pid && child.exitCode === null) execFileSync(path.join(system32, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    child.stdin.destroy();
  }
  let stopped = false;
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); } catch { stopped = true; }
  assert.ok(stopped, 'Verification server was left running');
  console.log('PASS: verification process tree stopped; no background server remains.');
})().catch(err => { console.error(err.message); process.exitCode = 1; });
