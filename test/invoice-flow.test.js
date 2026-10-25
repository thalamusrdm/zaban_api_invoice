'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function flow() {
  class Element {
    constructor() { this.listeners = {}; this.attributes = {}; this.hidden = false; this.value = ''; this.fields = []; this.children = []; this.tagName = 'INPUT'; this.classList={remove(){}}; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    fire(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    contains(field) { return this.fields.includes(field); }
    querySelectorAll() { return this.fields; }
    querySelector(selector) { return this.selectors?.[selector] || this.heading; }
    checkValidity() { return this.valid !== false; }
    reportValidity() { this.reported = true; }
    focus() { this.focused = true; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
  }
  const ids = ['completionNotice','completionDetails','completionTitle','msg','documentMsg','custChosen','custInfo','custEdit','customerStep', 'productsStep', 'reviewStep', 'signatureDialog', 'changeType', 'form', 'reviewCustomer', 'reviewDate', 'reviewDetails', 'reviewDetailsRow', 'reviewLines', 'custSearch', 'custname', 'date', 'details', 'lines', 'previousStep', 'nextStep', 'stepCount', 'stepStatus', 'submit', 'typePicker', 'invoiceScreen'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const panels = ['customerStep', 'productsStep', 'reviewStep', 'signatureDialog'].map(id => elements[id]);
  panels.forEach((panel, index) => { panel.heading = new Element(); panel.hidden = index !== 0; });
  elements.custSearch.value = 'דור עזריאל - יועץ'; elements.custname.value = '301100'; elements.date.value = '2026-10-24';
  elements.customerStep.fields = [elements.custSearch, elements.date, elements.details];
  const row = new Element();
  row.selectors = Object.fromEntries(['.l-part', '.l-desc', '.l-grams', '.l-price', '.l-exchange', '.l-total', '.l-discount'].map(key => [key, new Element()]));
  for (const [key, value] of Object.entries({'.l-part':'14', '.l-grams':'2', '.l-price':'80', '.l-exchange':'3.1'})) row.selectors[key].value = value;
  row.selectors['.l-desc'].textContent = 'Demo gold'; row.selectors['.l-total'].textContent = '496.00 ₪';
  elements.productsStep.fields = Object.values(row.selectors);
  elements.lines.tBodies = [{ rows: [row] }];
  const buttons = [0, 1, 2, 3].map(index => Object.assign(new Element(), { dataset: {step:String(index)} }));
  let customerLoads = 0;
  const context = {
    window:{scrollTo(){}},
    document: {getElementById:id => elements[id], querySelectorAll:() => buttons, createElement:() => new Element()},
    loadCustDetails() { customerLoads++; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/invoice-flow.js'), 'utf8'), context);
  return { elements, panels, row, buttons, complete:() => vm.runInNewContext('completeSignatureFlow("IN-TEST-DOR")',context), sign:() => vm.runInNewContext('showSignatureFlow("IN-TEST-DOR")', context), reset:() => vm.runInNewContext('resetInvoiceFlow()', context), get customerLoads() { return customerLoads; } };
}

test('flow validates each stage, preserves entries and builds the review before issuance', () => {
  const ui = flow(), e = ui.elements;
  e.nextStep.fire('click');
  assert.equal(ui.panels[1].hidden, false);
  e.nextStep.fire('click');
  assert.equal(ui.panels[2].hidden, false);
  assert.equal(e.reviewCustomer.textContent, 'דור עזריאל - יועץ');
  assert.equal(e.reviewDate.textContent, '24.10.2026');
  assert.equal(e.reviewLines.children[0].children[1].textContent, '496.00 ₪');
  e.previousStep.fire('click'); e.previousStep.fire('click');
  assert.equal(e.custSearch.value, 'דור עזריאל - יועץ');
  assert.equal(ui.row.selectors['.l-grams'].value, '2');
});

test('verified signature completion returns to the first page with thanks and clears customer selection',()=>{
  const ui=flow();ui.sign();ui.complete();
  assert.equal(ui.elements.invoiceScreen.hidden,true);
  assert.equal(ui.elements.typePicker.hidden,false);
  assert.equal(ui.elements.completionNotice.hidden,false);
  assert.match(ui.elements.completionDetails.textContent,/IN-TEST-DOR/);
  assert.equal(ui.elements.custname.value,'');
  assert.equal(ui.elements.completionTitle.focused,true);
});

test('signature is the fourth step and cannot reissue or edit an invoice already created', () => {
  const ui=flow(),e=ui.elements;
  ui.buttons[3].fire('click');
  assert.equal(ui.panels[3].hidden,true);
  ui.sign();
  assert.equal(ui.panels[3].hidden,false);
  assert.equal(e.stepCount.textContent,'שלב 4 מתוך 4');
  assert.equal(e.nextStep.hidden,true);
  assert.equal(e.previousStep.hidden,true);
  assert.equal(e.changeType.disabled,true);
  ui.buttons[0].fire('click');
  assert.equal(ui.panels[3].hidden,false);
  let prevented=false;
  e.form.fire('keydown',{key:'Enter',target:{tagName:'INPUT'},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  ui.reset();
  assert.equal(ui.panels[0].hidden,false);
  assert.equal(e.changeType.disabled,false);
  assert.equal(ui.buttons[3].disabled,true);
});

test('jumping to review cannot skip invalid customers or missing product prices', () => {
  const ui = flow(), e = ui.elements;
  e.custname.value = '';
  ui.buttons[2].fire('click');
  assert.equal(ui.panels[0].hidden, false);
  assert.equal(e.stepStatus.hidden, false);
  e.custSearch.value = '301100';
  e.nextStep.fire('click');
  assert.equal(e.custname.value, '301100');
  assert.equal(ui.customerLoads, 1);
  ui.row.selectors['.l-price'].value = '';
  ui.buttons[2].fire('click');
  assert.equal(ui.panels[1].hidden, false);
  assert.equal(ui.panels[2].hidden, true);
});

test('native invalid events reveal hidden fields and open their optional settings', () => {
  const ui = flow(), e = ui.elements;
  e.nextStep.fire('click');
  const details = {tagName:'DETAILS', parentElement:e.form, open:false};
  e.date.parentElement = details;
  e.form.fire('invalid', {target:e.date});
  assert.equal(ui.panels[0].hidden, false);
  assert.equal(details.open, true);
});

test('early submit advances without issuing; handled scanner Enter is preserved', () => {
  const ui = flow(), e = ui.elements;
  let prevented = false, stopped = false;
  e.form.fire('submit', {preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; }});
  assert.equal(prevented, true); assert.equal(stopped, true);
  assert.equal(ui.panels[1].hidden, false);
  e.form.fire('keydown', {key:'Enter', defaultPrevented:true, target:ui.row.selectors['.l-part']});
  assert.equal(ui.panels[1].hidden, false);
  e.nextStep.fire('click');
  prevented = false; stopped = false;
  e.form.fire('submit', {preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; }});
  assert.equal(prevented, false); assert.equal(stopped, false);
  ui.reset();
  assert.equal(ui.panels[0].hidden, false);
  assert.equal(ui.panels[2].hidden, true);
  assert.equal(e.custname.value, '301100');
});
