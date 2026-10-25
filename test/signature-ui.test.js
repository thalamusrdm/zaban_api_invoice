'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function signatureUI({failSave=false,unverified=false}={}){
  const nodes=new Map(),calls=[];
  function get(id){
    if(!nodes.has(id))nodes.set(id,{value:'',attributes:{},listeners:{},width:640,height:180,
      setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},
      addEventListener(k,fn){this.listeners[k]=fn;},setPointerCapture(){},
      getBoundingClientRect(){return {left:0,top:0,width:640,height:180};},
      getContext(){return {fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};},
      toDataURL(){return 'data:image/png;base64,test';}});
    return nodes.get(id);
  }
  const context={document:{getElementById:get},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},showSignatureFlow:iv=>calls.push('step4:'+iv),completeSignatureFlow:iv=>calls.push('thanks:'+iv),
    fetch:async()=>({ok:true,headers:{get:key=>key==='content-type'?'application/pdf':'test-token'},blob:async()=>({size:10})}),
    api:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});if(failSave)throw Error('test error');return {ivnum:'IN-TEST-DOR',attached:!unverified};}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/signature.js'),'utf8'),context);
  return {get,calls,open:()=>context.openInvoiceForSigning('IN-TEST-DOR'),save:()=>get('saveSignature').listeners.click(),draw(){
    const canvas=get('signatureCanvas');canvas.listeners.pointerdown({preventDefault(){},pointerId:1,clientX:10,clientY:10});
    for(const x of [30,50])canvas.listeners.pointermove({preventDefault(){},clientX:x,clientY:20});
    canvas.listeners.pointerup();
  }};
}

test('signature save is clickable when ready and shows a clear saved state after a single upload',async()=>{
  const ui=signatureUI();await ui.open();
  assert.equal(ui.get('saveSignature').disabled,false);
  ui.get('signatureName').value='דור עזריאל';ui.draw();await ui.save();
  assert.equal(ui.get('saveSignature').textContent,'המסמך נשמר');
  assert.equal(ui.get('saveSignature').disabled,true);
  assert.equal(ui.get('clearSignature').disabled,true);
  assert.equal(ui.get('signatureName').readOnly,true);
  await ui.save();
  assert.equal(ui.calls.filter(x=>x.url==='/api/invoices/sign').length,1);
  assert.equal(ui.calls.filter(x=>x==='thanks:IN-TEST-DOR').length,1);
});

test('failed signature save stays editable and retryable with the signature retained',async()=>{
  const ui=signatureUI({failSave:true});await ui.open();ui.get('signatureName').value='דור עזריאל';ui.draw();await ui.save();
  assert.equal(ui.get('saveSignature').disabled,false);
  assert.equal(ui.get('signatureName').readOnly,false);
  assert.match(ui.get('signatureStatus').textContent,/test error/);
  await ui.save();
  assert.equal(ui.calls.filter(x=>x.url==='/api/invoices/sign').length,2);
  assert.equal(ui.calls.some(x=>typeof x==='string'&&x.startsWith('thanks:')),false);
});

test('an unverified attachment never shows thanks or leaves the signature step',async()=>{
  const ui=signatureUI({unverified:true});await ui.open();ui.get('signatureName').value='דור עזריאל';ui.draw();await ui.save();
  assert.equal(ui.calls.some(x=>typeof x==='string'&&x.startsWith('thanks:')),false);
  assert.equal(ui.get('saveSignature').disabled,false);
});
