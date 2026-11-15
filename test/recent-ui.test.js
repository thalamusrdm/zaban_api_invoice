'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function recentUI(api){
  const nodes=Object.fromEntries(['recentBody','custname','refreshBtn','recentHint','recentCustomer','agent','agentRecentBody','agentRefreshBtn','agentRecentTitle','agentRecentHint'].map(id=>[id,{value:'',textContent:'',innerHTML:'',addEventListener(){}}]));
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const code=html.slice(html.indexOf('let recentRequest = 0;'),html.indexOf("$('refreshBtn').addEventListener('click', loadRecent)"));
  const context={$:id=>nodes[id],custSearch:{value:'דור עזריאל'},api,escapeHtml:value=>String(value).replace(/</g,'&lt;'),fmt:value=>String(value)};
  vm.runInNewContext(code,context);
  return {nodes,load:context.loadRecent,loadAgent:context.loadAgentRecent};
}

test('recent list makes no request until a customer is selected',async()=>{
  let calls=0;const ui=recentUI(async()=>{calls++;});await ui.load();
  assert.equal(calls,0);assert.equal(ui.nodes.refreshBtn.disabled,true);
  assert.match(ui.nodes.recentBody.textContent,/בחרו לקוח/);
});

test('agent list requires a selected agent and rejects stale or other-agent records', async () => {
  const pending = [];
  const ui = recentUI(url => new Promise(resolve => pending.push({ url, resolve })));
  await ui.loadAgent();
  assert.equal(pending.length, 0);
  assert.equal(ui.nodes.agentRefreshBtn.disabled, true);
  ui.nodes.agent.value = '80';
  const first = ui.loadAgent();
  ui.nodes.agent.value = '40';
  const second = ui.loadAgent();
  pending[1].resolve({ value: [
    { AGENTCODE: '40', IVNUM: 'IN40', CUSTNAME: 'TEST', CDES: 'Test customer', TOTPRICE: 120 },
    { AGENTCODE: '80', IVNUM: 'IN80' },
  ] });
  await second;
  pending[0].resolve({ value: [{ AGENTCODE: '80', IVNUM: 'IN80' }] });
  await first;
  assert.equal(pending[1].url, '/api/invoices/recent?agent=40');
  assert.match(ui.nodes.agentRecentBody.innerHTML, /IN40/);
  assert.match(ui.nodes.agentRecentBody.innerHTML, /Test customer/);
  assert.doesNotMatch(ui.nodes.agentRecentBody.innerHTML, /IN80|close-btn/);
  assert.match(ui.nodes.agentRecentTitle.textContent, /40/);
});

test('recent list rejects stale responses and never renders another customer',async()=>{
  const pending=[];const ui=recentUI(url=>new Promise(resolve=>pending.push({url,resolve})));
  ui.nodes.custname.value='301100';const first=ui.load();
  ui.nodes.custname.value='';await ui.load();
  pending[0].resolve({value:[{CUSTNAME:'301100',IVNUM:'IN123'}]});await first;
  assert.equal(ui.nodes.recentBody.innerHTML,'');
  assert.match(ui.nodes.recentBody.textContent,/בחרו לקוח/);
  ui.nodes.custname.value='301100';const second=ui.load();
  pending[1].resolve({value:[{CUSTNAME:'OTHER',IVNUM:'IN-OTHER'},{CUSTNAME:'301100',IVNUM:'IN123',TOTPRICE:10,STATDES:'סופית'}]});await second;
  assert.equal(pending[1].url,'/api/invoices/recent?custname=301100');
  assert.match(ui.nodes.recentBody.innerHTML,/IN123/);
  assert.doesNotMatch(ui.nodes.recentBody.innerHTML,/IN-OTHER/);
  assert.match(ui.nodes.recentBody.innerHTML,/אפשרויות נוספות/);
});
