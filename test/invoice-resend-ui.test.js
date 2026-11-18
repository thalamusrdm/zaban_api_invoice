'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function resendUI(api, storage=new Map(), options={}) {
  const nodes={},calls=[];
  function el(id) {return nodes[id] ||= {value:'',textContent:'',disabled:false,readOnly:false,open:false,handlers:{},attrs:{},
    addEventListener(type,fn){this.handlers[type]=fn;},
    setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},
    showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();},focus(){},
    reportValidity(){return /^[^@ ]+@[^@ ]+\.[^@ ]+$/.test(this.value);},
  };}
  let sequence=0;
  const context={document:{getElementById:el},Uint8Array,
    crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`},
    sessionStorage:{getItem:key=>storage.get(key),setItem(key,value){if(options.storageError)throw Error('Storage blocked');storage.set(key,value);}},
    async api(url,opts){calls.push({url,body:opts?.body&&JSON.parse(opts.body)});
      if(api)return api(url,opts);
      if(!opts)return {ivnum:new URL(url,'http://test').searchParams.get('ivnum'),custname:'INVOICE-CUSTOMER',name:'Test customer',email:'customer@example.com',configured:true};
      const body=JSON.parse(opts.body);return {...body,acceptedByMailServer:true};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/invoice-resend.js'),'utf8')+'\nthis.openResend = openInvoiceResend;',context);
  return {nodes,el,calls,storage,open:context.openResend,
    submit:()=>el('resendForm').handlers.submit({preventDefault(){}})};
}

test('opening a resend only reads the invoice recipient; explicit submit can use a corrected email', async()=>{
  const ui=resendUI();await ui.open('IN123');
  assert.equal(ui.el('resendDialog').open,true);
  assert.equal(ui.el('resendEmail').value,'customer@example.com');
  assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].body,undefined);
  ui.el('resendEmail').value='corrected@example.com';await ui.submit();
  const send=ui.calls[1];assert.equal(send.url,'/api/invoices/resend-original');
  assert.equal(send.body.ivnum,'IN123');assert.equal(send.body.email,'corrected@example.com');assert.equal(send.body.consent,true);
  assert.match(ui.el('resendStatus').textContent,/corrected@example.com/);
  assert.equal(ui.el('sendResend').disabled,true);
  await ui.submit();assert.equal(ui.calls.length,2);
});

test('rapid double submit sends one request and cannot close the dialog during a send',async()=>{
  let done;const ui=resendUI((url,opts)=>opts?new Promise(resolve=>{done=resolve;}):
    Promise.resolve({ivnum:'IN123',custname:'TEST',email:'a@example.com',configured:true}));
  await ui.open('IN123');const pending=ui.submit();await ui.submit();
  assert.equal(ui.calls.filter(c=>c.body).length,1);assert.equal(ui.el('closeResend').disabled,true);
  let cancelled=false;ui.el('resendDialog').handlers.cancel({preventDefault(){cancelled=true;}});assert.equal(cancelled,true);
  ui.el('closeResend').handlers.click();assert.equal(ui.el('resendDialog').open,true);
  done({acceptedByMailServer:true,ivnum:'IN123',email:'a@example.com'});await pending;
  assert.equal(ui.el('closeResend').disabled,false);
});

test('an uncertain request keeps its recipient and ID across dialog close and page reload',async()=>{
  const storage=new Map();const first=resendUI((_url,opts)=>opts?Promise.reject(Error('timeout')):
    Promise.resolve({ivnum:'IN123',custname:'TEST',email:'a@example.com',configured:true}),storage);
  await first.open('IN123');await first.submit();
  const id=first.calls[1].body.requestId;
  assert.match(first.el('resendStatus').textContent,/לא אומתה/);
  const reloaded=resendUI(undefined,storage);await reloaded.open('IN123');
  assert.equal(reloaded.el('resendEmail').value,'a@example.com');assert.equal(reloaded.el('resendEmail').readOnly,true);
  assert.match(reloaded.el('sendResend').textContent,/בדיקת תוצאת/);
  await reloaded.submit();assert.equal(reloaded.calls[1].body.requestId,id);
  assert.equal(reloaded.calls[1].body.email,'a@example.com');
});

test('a deliberate resend after a confirmed send has a new ID only after opening and submitting again',async()=>{
  const ui=resendUI();await ui.open('IN123');await ui.submit();const firstId=ui.calls[1].body.requestId;
  ui.el('closeResend').handlers.click();await ui.open('IN123');
  assert.equal(ui.calls.filter(c=>c.body).length,1);await ui.submit();
  assert.notEqual(ui.calls.at(-1).body.requestId,firstId);
});

test('unconfigured mail, invalid email or inability to persist the request prevent sending',async()=>{
  const unavailable=resendUI(async()=>({ivnum:'IN123',name:'Test',email:'a@example.com',configured:false}));
  await unavailable.open('IN123');await unavailable.submit();assert.equal(unavailable.calls.length,1);
  const invalid=resendUI();await invalid.open('IN123');invalid.el('resendEmail').value='';await invalid.submit();assert.equal(invalid.calls.length,1);
  const blocked=resendUI(undefined,new Map(),{storageError:true});await blocked.open('IN123');await blocked.submit();
  assert.equal(blocked.calls.length,1);assert.match(blocked.el('resendStatus').textContent,/Storage blocked/);
});

test('a late response for a different invoice cannot replace the open recipient',async()=>{
  const pending=[];const ui=resendUI(()=>new Promise(resolve=>pending.push(resolve)));
  const first=ui.open('IN123'),second=ui.open('IN124');
  pending[1]({ivnum:'IN124',custname:'SECOND',name:'Second',email:'second@example.com',configured:true});await second;
  pending[0]({ivnum:'IN123',custname:'FIRST',name:'First',email:'first@example.com',configured:true});await first;
  assert.equal(ui.el('resendEmail').value,'second@example.com');assert.match(ui.el('resendTitle').textContent,/IN124/);
});

test('a mismatched mail confirmation is not displayed as success and retains the pending request',async()=>{
  const ui=resendUI((_url,opts)=>Promise.resolve(opts?{acceptedByMailServer:true,ivnum:'IN124',email:'other@example.com'}:
    {ivnum:'IN123',custname:'TEST',email:'a@example.com',configured:true}));
  await ui.open('IN123');await ui.submit();
  assert.match(ui.el('resendStatus').textContent,/לא אומתה/);
  assert.equal(JSON.parse(ui.storage.get('zabanInvoiceResend:IN123')).status,'pending');
});
