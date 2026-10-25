'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function progressUI() {
  class Element {
    constructor(){this.attributes={};this.dataset={};this.listeners={};this.open=false;}
    setAttribute(k,v){this.attributes[k]=v;}
    removeAttribute(k){delete this.attributes[k];}
    addEventListener(k,fn){this.listeners[k]=fn;}
    showModal(){this.open=true;}
    close(){this.open=false;}
    querySelectorAll(){return stages;}
  }
  const stages=['creating','closing','original','signature'].map(progress=>Object.assign(new Element(),{dataset:{progress}}));
  const ids=['invoiceProgressDialog','invoiceProgressStatus','form','signatureDialog','signatureName','signaturePdf','signatureCopyLink','signatureTitle','signatureStatus'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const ctx={document:{getElementById:id=>elements[id]},clearInvoiceSignature(){},updateSignatureButton(){},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}};
  const context=vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/invoice-progress.js'),'utf8')+'\nthis.progress=InvoiceProgress;',context);
  const signature=fs.readFileSync(path.join(__dirname,'../public/signature.js'),'utf8');
  vm.runInContext('let signingState=null,signatureLoad=0;\n'+signature.slice(signature.indexOf('async function openInvoiceForSigning('),signature.indexOf('async function finishOriginalDownload(')),context);
  return {elements,stages,ctx,progress:ctx.progress};
}

test('progress tracks real stages, blocks Escape and removes busy state on completion',()=>{
  const ui=progressUI();ui.progress.show();
  assert.equal(ui.progress.isOpen(),true);
  assert.equal(ui.elements.form.attributes['aria-busy'],'true');
  let prevented=false;ui.elements.invoiceProgressDialog.listeners.cancel({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  ui.progress.update('original');
  assert.equal(ui.stages[0].dataset.state,'done');
  assert.equal(ui.stages[2].attributes['aria-current'],'step');
  assert.equal(ui.stages[3].dataset.state,'pending');
  ui.progress.hide();ui.progress.hide();
  assert.equal(ui.progress.isOpen(),false);
  assert.equal(ui.elements.form.attributes['aria-busy'],undefined);
});

for(const failed of [false,true])test(`waiting hands off to signature after copy ${failed?'failure':'readiness'}`,async()=>{
  const ui=progressUI();let finish;
  ui.ctx.fetch=()=>new Promise(resolve=>{finish=resolve;});
  ui.progress.show('original');
  const request=ui.ctx.openInvoiceForSigning('IN-TEST-DOR');
  assert.equal(ui.progress.isOpen(),true);
  assert.equal(ui.elements.signatureDialog.open,false);
  assert.equal(ui.stages[3].attributes['aria-current'],'step');
  finish(failed?{ok:false,json:async()=>({error:'test error'})}:{ok:true,headers:{get:key=>key==='content-type'?'application/pdf':'test-token'},blob:async()=>({size:10})});
  assert.equal(await request,!failed);
  assert.equal(ui.progress.isOpen(),false);
  assert.equal(ui.elements.signatureDialog.open,true);
  if(failed)assert.match(ui.elements.signatureStatus.textContent,/test error/);
  else assert.equal(ui.elements.signaturePdf.src,'blob:test');
});
