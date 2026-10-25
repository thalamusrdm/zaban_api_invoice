'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function workflow({closeError,downloadError,waitClose,digitalMode=false,downloadMode=false,consented=true,email='agent@example.com',preflightError}={}) {
  const calls=[],messages=[],anchors=[],timers=[],progress=[]; let submit;
  const button={disabled:false,textContent:'הפקה, סגירה והורדת PDF'};
  const retry={disabled:false,textContent:'הורדה חוזרת'};
  const notices={className:'',textContent:'',appendChild(a){anchors.push(a);}};
  const fields={submit:button,documentMsg:notices,form:{addEventListener(_,fn){submit=fn;}},details:{value:'ORDER-TEST'},custname:{value:'TEST'},date:{value:'2026-10-20'},invoiceType:{value:'1'},warehouse:{value:''},location:{value:''},agent:{value:''},booknum:{value:''}};
  if(digitalMode){fields.digitalEmailConsent={checked:consented};fields.invoiceEmail={value:email,checkValidity:()=>/^[^@ ]+@[^@ ]+\.[^@ ]+$/.test(email)};}
  const msg={className:'',querySelector(){return retry;}};
  class TestURL extends URL { static createObjectURL(){return 'blob:test';} static revokeObjectURL(){} }
  const ctx={InvoiceProgress:{show:stage=>progress.push('show:'+stage),update:stage=>progress.push(stage),hide:()=>progress.push('hide')},msg,$:id=>fields[id],async finishOriginalDownload(data){calls.push('original-finish:'+data.ivnum);},async finishDigitalInvoice(data){calls.push('digital-finish:'+data.ivnum);},readLines:()=>[{partname:'14',price:78.36,exchange:3.11}],tbody:{innerHTML:''},addLine(){},recalc(){},loadRecent(){},escapeHtml:String,fmt:String,confirm(){throw new Error('Unexpected confirmation in authorized one-click flow');},
    async api(url,opts){calls.push(url);if(url.includes('/original-download-preflight')){if(preflightError)throw Error(preflightError);return {ok:true};}if(url.includes('/check'))return {value:[]};if(url.endsWith('/close')){if(waitClose)await waitClose;if(closeError)throw new Error(closeError);return {ivnum:'IN-TEST',status:'סופית',originalDownload:downloadMode,digitalEmail:digitalMode,email};}return {ivnum:'T-TEST',status:'טיוטא',total:100};},
    async fetch(url){calls.push(url);if(downloadError)throw new Error(downloadError);return {ok:true,headers:{get:()=> 'application/pdf'},blob:async()=>({size:10})};},
    document:{body:{appendChild(){}},createElement(){const a={click(){anchors.push(a);},remove(){}};return a;}},URL:TestURL,location:{href:'http://local/'},setTimeout(fn){timers.push(fn);},showMsg(type,text){messages.push({type,text});},
  };
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const submitCode=html.slice(html.indexOf("$('form').addEventListener('submit'"),html.indexOf('// ---------- חשבוניות אחרונות'));
  const closeCode=html.slice(html.indexOf('async function closeInvoice('),html.lastIndexOf("document.addEventListener('click', e => {"));
  vm.runInNewContext(submitCode+'\n'+closeCode,ctx);
  return {run:()=>submit({preventDefault(){}}),ctx,calls,messages,anchors,timers,button,retry,notices,fields,progress};
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
test('one click creates once, closes once, and downloads the final invoice number',async()=>{
  const w=workflow();await w.run();
  assert.deepEqual(w.calls,['/api/invoices/original-download-preflight','/api/invoices/check?details=ORDER-TEST','/api/invoices','/api/invoices/close','/api/invoices/document?ivnum=IN-TEST']);
  assert.equal(w.anchors[0].download,'IN-TEST.pdf');assert.equal(w.timers.length,1);
  assert.match(w.messages.at(-1).text,/IN-TEST/);assert.equal(w.notices.className,'msg show ok');assert.equal(w.button.disabled,false);
});
test('closing failure retains created draft and retry action, with no document request or new creation',async()=>{
  const w=workflow({closeError:'cannot close'});await w.run();
  assert.equal(w.calls.filter(x=>x==='/api/invoices').length,1);assert.equal(w.calls.some(x=>x.includes('/document')),false);
  assert.equal(w.messages.at(-1).type,'warn');assert.match(w.messages.at(-1).text,/T-TEST/);assert.match(w.messages.at(-1).text,/ניסיון סגירה חוזר/);
  assert.equal(w.fields.details.value,'');assert.equal(w.button.disabled,false);
});
test('download failure preserves final-invoice success and leaves download retry enabled',async()=>{
  const w=workflow({downloadError:'network down'});await w.run();
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

test('no-email flow preflights before creating and finishes with original download',async()=>{const w=workflow({downloadMode:true});await w.run();assert.equal(w.calls[0],'/api/invoices/original-download-preflight');assert.equal(w.calls.at(-1),'original-finish:IN-TEST');assert.equal(w.calls.some(x=>x.includes('/email')),false);});
test('empty email and unchecked old email consent do not block no-email issuance',async()=>{const w=workflow({digitalMode:true,downloadMode:true,email:'',consented:false});await w.run();assert.equal(w.calls.at(-1),'original-finish:IN-TEST');assert.equal(w.calls.some(x=>x.includes('/email')),false);});
test('failed customer preflight stops before invoice creation',async()=>{const w=workflow({preflightError:'customer incomplete'});await w.run();assert.deepEqual(w.calls,['/api/invoices/original-download-preflight']);assert.match(w.messages.at(-1).text,/customer incomplete/);});

test('original download reads the attachment endpoint and never starts generation or email',async()=>{
  const w=workflow();await w.ctx.downloadInvoice('IN260007646',{disabled:false,textContent:'הורדת מקור',dataset:{kind:'original'}});
  assert.deepEqual(w.calls,['/api/invoices/existing-original?ivnum=IN260007646']);assert.equal(w.anchors[0].download,'IN260007646-original.pdf');
});

test('one-click no-email flow prepares and downloads the original then opens the copy for signing',async()=>{
  const w=workflow({downloadMode:true});const signature=fs.readFileSync(path.join(__dirname,'../public/signature.js'),'utf8');const start=signature.indexOf('async function finishOriginalDownload(');const end=signature.indexOf('async function finishDigitalInvoice(',start);
  w.ctx.document.getElementById=id=>w.fields[id];w.ctx.openInvoiceForSigning=async ivnum=>w.calls.push('sign-copy:'+ivnum);vm.runInNewContext(signature.slice(start,end),w.ctx);await w.run();
  assert.deepEqual(w.calls,['/api/invoices/original-download-preflight','/api/invoices/check?details=ORDER-TEST','/api/invoices','/api/invoices/close','/api/invoices/prepare-original-download','/api/invoices/existing-original?ivnum=IN-TEST','sign-copy:IN-TEST']);assert.equal(w.anchors[0].download,'IN-TEST-original.pdf');
});
