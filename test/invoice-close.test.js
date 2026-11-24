'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const digital = require('../digital-invoice');
const {invoiceCloser} = require('../invoice-close');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'invoice-close-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  const base = 'test', user = 'API';
  const f = {store:digital.workflowStore(dir), calls:[], closes:0, preparations:0, saved:false,
    inv:{IV:123, IVNUM:'T123', STATDES:'טיוטא', OWNERLOGIN:user, CUSTNAME:'301100', TOTPRICE:118}};
  await f.store.write(digital.keyFor(base,123), 'context', {originalDownload:true, custname:'301100'});
  f.finalize = () => {f.inv.IVNUM='IN456'; f.inv.STATDES='סופית';};
  f.build = () => invoiceCloser({base, user, store:f.store, keyFor:digital.keyFor,
    async priority(method, url) {
      assert.equal(method, 'GET'); f.calls.push(url);
      if (f.readFailure) throw Error('read timeout');
      if (url.startsWith('AINVOICES?')) return {value:f.missing?[]:[{...f.inv}]};
      if (!url.includes("IVNUM='" + f.inv.IVNUM + "'")) throw Error('404 old draft');
      return {...f.inv};
    },
    async close() {f.closes++; if(f.onClose) return f.onClose(); f.finalize();},
    async preflight() {if(f.preflightError) throw Error('preflight');},
    async prepareOriginal(number) {
      assert.equal(number,'IN456');
      // Model the persisted preparation guard: a saved original is only read.
      if (!f.saved) {f.preparations++; if(f.prepareError) throw Error('preparation interrupted'); f.saved=true;}
    },
  });
  return f;
}

test('SDK timeout after closing reconciles by IV and prepares the same final invoice', async t => {
  const f=await fixture(t); f.onClose=()=>{f.finalize(); throw Error('SDK timeout');};
  const result=await f.build().run('T123');
  assert.equal(result.ivnum,'IN456'); assert.equal(result.closed,true);
  assert.equal(f.closes,1); assert.equal(f.preparations,1);
  assert.ok(f.calls.some(url=>decodeURIComponent(url).includes('IV eq 123')));
});

test('lost response, repeated old draft and restarted server never close or prepare twice', async t => {
  const f=await fixture(t), closer=f.build();
  await closer.run('T123');
  const results=await Promise.all([closer.run('T123'),f.build().run('T123')]);
  assert.ok(results.every(x=>x.ivnum==='IN456'));
  assert.equal(f.closes,1); assert.equal(f.preparations,1);
});

test('simultaneous closing requests share one financial procedure', async t => {
  const f=await fixture(t), closer=f.build();
  let release;const gate=new Promise(resolve=>{release=resolve;});
  f.onClose=async()=>{await gate;f.finalize();};
  const one=closer.run('T123'), two=closer.run('T123');
  release(); await Promise.all([one,two]);
  assert.equal(f.closes,1); assert.equal(f.preparations,1);
});

test('late close is recovered after an uncertain result without retrying the procedure', async t => {
  const f=await fixture(t); f.onClose=()=>{throw Error('timeout');};
  await assert.rejects(f.build().run('T123'),/timeout/);
  assert.equal(f.preparations,0);
  f.finalize();
  const state=await f.build().status('T123');
  assert.equal(state.closed,true); assert.equal(f.preparations,0); // GET stays read-only
  await f.build().run('T123');
  assert.equal(f.closes,1); assert.equal(f.preparations,1);
});

test('unconfirmed draft and unreadable state never trigger another close or an original', async t => {
  const f=await fixture(t); f.onClose=()=>{throw Error('timeout');};
  await assert.rejects(f.build().run('T123'));
  await assert.rejects(f.build().run('T123'));
  assert.equal((await f.build().status('T123')).pending,true);
  f.readFailure=true;
  await assert.rejects(f.build().run('T123'),/read timeout/);
  assert.equal(f.closes,1); assert.equal(f.preparations,0);
});

test('restart after procedure started reconciles final status, even without a completed journal', async t => {
  const f=await fixture(t); await f.build().remember(f.inv);
  await f.store.write(digital.keyFor('test',123),'closing',{status:'started'});
  f.finalize(); await f.build().run('T123');
  assert.equal(f.closes,0); assert.equal(f.preparations,1);
});

test('preparation failure keeps final identity and resumes without another close', async t => {
  const f=await fixture(t); f.prepareError=true;
  await assert.rejects(f.build().run('T123'),/preparation interrupted/);
  f.prepareError=false; await f.build().run('T123');
  assert.equal(f.closes,1); assert.equal(f.inv.IVNUM,'IN456');
});

test('ownership changes, mismatched customers and missing IV stop recovery without financial writes', async t => {
  for(const mutation of [f=>{f.inv.OWNERLOGIN='OTHER';},f=>{f.inv.CUSTNAME='OTHER';},f=>{f.missing=true;}]) {
    const f=await fixture(t); await f.build().remember(f.inv); mutation(f);
    await assert.rejects(f.build().run('T123'));
    assert.equal(f.closes,0); assert.equal(f.preparations,0);
  }
});

test('preflight failure permits a corrected retry since no financial procedure started', async t => {
  const f=await fixture(t); f.preflightError=true;
  await assert.rejects(f.build().run('T123'),/preflight/);
  assert.equal(f.closes,0); f.preflightError=false;
  await f.build().run('T123'); assert.equal(f.closes,1);
});

test('legacy missing draft is not guessed from customer or totals', async t => {
  const f=await fixture(t); f.finalize();
  await assert.rejects(f.build().run('T123'),/404/);
  assert.equal(f.closes,0); assert.equal(f.preparations,0);
});
