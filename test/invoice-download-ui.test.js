'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function workflow({closeError,closeState,downloadError,waitClose,digitalMode=false,downloadMode=false,sendOriginalEmail=false,consented=true,email='agent@example.com',preflightError,mailError}={}) {
  const calls=[],messages=[],anchors=[],timers=[],progress=[],bodies=[]; let submit;
  const button={disabled:false,textContent:'הפקה והמשך לחתימה'};
  const retry={disabled:false,textContent:'הורדת מקור'};
  const notices={className:'',textContent:'',appendChild(a){anchors.push(a);}};
  const fields={submit:button,documentMsg:notices,form:{addEventListener(_,fn){submit=fn;}},details:{value:'ORDER-TEST'},custname:{value:'TEST'},date:{value:'2026-10-20'},invoiceType:{value:'1'},warehouse:{value:''},location:{value:''},agent:{value:''},booknum:{value:''}};
  if(digitalMode){fields.digitalEmailConsent={checked:consented};fields.invoiceEmail={value:email,checkValidity:()=>/^[^@ ]+@[^@ ]+\.[^@ ]+$/.test(email)};}
  if(sendOriginalEmail){fields.sendOriginalEmail={checked:true};fields.customerEmail={value:email,reportValidity:()=>true};}
  const msg={className:'',querySelector(){return retry;}};
  class TestURL extends URL { static createObjectURL(){return 'blob:test';} static revokeObjectURL(){} }
  const ctx={validateProductSelections:async()=>true,InvoiceProgress:{show:stage=>progress.push('show:'+stage),update:stage=>progress.push(stage),hide:()=>progress.push('hide')},msg,$:id=>fields[id],async finishOriginalDownload(data){calls.push('original-finish:'+data.ivnum);},async finishDigitalInvoice(data){calls.push('digital-finish:'+data.ivnum);},readLines:()=>[{partname:'14',price:78.36,exchange:3.11}],tbody:{innerHTML:''},addLine(){},recalc(){},loadRecent(){},escapeHtml:String,fmt:String,confirm(){throw new Error('Unexpected confirmation in authorized one-click flow');},
    async api(url,opts){calls.push(url);if(opts?.body)bodies.push({url,body:JSON.parse(opts.body)});if(url.includes('/close-status'))return closeState || {closed:false,pending:false};if(url.endsWith('/email-original')){if(mailError)throw Error(mailError);return {acceptedByMailServer:true,email};}if(url.includes('/original-download-preflight')){if(preflightError)throw Error(preflightError);return {ok:true};}if(url.includes('/check'))return {value:[]};if(url.endsWith('/close')){if(waitClose)await waitClose;if(closeError)throw new Error(closeError);return {ivnum:'IN-TEST',status:'סופית',originalDownload:downloadMode,digitalEmail:digitalMode,sendOriginalEmail,email};}return {ivnum:'T-TEST',status:'טיוטא',total:100};},
    loadAgentRecent(){},
    async fetch(url){calls.push(url);if(downloadError)throw new Error(downloadError);return {ok:true,headers:{get:()=> 'application/pdf'},blob:async()=>({size:10})};},
    document:{body:{appendChild(){}},createElement(){const a={click(){anchors.push(a);},remove(){}};return a;}},URL:TestURL,location:{href:'http://local/'},setTimeout(fn){timers.push(fn);},showMsg(type,text){messages.push({type,text});},
  };
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const submitCode=html.slice(html.indexOf("$('form').addEventListener('submit'"),html.indexOf('// ---------- חשבוניות אחרונות'));
  const closeCode=html.slice(html.indexOf('async function closeInvoice('),html.lastIndexOf("document.addEventListener('click', e => {"));
  vm.runInNewContext(submitCode+'\n'+closeCode,ctx);
  return {run:()=>submit({preventDefault(){}}),ctx,calls,messages,anchors,timers,button,retry,notices,fields,progress,bodies};
}

test('issuance shows progress until closing finishes, and releases it on failure',async()=>{
  let done;const pending=new Promise(resolve=>{done=resolve;});const w=workflow({waitClose:pending});
  w.fields.custname.value='301100';
  const run=w.run();
  while(!w.calls.includes('/api/invoices/close'))await Promise.resolve();
  assert.deepEqual(w.progress,['show:creating','closing']);
  done();await run;assert.equal(w.progress.at(-1),'hide');
  const failed=workflow({preflightError:'test failure'});failed.fields.custname.value='301100';await failed.run();
  assert.deepEqual(failed.progress,['show:creating','hide']);
  assert.equal(failed.button.disabled,false);
});
test('one click creates and closes once without downloading or opening a document',async()=>{
  const w=workflow();await w.run();
  assert.deepEqual(w.calls,['/api/invoices/original-download-preflight','/api/invoices/check?details=ORDER-TEST','/api/invoices','/api/invoices/close']);
  assert.equal(w.anchors.length,0);assert.equal(w.timers.length,0);
  assert.match(w.messages.at(-1).text,/IN-TEST/);assert.match(w.messages.at(-1).text,/הורדת מקור/);assert.match(w.messages.at(-1).text,/data-kind="original"/);assert.equal(w.notices.className,'msg show ok');assert.equal(w.button.disabled,false);
});
test('unverified products stop submission before any invoice request', async () => {
  const w = workflow();
  w.ctx.validateProductSelections = async () => false;
  await w.run();
  assert.equal(w.calls.length, 0);
  assert.equal(w.button.disabled, false);
});
test('closing failure retains created draft and retry action, with no document request or new creation',async()=>{
  const w=workflow({closeError:'cannot close'});await w.run();
  assert.equal(w.calls.filter(x=>x==='/api/invoices').length,1);assert.equal(w.calls.some(x=>x.includes('/document')),false);
  assert.equal(w.messages.at(-1).type,'warn');assert.match(w.messages.at(-1).text,/T-TEST/);assert.match(w.messages.at(-1).text,/ניסיון סגירה חוזר/);
  assert.equal(w.fields.details.value,'ORDER-TEST');assert.equal(w.button.disabled,false);
});

test('lost closing response automatically reconciles and continues preparation for the final number',async()=>{
  const w=workflow({closeError:'network timeout',closeState:{closed:true,ivnum:'IN123',status:'סופית',originalDownload:true}});
  await w.run();
  assert.ok(w.calls.includes('/api/invoices/close-status?ivnum=T-TEST'));
  assert.ok(w.calls.includes('original-finish:IN123'));
  assert.equal(w.calls.filter(url=>url==='/api/invoices').length,1);
  assert.equal(w.calls.filter(url=>url==='/api/invoices/close').length,1);
  assert.equal(w.messages.at(-1).type,'ok');
});

test('pending close survives failure and prevents a second invoice creation on submit',async()=>{
  const w=workflow({closeError:'network timeout'}), state=new Map();
  w.ctx.sessionStorage={getItem:key=>state.get(key),setItem:(key,value)=>state.set(key,value),removeItem:key=>state.delete(key)};
  await w.run();assert.equal(state.get('zabanPendingClose'),'T-TEST');
  assert.equal(w.fields.details.value,'ORDER-TEST');
  await w.run();
  assert.equal(w.calls.filter(url=>url==='/api/invoices').length,1);
  assert.equal(state.get('zabanPendingClose'),'T-TEST');
});

test('recovered final invoice clears pending close after its original is ready',async()=>{
  const w=workflow({closeError:'lost response',closeState:{closed:true,ivnum:'IN123',status:'סופית',originalDownload:true}}), state=new Map();
  w.ctx.sessionStorage={getItem:key=>state.get(key),setItem:(key,value)=>state.set(key,value),removeItem:key=>state.delete(key)};
  await w.run();assert.equal(state.has('zabanPendingClose'),false);
});

test('reloading resumes only the saved close and never invokes creation',async()=>{
  const calls=[];
  const context={sessionStorage:{getItem:()=> 'T123'},async closeInvoice(...args){calls.push(args);}};
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/invoice-close-recovery.js'),'utf8'),context);
  assert.deepEqual(Array.from(calls[0]),['T123',null,false]);
  assert.equal(calls.length,1);
});
test('download failure preserves final-invoice success and leaves download retry enabled',async()=>{
  const w=workflow({downloadError:'network down'});await w.run();
  await w.ctx.downloadInvoice('IN-TEST',w.retry,'copy');
  assert.equal(w.messages.at(-1).type,'ok');assert.match(w.messages.at(-1).text,/IN-TEST/);
  assert.match(w.notices.textContent,/אין צורך להפיק חשבונית נוספת/);assert.match(w.notices.textContent,/network down/);assert.equal(w.retry.disabled,false);
});
test('repeated submit while closing cannot create a duplicate invoice',async()=>{
  let done;const pending=new Promise(resolve=>{done=resolve;});const w=workflow({waitClose:pending});
  const first=w.run();await w.run();done();await first;
  assert.equal(w.calls.filter(x=>x==='/api/invoices').length,1);
});
test('simultaneous download retries for one invoice share the pending request',async()=>{
  const w=workflow();await Promise.all([w.ctx.downloadInvoice('IN-TEST',w.retry),w.ctx.downloadInvoice('IN-TEST',w.retry)]);
  assert.equal(w.calls.length,1);assert.equal(w.anchors.length,1);
});

test('no-email flow preflights before creating and prepares the original without a download',async()=>{const w=workflow({downloadMode:true});await w.run();assert.equal(w.calls[0],'/api/invoices/original-download-preflight');assert.equal(w.calls.at(-1),'original-finish:IN-TEST');assert.equal(w.calls.some(x=>x.includes('/email')),false);});
test('empty email and unchecked old email consent do not block no-email issuance',async()=>{const w=workflow({digitalMode:true,downloadMode:true,email:'',consented:false});await w.run();assert.equal(w.calls.at(-1),'original-finish:IN-TEST');assert.equal(w.calls.some(x=>x.includes('/email')),false);});
test('failed customer preflight stops before invoice creation',async()=>{const w=workflow({preflightError:'customer incomplete'});await w.run();assert.deepEqual(w.calls,['/api/invoices/original-download-preflight']);assert.match(w.messages.at(-1).text,/customer incomplete/);});

test('original download reads the attachment endpoint and never starts generation or email',async()=>{
  const w=workflow();await w.ctx.downloadInvoice('IN260007646',{disabled:false,textContent:'הורדת מקור',dataset:{kind:'original'}});
  assert.deepEqual(w.calls,['/api/invoices/existing-original?ivnum=IN260007646']);assert.equal(w.anchors[0].download,'IN260007646-original.pdf');
});

test('one-click no-email flow prepares the original then opens the signing copy without a download',async()=>{
  const w=workflow({downloadMode:true});const signature=fs.readFileSync(path.join(__dirname,'../public/signature.js'),'utf8');const start=signature.indexOf('async function finishOriginalDownload(');const end=signature.indexOf('async function finishDigitalInvoice(',start);
  w.ctx.document.getElementById=id=>w.fields[id];w.ctx.openInvoiceForSigning=async ivnum=>w.calls.push('sign-copy:'+ivnum);vm.runInNewContext(signature.slice(start,end),w.ctx);await w.run();
  assert.deepEqual(w.calls,['/api/invoices/original-download-preflight','/api/invoices/check?details=ORDER-TEST','/api/invoices','/api/invoices/close','/api/invoices/prepare-original-download','sign-copy:IN-TEST']);assert.equal(w.anchors.length,0);
  await w.ctx.downloadInvoice('IN-TEST',w.retry,'original');
  assert.equal(w.calls.at(-1),'/api/invoices/existing-original?ivnum=IN-TEST');assert.equal(w.anchors[0].download,'IN-TEST-original.pdf');
});

test('combined flow prepares and mails the saved original before signing without a browser download',async()=>{
  for(const downloadError of [undefined,'download offline']){
    const w=workflow({downloadMode:true,sendOriginalEmail:true,downloadError});
    const script=fs.readFileSync(path.join(__dirname,'../public/signature.js'),'utf8');
    w.ctx.document.getElementById=id=>w.fields[id];w.ctx.openInvoiceForSigning=async ivnum=>w.calls.push('sign-copy:'+ivnum);
    vm.runInNewContext(script.slice(script.indexOf('async function finishOriginalDownload('),script.indexOf('async function finishDigitalInvoice(')),w.ctx);
    await w.run();
    assert.equal(w.calls.filter(url=>url==='/api/invoices/email-original').length,1);
    assert.equal(w.calls.at(-1),'sign-copy:IN-TEST');
    assert.ok(w.calls.indexOf('/api/invoices/email-original')>w.calls.indexOf('/api/invoices/prepare-original-download'));
    assert.equal(w.calls.some(url=>url.includes('/existing-original')||url.includes('/document?')),false);
    assert.equal(w.anchors.length,0);
    const creation=w.bodies.find(item=>item.url==='/api/invoices').body;
    assert.equal(creation.sendOriginalEmail,true);assert.equal(creation.consent,true);assert.equal(creation.email,'agent@example.com');
    assert.match(w.notices.textContent,/שרת הדואר קיבל/);
  }
});
test('mail failure leaves download available and still opens the existing invoice for signature',async()=>{
  const w=workflow({downloadMode:true,sendOriginalEmail:true,mailError:'mail offline'});
  const script=fs.readFileSync(path.join(__dirname,'../public/signature.js'),'utf8');
  w.ctx.document.getElementById=id=>w.fields[id];w.ctx.openInvoiceForSigning=async ivnum=>w.calls.push('sign-copy:'+ivnum);
  vm.runInNewContext(script.slice(script.indexOf('async function finishOriginalDownload('),script.indexOf('async function finishDigitalInvoice(')),w.ctx);
  await w.run();assert.equal(w.anchors.length,0);
  assert.match(w.messages.at(-1).text,/הורדת מקור/);
  assert.equal(w.calls.at(-1),'sign-copy:IN-TEST');assert.match(w.notices.textContent,/mail offline/);
  assert.equal(w.calls.filter(url=>url==='/api/invoices').length,1);
});


test('manual original download after signature reports status on the visible completion screen',async()=>{
  const w=workflow();
  w.fields.completionNotice={hidden:false};w.fields.invoiceScreen={hidden:true};w.fields.completionDocumentStatus={textContent:'',className:''};
  await w.ctx.downloadInvoice('IN-TEST',w.retry,'original');
  assert.equal(w.calls[0],'/api/invoices/existing-original?ivnum=IN-TEST');
  assert.equal(w.anchors.length,1);
  assert.match(w.fields.completionDocumentStatus.textContent,/נשלח להורדה/);
  assert.equal(w.notices.textContent,'');
});
