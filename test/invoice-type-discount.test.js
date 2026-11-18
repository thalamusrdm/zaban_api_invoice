'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function switchUI(from,{entered=true,confirm=true}={}){
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const fields={};
  const get=id=>fields[id]||=( {value:'',hidden:false,dataset:{},addEventListener(type,fn){this[type]=fn;},focus(){},toggleAttribute(){},dispatchEvent(){} } );
  get('invoiceType').value=from;
  Object.defineProperty(get('invoiceType'),'selectedOptions',{get:()=>[{textContent:({'1':'זהב','2':'יהלומים טבעיים','4':'יהלומי מעבדה'})[fields.invoiceType.value]}]});
  get('discount').value=get('discountBottom').value='85';
  function row(part,price,discount,edited){const f={'.l-part':{value:part},'.l-price':{value:price},'.l-grams':{value:'1'},'.l-discount':{value:discount}};return {dataset:edited?{discountEdited:'true'}:{},querySelector:s=>f[s]};}
  const original=row(entered?'PRODUCT':from==='1'?'14':'',entered?'200':'',entered?'70':'85',entered);
  const tbody={rows:[original],replaceChildren(){this.rows.length=0;}};
  let confirmations=0;
  const ctx={$:get,tbody,recalc(){},confirm(){confirmations++;return confirm;},Event:class{constructor(type){this.type=type;}},window:{scrollTo(){}},addLine(){tbody.rows.push(row(get('invoiceType').value==='1'?'14':'','',get('discount').value,false));}};
  const discount=html.slice(html.indexOf('function applyGlobalDiscount('),html.indexOf("$('discount').addEventListener"));
  const handler=html.slice(html.indexOf("$('typePicker').addEventListener('click', e => {"),html.indexOf("$('changeType').addEventListener('click'"));
  vm.runInNewContext(discount+'\n'+handler,ctx);
  return {fields,tbody,original,get confirmations(){return confirmations;},select(type){get('typePicker').click({target:{closest:()=>({dataset:{type}})}});}};
}

test('every different invoice type starts with zero global and line discounts',()=>{
  for(const from of ['1','2','4'])for(const to of ['1','2','4'])if(from!==to){
    const ui=switchUI(from);ui.select(to);
    assert.equal(ui.fields.invoiceType.value,to);
    assert.equal(ui.fields.discount.value,'0');assert.equal(ui.fields.discountBottom.value,'0');
    assert.equal(ui.tbody.rows.length,1);assert.equal(ui.tbody.rows[0].querySelector('.l-discount').value,'0');
    assert.equal(ui.tbody.rows.includes(ui.original),false);
  }
});
test('an advance discount is reset on type changes even before products have been entered',()=>{
  for(const from of ['1','2','4'])for(const to of ['1','2','4'])if(from!==to){
    const ui=switchUI(from,{entered:false});ui.select(to);
    assert.equal(ui.confirmations,0);
    assert.equal(ui.fields.discount.value,'0');assert.equal(ui.fields.discountBottom.value,'0');
    assert.ok(ui.tbody.rows.every(r=>r.querySelector('.l-discount').value==='0'));
  }
});
test('cancelling a type change preserves the current products and discounts',()=>{
  const ui=switchUI('4',{confirm:false});ui.select('1');
  assert.equal(ui.fields.invoiceType.value,'4');assert.equal(ui.fields.discount.value,'85');
  assert.equal(ui.fields.discountBottom.value,'85');assert.equal(ui.tbody.rows[0],ui.original);
  assert.equal(ui.original.querySelector('.l-discount').value,'70');
});
test('returning to the same invoice type preserves its entered discounts',()=>{
  for(const type of ['1','2','4']){
    const ui=switchUI(type);ui.select(type);
    assert.equal(ui.confirmations,0);assert.equal(ui.fields.discount.value,'85');
    assert.equal(ui.fields.discountBottom.value,'85');assert.equal(ui.tbody.rows[0],ui.original);
    assert.equal(ui.original.querySelector('.l-discount').value,'70');
  }
});
