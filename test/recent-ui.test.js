'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function recentUI(api){
  const nodes=Object.fromEntries(['recentBody','custname','refreshBtn','recentHint','recentCustomer','agent','agentRecentBody','agentRefreshBtn','agentRecentTitle','agentRecentHint','agentLoadMoreBtn','agentMoreStatus','agentDocumentStatus'].map(id=>[id,{value:'',textContent:'',innerHTML:'',addEventListener(){}}]));
  nodes.agentRecentBody.querySelector=()=>({insertAdjacentHTML(position,html){
    assert.equal(position,'beforeend');
    nodes.agentRecentBody.innerHTML=nodes.agentRecentBody.innerHTML.replace('</ol>',html+'</ol>');
  }});
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
  assert.doesNotMatch(ui.nodes.agentRecentBody.innerHTML, /IN80/);
  for (const action of ['signed-copy-btn', 'sign-btn', 'dl-btn', 'resend-btn']) assert.match(ui.nodes.agentRecentBody.innerHTML, new RegExp(action));
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
  assert.match(ui.nodes.recentBody.innerHTML,/resend-btn/);
});

test('agent document controls respect server eligibility and drafts cannot be resent or signed', async () => {
  const ui=recentUI(async()=>({value:[
    {AGENTCODE:'90',IVNUM:'IN123',canManageDocuments:false,STATDES:'סופית'},
    {AGENTCODE:'90',IVNUM:'T123',canManageDocuments:true,STATDES:'טיוטא'},
  ]}));
  ui.nodes.agent.value='90';await ui.loadAgent();
  const [final,draft]=ui.nodes.agentRecentBody.innerHTML.split('</article>');
  assert.match(final,/data-iv="IN123" disabled/);
  assert.match(final,/רק לחשבוניות שבטיפול/);
  assert.match(draft,/סגירה לחשבונית סופית/);
  assert.doesNotMatch(draft,/resend-btn|sign-btn|signed-copy-btn|data-kind="original"/);
});

test('load more appends older invoices, keeps existing controls and hides at the end', async () => {
  const calls=[];
  const ui=recentUI(async url=>{
    calls.push(url);
    return calls.length===1 ? {value:Array.from({length:10},(_,i)=>({AGENTCODE:'90',IVNUM:'IN'+(100-i)})),hasMore:true,nextBefore:'91'}
      : {value:[{AGENTCODE:'90',IVNUM:'IN90'},{AGENTCODE:'90',IVNUM:'IN89'}],hasMore:false,nextBefore:null};
  });
  ui.nodes.agent.value='90';await ui.loadAgent();
  assert.equal(ui.nodes.agentLoadMoreBtn.hidden,false);
  const originalHtml=ui.nodes.agentRecentBody.innerHTML;
  await ui.loadAgent(true);
  assert.equal(calls[1],'/api/invoices/recent?agent=90&before=91');
  assert.ok(ui.nodes.agentRecentBody.innerHTML.startsWith(originalHtml.replace('</ol>','')));
  assert.equal((ui.nodes.agentRecentBody.innerHTML.match(/class="recent-invoice"/g)||[]).length,12);
  assert.match(ui.nodes.agentRecentBody.innerHTML,/recentTitleagent10/);
  assert.equal(ui.nodes.agentLoadMoreBtn.hidden,true);
  assert.match(ui.nodes.agentRecentHint.textContent,/12 חשבוניות/);
  await ui.loadAgent(true);assert.equal(calls.length,2);
});

test('double load-more clicks share one page and failed appends preserve rows and cursor for retry', async () => {
  let page,fail=true;const urls=[];
  const ui=recentUI(url=>{
    urls.push(url);
    if(urls.length===1)return Promise.resolve({value:[{AGENTCODE:'90',IVNUM:'IN100'}],hasMore:true,nextBefore:'100'});
    return new Promise((resolve,reject)=>{page=()=>fail?reject(Error('offline')):resolve({value:[{AGENTCODE:'90',IVNUM:'IN99'}],hasMore:false});});
  });
  ui.nodes.agent.value='90';await ui.loadAgent();const existing=ui.nodes.agentRecentBody.innerHTML;
  const pending=ui.loadAgent(true);await ui.loadAgent(true);
  assert.equal(urls.length,2);assert.equal(ui.nodes.agentLoadMoreBtn.disabled,true);
  page();await pending;
  assert.equal(ui.nodes.agentRecentBody.innerHTML,existing);
  assert.equal(ui.nodes.agentLoadMoreBtn.hidden,false);assert.equal(ui.nodes.agentLoadMoreBtn.disabled,false);
  assert.match(ui.nodes.agentMoreStatus.textContent,/offline/);
  fail=false;const retry=ui.loadAgent(true);page();await retry;
  assert.equal(urls[1],urls[2]);assert.match(ui.nodes.agentRecentBody.innerHTML,/IN99/);
});

test('refresh or agent switch discards an in-flight older page and starts from the latest invoices', async () => {
  let oldPage;const urls=[];
  const ui=recentUI(url=>{
    urls.push(url);
    if(url.includes('before='))return new Promise(resolve=>{oldPage=resolve;});
    const agent=url.split('agent=')[1];
    return Promise.resolve({value:[{AGENTCODE:agent,IVNUM:agent==='90'?'IN100':'IN200'}],hasMore:true,nextBefore:agent==='90'?'100':'200'});
  });
  ui.nodes.agent.value='90';await ui.loadAgent();const pending=ui.loadAgent(true);
  ui.nodes.agent.value='80';await ui.loadAgent();
  oldPage({value:[{AGENTCODE:'90',IVNUM:'IN99'}],hasMore:false});await pending;
  assert.match(ui.nodes.agentRecentBody.innerHTML,/IN200/);assert.doesNotMatch(ui.nodes.agentRecentBody.innerHTML,/IN99|IN100/);
  await ui.loadAgent({type:'click'});assert.equal(urls.at(-1),'/api/invoices/recent?agent=80');
  assert.equal((ui.nodes.agentRecentBody.innerHTML.match(/class="recent-invoice"/g)||[]).length,1);
});

test('overlapping rows are deduplicated and nonadvancing cursors cannot loop', async () => {
  let page=0;const ui=recentUI(async()=>++page===1
    ? {value:[{AGENTCODE:'90',IVNUM:'IN100'}],hasMore:true,nextBefore:'100'}
    : page===2 ? {value:[{AGENTCODE:'90',IVNUM:'IN100'},{AGENTCODE:'OTHER',IVNUM:'IN-OTHER'},{AGENTCODE:'90',IVNUM:'IN99'}],hasMore:true,nextBefore:'99'}
      : {value:[{AGENTCODE:'90',IVNUM:'IN98'}],hasMore:true,nextBefore:'99'});
  ui.nodes.agent.value='90';await ui.loadAgent();await ui.loadAgent(true);
  assert.equal((ui.nodes.agentRecentBody.innerHTML.match(/class="recent-invoice"/g)||[]).length,2);
  assert.doesNotMatch(ui.nodes.agentRecentBody.innerHTML,/IN-OTHER/);
  const existing=ui.nodes.agentRecentBody.innerHTML;await ui.loadAgent(true);
  assert.equal(ui.nodes.agentRecentBody.innerHTML,existing);
  assert.match(ui.nodes.agentMoreStatus.textContent,/מיקום המשך תקין/);
});
