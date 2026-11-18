'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const PartLookup=require('../public/part-lookup');
function cameraUI({secure=true,getMedia,imageDecode,decodeStream}={}){
  const nodes={},mediaCalls=[],codes=[],revoked=[],errors=[],windowEvents={},documentEvents={};let callback,stopped=0,decodes=0;
  class Node{
    constructor(){this.hidden=false;this.open=false;this.value='';this.attributes={};this.listeners={};}
    addEventListener(name,fn){this.listeners[name]=fn;}toggleAttribute(name,on){if(on)this.attributes[name]='';else delete this.attributes[name];}
    showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}pause(){}click(){this.clicked=true;return this.listeners.click?.();}
    fire(name,event={}){return this.listeners[name]?.(event);}
  }
  const el=id=>nodes[id]||=(new Node());
  el('cameraVideo').parentElement=new Node();el('productsStep').hidden=false;el('invoiceScreen').hidden=false;
  const stream={getTracks:()=>[{stop(){stopped++;}}]};let controlsStopped=0;
  const controls={stop(){controlsStopped++;}};
  const observers=[];
  class Reader{
    async decodeFromStream(s,video,fn){decodes++;callback=fn;video.srcObject=s;return decodeStream?decodeStream(controls):controls;}
    async decodeFromImageUrl(url){return imageDecode?imageDecode(url):{getText:()=> '001234'};}
  }
  const document={getElementById:el,hidden:false,addEventListener(name,fn){documentEvents[name]=fn;}};
  const ctx={BarcodeReader:require('../public/barcode-reader'),document,window:{isSecureContext:secure,ZXingBrowser:{BrowserMultiFormatReader:Reader},addEventListener(name,fn){windowEvents[name]=fn;}},navigator:{mediaDevices:{getUserMedia:async constraints=>{mediaCalls.push(constraints);return getMedia?getMedia(stream):stream;}}},PartLookup,receiveCameraBarcode:async code=>codes.push(code),showMsg:(_,s)=>errors.push(s),URL:{createObjectURL:()=> 'blob:local-image',revokeObjectURL:url=>revoked.push(url)},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/camera-scanner.js'),'utf8'),ctx);
  return {nodes,el,ctx,mediaCalls,codes,revoked,errors,document,observers,open:()=>el('scanProduct').click(),close:()=>el('closeCameraScanner').click(),scan:code=>callback({getText:()=>code},null,controls),fail:error=>callback(undefined,error,controls),photo:async()=>{el('cameraPhotoInput').files=[{type:'image/png'}];await el('cameraPhotoInput').fire('change');},get stopped(){return stopped;},get controlsStopped(){return controlsStopped;},get decodes(){return decodes;},hide(){document.hidden=true;documentEvents.visibilitychange();}};
}

test('camera starts only on request, prefers the rear camera and accepts one result',async()=>{
  const ui=cameraUI();assert.equal(ui.mediaCalls.length,0);await ui.open();
  assert.equal(ui.mediaCalls.length,1);assert.equal(ui.mediaCalls[0].audio,false);assert.equal(ui.mediaCalls[0].video.facingMode.ideal,'environment');
  ui.scan('001234');ui.scan('001234');await Promise.resolve();
  assert.deepEqual(ui.codes,['001234']);assert.equal(ui.el('cameraScanner').open,false);assert.ok(ui.stopped>0);assert.ok(ui.controlsStopped>0);
});
test('closing while permission is pending stops the late stream without decoding',async()=>{
  let grant;const ui=cameraUI({getMedia:stream=>new Promise(resolve=>{grant=()=>resolve(stream);})});
  const opening=ui.open();ui.close();grant();await opening;
  assert.equal(ui.decodes,0);assert.ok(ui.stopped>0);assert.equal(ui.codes.length,0);
});
test('late decoder controls are stopped after cancellation',async()=>{
  let finish,entered;const decoding=new Promise(resolve=>{entered=resolve;});
  const ui=cameraUI({decodeStream:controls=>{entered();return new Promise(resolve=>{finish=()=>resolve(controls);});}});
  const opening=ui.open();await decoding;
  assert.equal(ui.decodes,1);ui.close();finish();await opening;
  assert.ok(ui.controlsStopped>0);assert.ok(ui.stopped>0);assert.equal(ui.codes.length,0);
});
test('denied camera permission leaves a readable error and the photo fallback',async()=>{
  const ui=cameraUI({getMedia:()=>{const e=new Error('denied');e.name='NotAllowedError';throw e;}});await ui.open();
  assert.match(ui.el('cameraScannerStatus').textContent,/הרשאה/);assert.equal(ui.el('cameraScanner').open,true);assert.equal(ui.el('cameraPhoto').disabled,false);
});
test('HTTP uses local photo decoding without requesting a live camera',async()=>{
  const ui=cameraUI({secure:false});await ui.open();assert.equal(ui.mediaCalls.length,0);assert.match(ui.el('cameraScannerStatus').textContent,/HTTPS/);
  await ui.photo();assert.deepEqual(ui.codes,['001234']);assert.deepEqual(ui.revoked,['blob:local-image']);
});
test('closing during image decoding ignores the late result and revokes its URL',async()=>{
  let finish;const ui=cameraUI({secure:false,imageDecode:()=>new Promise(resolve=>{finish=()=>resolve({getText:()=> 'LATE'});})});await ui.open();
  const photo=ui.photo();ui.close();finish();await photo;assert.equal(ui.codes.length,0);assert.deepEqual(ui.revoked,['blob:local-image']);
});
test('backgrounding or leaving the product step releases camera tracks',async()=>{
  const ui=cameraUI();await ui.open();ui.hide();assert.ok(ui.stopped>0);assert.ok(ui.controlsStopped>0);
  assert.match(ui.el('cameraScannerStatus').textContent,/הופסקה/);
  ui.el('productsStep').hidden=true;ui.observers[0]();assert.equal(ui.el('cameraScanner').open,false);
});
test('invalid image content never reaches the product lookup',async()=>{
  const ui=cameraUI({secure:false,imageDecode:async()=>({getText:()=> 'x'.repeat(129)})});await ui.open();await ui.photo();
  assert.equal(ui.codes.length,0);assert.equal(ui.el('cameraScanner').open,true);assert.match(ui.el('cameraScannerStatus').textContent,/אינו קוד מוצר תקין/);
});

test('ordinary misses keep scanning but unexpected decoder failures stop the camera visibly',async()=>{
 const ui=cameraUI();await ui.open();ui.fail({getKind:()=> 'NotFoundException'});
 assert.equal(ui.stopped,0);assert.equal(ui.el('cameraVideo').parentElement.hidden,false);
 ui.fail(new TypeError('bad frame'));assert.ok(ui.stopped>0);assert.ok(ui.controlsStopped>0);
 assert.equal(ui.el('cameraVideo').parentElement.hidden,true);assert.match(ui.el('cameraScannerStatus').textContent,/הסריקה נעצרה/);assert.equal(ui.codes.length,0);
});
test('repeated misses give alignment guidance without stopping or inserting products',async()=>{
 const ui=cameraUI();await ui.open();for(let n=0;n<25;n++)ui.fail({getKind:()=> 'NotFoundException'});
 assert.match(ui.el('cameraScannerStatus').textContent,/שוליים לבנים/);assert.equal(ui.stopped,0);assert.equal(ui.codes.length,0);
});
