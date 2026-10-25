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
  // Exercise the actual bundled renderer and PDF parser without any ERP writes.
  const smoke = `
    const fs=require('fs');const assert=require('assert/strict');
    const {PDFDocument,StandardFonts}=require('pdf-lib');const fontkit=require('@pdf-lib/fontkit');const {PNG}=require('pngjs');
    (async()=>{
      const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const page=doc.addPage([595,842]);
      const hebrew=await doc.embedFont(fs.readFileSync('public/fonts/NotoSansHebrew-Regular.ttf'),{subset:true});const latin=await doc.embedFont(StandardFonts.Helvetica);
      page.drawText('_______________',{x:313.4,y:377.7,size:7.55,font:latin});page.drawText('חתימת הלקוח',{x:385.2,y:377.7,size:7.55,font:hebrew});
      page.drawText('__________________________',{x:435.1,y:377.7,size:7.55,font:latin});page.drawText('שם הלקוח',{x:551.1,y:377.7,size:7.55,font:hebrew});
      const copy=Buffer.from(await doc.save());const png=new PNG({width:640,height:180});png.data.fill(255);
      for(let x=40;x<500;x++)for(let y=80;y<84;y++){const i=(y*640+x)*4;png.data[i]=png.data[i+1]=png.data[i+2]=20;}
      const result=await require('./digital-invoice').signedCopy(copy,PNG.sync.write(png),{ivnum:'IN123',custname:'301100',signer:'בדיקה',signedAt:'2026-10-25T10:00:00Z'});
      const signed=await PDFDocument.load(result);assert.equal(signed.getPageCount(),1);assert.equal(signed.getTitle(),'העתק חשבונית חתום IN123');
      console.log('PASS: bundled Node, PDF parser, Hebrew font and printed-field signature rendering.');
    })().catch(e=>{console.error(e.message);process.exitCode=1;});
  `;
  const smokeOutput=execFileSync(path.join(root,'runtime/node.exe'),['-e',smoke],{cwd:root,env:{...process.env,PATH:path.join(process.env.SystemRoot,'System32'),NODE_PATH:'',NODE_OPTIONS:''},windowsHide:true,timeout:30000,encoding:'utf8'});
  console.log(smokeOutput.trim());
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
