'use strict';

// Interaction model for reviewing information architecture. All data stays in memory.
// No fetch, local storage, ERP calls, email or financial documents.
const allowedScreens = new Set(['start','customer','products','review','processing','signature','success','invoices','invoice','recovery','customer-missing','customer-error','product-error','rate-error','duplicate','offline','original-error','download-error','mail-uncertain','signature-error']);
const params = new URLSearchParams(location.search);
const initial = allowedScreens.has(params.get('screen')) ? params.get('screen') : 'start';
const catalog = {
  gold: [{code:'14', name:'זהב 14 קראט', unit:'גרם', price:350}, {code:'18', name:'זהב 18 קראט', unit:'גרם', price:440}],
  diamonds: [{code:'D001', name:'יהלום עגול — דוגמה', unit:'יחידה', price:200}, {code:'D002', name:'יהלום אובלי — דוגמה', unit:'יחידה', price:250}],
  lab: [{code:'L001', name:'טבעת בשיבוץ יהלומי מעבדה', unit:'יחידה', price:300}, {code:'L002', name:'עגילי יהלומי מעבדה', unit:'זוג', price:450}],
};
const typeNames = {gold:'זהב',diamonds:'יהלומים',lab:'תכשיטים בשיבוץ יהלומי מעבדה'};
const state = {
  screen: initial, type: initial==='rate-error' ? 'diamonds' : 'gold', selected: initial!=='start',
  name:'תכשיטי דוגמה', customer:'900001', email:'demo@example.com', phone:'0500000000',
  date:'2026-11-16', reference:'', warehouse:'1', book:'', agent:'90', location:'',
  dirty:false, emailEnabled:true, boi:true, rows:[], customerQuery:'', productQuery:'', adding:false,
  error:'', busy:false, filter:'pending', invoiceQuery:'', signer:'', strokes:[], signed:false,
  checkedRecovery:false, recovered:false, originalChecked:false, downloaded:false, mailUncertain:initial==='mail-uncertain', invoiceId:initial==='mail-uncertain'?'DEMO-002':'DEMO-001',
  signatureError:initial==='signature-error', lastScreen:'invoices',
};
function defaultRows(type=state.type){return [{...catalog[type][0],qty:type==='gold'?2:1,discount:0}];}
state.rows=defaultRows();
if(initial==='mail-uncertain'){state.name='לקוח הדגמה נוסף';state.customer='900002';state.email='second@example.com';state.rows[0].price=500;}
if(initial==='customer-missing'){state.email='';state.dirty=true;state.error='יש להשלים מייל לפני המעבר למוצרים.';}
if(initial==='customer-error'){state.dirty=true;state.error='פרטי הלקוח לא נשמרו. הנתונים שהזנתם נשארו כאן.';}
if(initial==='product-error'){state.productQuery='999999';state.adding=true;state.error='לא נמצאה התאמה מדויקת לקוד 999999. בחרו מוצר או תקנו את הקוד.';}
if(initial==='signature-error'){state.signer='ישראל דוגמה';state.strokes=[[[25,95],[60,65],[95,120],[135,70],[185,95],[235,65]]];}
const $ = id => document.getElementById(id);
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => Number.isFinite(n) ? new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'}).format(n) : '—';
const dateText = () => state.date.split('-').reverse().join('.');
const rate = () => state.screen==='rate-error' ? NaN : state.type==='gold' ? 1 : state.boi ? 3.5*1.02 : 3.48;
const lineTotal = row => Number(row.qty)>0&&Number(row.price)>0&&Number(row.discount)>=0&&Number(row.discount)<=100 ? Number(row.qty)*Number(row.price)*(1-Number(row.discount)/100)*rate() : NaN;
function totals(){const before=state.rows.reduce((sum,row)=>sum+lineTotal(row),0);return {before,vat:before*.18,total:before*1.18};}
function button(text,action,cls='',attributes=''){return `<button type="button" class="${cls}" data-action="${action}" ${attributes}>${text}</button>`;}
function field(label,key,type='text',attributes='',value=state[key]){return `<div class="field"><label for="f-${key}">${label}</label><input id="f-${key}" name="${key}" type="${type}" value="${escape(value)}" ${attributes}></div>`;}
function heading(title,description='',eyebrow=''){return `<div class="page-title">${eyebrow?`<span class="eyebrow">${eyebrow}</span>`:''}<h1 id="pageTitle" tabindex="-1">${title}</h1>${description?`<p>${description}</p>`:''}</div>`;}
function stepper(step){return `<nav class="stepper" aria-label="שלבי החשבונית">${['לקוח','מוצרים','בדיקה','חתימה'].map((name,i)=>`<button type="button" data-action="step" data-step="${i}" ${step===i?'aria-current="step"':''} ${i>step||step===3&&i<3?'disabled':''}><span>${i+1}</span>${name}</button>`).join('')}</nav>`;}
function totalBlock(extraClass=""){const t=totals();return `<div class="total-block ${extraClass}"><div class="summary-row"><span>לפני מע״מ</span><span class="amount" data-total="before">${money(t.before)}</span></div><div class="summary-row"><span>מע״מ 18%</span><span class="amount" data-total="vat">${money(t.vat)}</span></div><div class="summary-row grand"><span>סה״כ</span><span class="amount" data-total="total">${money(t.total)}</span></div></div>`;}
function summary(){return `<aside class="summary-panel" aria-label="תקציר החשבונית"><h2>החשבונית בקצרה</h2><div><strong>${escape(state.name)}</strong><div class="hint">לקוח <bdi>${escape(state.customer)}</bdi></div></div><div class="summary-row"><span>סוג</span><span>${typeNames[state.type]}</span></div><div class="summary-row"><span>תאריך</span><span>${dateText()}</span></div><div class="summary-row"><span>סוכן / מחסן</span><span><bdi>${escape(state.agent)} / ${escape(state.warehouse)}</bdi></span></div>${totalBlock()}<p class="hint">סכומים לתצוגה מקדימה.<br>הסכום הסופי ייקבע בפריוריטי.</p></aside>`;}
function layout(content,withSummary=true){return `<div class="${withSummary?'layout':''}"><div class="content">${content}</div>${withSummary?summary():''}</div>`;}
function footer(primary,action,{back='',meta='',amount='',disabled=false}={}){return `<footer class="flow-footer"><div class="footer-inner"><div class="footer-meta"><span>${meta}</span>${amount?`<span>${amount}</span>`:''}</div><div class="footer-buttons">${back?button('חזרה',back,'back'):''}${button(primary,action,'primary',disabled?'disabled':'')}</div></div></footer>`;}
function errorBox(title,text,action='',actionText=''){return `<div class="error-box" role="alert"><strong>${title}</strong>${text?`<p>${text}</p>`:''}${action?button(actionText,action):''}</div>`;}
function statusList(items){return `<ul class="status-list">${items.map(([status,title,note])=>`<li ${status==='ממתין'||status==='לא ודאי'?'data-pending':''}><span class="status-word">${status}</span><div><strong>${title}</strong>${note?`<small>${note}</small>`:''}</div></li>`).join('')}</ul>`;}
function screenStart(){return heading('מה עושים עכשיו?','פותחים חשבונית או חוזרים להשלמת חשבונית קיימת.')+`<div class="layout start-layout"><section><h2>חשבונית חדשה</h2><div class="choice-list" style="margin-top:16px">${Object.entries(typeNames).map(([key,name])=>button(`<span><strong>${name}</strong><small>${key==='gold'?'מחיר בש״ח לגרם':'מחיר דולר ממחירון הבסיס'}</small></span><span aria-hidden="true">←</span>`,'new-type','type-choice',`data-type="${key}"`)).join('')}</div></section><section class="incomplete"><h2>נותר להשלים</h2><p>חשבונית אחת ממתינה לחתימה.<br>בקשת מייל אחת בבדיקה.</p>${button('לחשבוניות שלי','invoices','primary')}<p class="hint">המשך טיפול באותה חשבונית.</p></section></div>`;}
function screenCustomer(){
  const selected=state.selected;
  const search=selected?'':`<div class="field"><label for="customerSearch">חיפוש לקוח</label><input id="customerSearch" name="customerQuery" value="${escape(state.customerQuery)}" placeholder="שם או מספר לקוח" autocomplete="off" aria-controls="customerResults"></div><div id="customerResults" class="customer-results" ${!state.customerQuery?'hidden':''}>${customerMatches()}</div>`;
  const card=selected?`<div class="customer-card"><div class="section-heading"><strong>${escape(state.name)}</strong>${button('החלפה','replace-customer','link-button')}</div><span>מספר לקוח <bdi>${escape(state.customer)}</bdi> · פרטי חברה מלאים</span></div>`:'';
  const contact=selected?`<form id="customerForm"><div class="fields">${field('מייל לקבלת חשבוניות','email','email','required maxlength="68" autocomplete="off" aria-describedby="emailHint"')}${state.screen==='customer-missing'?'<p class="field-error" id="emailHint">המייל נדרש גם אם לא נבחר משלוח.</p>':'<p id="emailHint" class="hint">נשמר בכרטיס הלקוח. בחירת משלוח לחשבונית זו תופיע במסך הבדיקה.</p>'}${field('טלפון של הלקוח','phone','tel','maxlength="64" autocomplete="off"')}</div></form><p class="hint" id="saveHint">${state.dirty?'השינויים בפרטי הקשר יישמרו בכרטיס הלקוח בפריוריטי.':'הלקוח מוגדר לקבלת מסמך ממוחשב. אין שינוי בפרטי הקשר.'}</p><details><summary>פרטי חברה ומוכנות להפקה</summary><div class="summary-row"><span>מספר חברה / תיק מע״מ</span><bdi>000000000</bdi></div><p class="hint">נתון פיקטיבי לתכנון. במוצר תידרש בדיקה מול כרטיס הלקוח.</p></details>`:'';
  const extra=`<details><summary>תאריך ופרטי חשבונית נוספים</summary><div class="fields two">${field('תאריך חשבונית','date','date','required')}${field('מזהה הזמנה','reference','text','maxlength="24"')}${field('סוכן','agent','text','readonly')}${field('מחסן שולח','warehouse','text','maxlength="4"')}${field('איתור','location')}${field('חשבונית פנקס','book')}</div><p class="hint">מזהה הזמנה מאפשר לבדוק אם כבר קיימת חשבונית. אינו חובה.</p></details>`;
  const err=state.error?errorBox('נדרש טיפול בפרטי הלקוח',escape(state.error)):'';
  return stepper(0)+heading('למי החשבונית?','בוחרים לקוח ומאמתים את פרטי הקשר.',`חשבונית ${typeNames[state.type]}`)+layout(search+card+err+contact+extra)+footer(state.dirty?'שמירה והמשך למוצרים':'המשך למוצרים','customer-next',{back:'start',meta:'שלב 1 מתוך 4',disabled:!selected});
}
function customerMatches(){const q=state.customerQuery.trim();if(!q)return '';return ['900001','תכשיטי דוגמה'].some(x=>x.includes(q))?button('<span>תכשיטי דוגמה</span><bdi>900001</bdi>','choose-customer'):'<p style="padding:12px" class="hint">לא נמצא לקוח. נסו שם או מספר אחר.</p>';}
function productMatches(){const q=state.productQuery.trim();const matches=catalog[state.type].filter(p=>!q||p.code.includes(q)||p.name.includes(q));return matches.length?matches.map(p=>button(`<span>${p.name}</span><bdi>${p.code}</bdi>`,'add-match','',`data-code="${p.code}"`)).join(''):'<p class="hint" style="padding:12px">אין התאמה. תקנו את הקוד או חפשו לפי שם.</p>';}
function screenProducts(){
  const gold=state.type==='gold';
  const err=state.error?errorBox('המוצר עדיין לא נוסף',escape(state.error)):'';
  const rateError=state.screen==='rate-error'?errorBox('שער הדולר לא נטען','לא ניתן להמשיך להפקה בלי שער תקין למקור ולתאריך שנבחרו.','retry-rate','ניסיון טעינת שער') : '';
  const rows=state.rows.length?state.rows.map((row,index)=>`<section class="line-item" aria-label="מוצר ${index+1}"><div class="item-name"><div><strong>${escape(row.name)}</strong><small>מק״ט <bdi>${escape(row.code)}</bdi></small></div>${button('הסרה','remove-line','',`data-index="${index}" aria-label="הסרת ${escape(row.name)}"`)}</div><div class="fields product-fields"><div class="field"><label for="qty-${index}">כמות (${row.unit})</label><input id="qty-${index}" data-row="${index}" data-key="qty" type="number" inputmode="decimal" min="0.001" step="0.001" required value="${row.qty}"></div><div class="field"><label for="price-${index}">${gold?'מחיר בש״ח לגרם':'מחיר בדולר'}</label><input id="price-${index}" data-row="${index}" data-key="price" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${row.price}" ${gold?'':'readonly'}></div><div class="field"><label for="discount-${index}">הנחה (%)</label><input id="discount-${index}" aria-label="הנחה לשורה באחוזים — ${escape(row.name)}" data-row="${index}" data-key="discount" type="number" inputmode="decimal" min="0" max="100" step="0.01" required value="${row.discount}"></div></div><div class="line-total"><span>לפני מע״מ, אחרי הנחה</span><strong class="amount" id="line-total-${index}">${money(lineTotal(row))}</strong></div></section>`).join(''):'<div class="empty-state"><h2>עדיין אין מוצרים</h2><p>חפשו מוצר כדי להתחיל.</p></div>';
  const search=`<div ${state.adding?'':'hidden'} id="productSearchBlock"><div class="field"><label for="productSearch">מק״ט, ברקוד או שם מוצר</label><input id="productSearch" name="productQuery" value="${escape(state.productQuery)}" autocomplete="off" aria-controls="productResults" placeholder="למשל: ${gold?'14':state.type==='diamonds'?'D001':'L001'}"></div><div id="productResults" class="customer-results" style="margin-top:8px">${productMatches()}</div></div>`;
  const source=gold?'<p class="hint">המחיר מוזן בש״ח לגרם, לפני מע״מ והנחה.</p>':`<section class="section"><h2>מחיר ושער</h2><p class="hint">מחיר ממחירון הבסיס בפריוריטי · נעול לעריכה.</p><p class="hint" id="rateDescription">${state.screen==='rate-error'?'השער לא זמין':rateDescription()}</p><details><summary>שינוי מקור השער</summary><label class="check"><input type="checkbox" name="boi" ${state.boi?'checked':''}><span>שער בנק ישראל בתוספת 2%<small>ללא סימון: שער פריוריטי.</small></span></label></details></section>`;
  return stepper(1)+heading('מה מוסיפים לחשבונית?',gold?'בחרו מוצר, כמות ומחיר לגרם.':'בחרו מוצר והזינו כמות. המחיר והשער מתמלאים.',`חשבונית ${typeNames[state.type]}`)+layout(err+rateError+`<form id="productsForm">${rows}</form>`+button('הוספת מוצר','add-product','add-product')+search+source)+footer('המשך לבדיקה','products-next',{back:'customer',meta:`שלב 2 מתוך 4 · ${state.rows.length===1?"שורה אחת":state.rows.length+" שורות"}`,amount:`לפני מע״מ: <b class="amount" data-total="before">${money(totals().before)}</b>`,disabled:state.screen==='rate-error'});
}
function rateDescription(){return `${state.boi?'בנק ישראל בתוספת 2%':'פריוריטי'} · שער ${rate().toFixed(4)} ש״ח · ${dateText()}${state.boi?' · בסיס הדגמה 3.50':''}`;}
function reviewItems(){return state.rows.map(row=>`<div class="review-item"><div><strong>${escape(row.name)}</strong><small>${row.qty} ${row.unit} × ${row.price} ${state.type==='gold'?'₪':'$'}${row.discount?` · הנחה ${row.discount}%`:''}</small></div><strong class="amount">${money(lineTotal(row))}</strong></div>`).join('');}
function screenReview(){return stepper(2)+heading('בודקים לפני ההפקה','ודאו שהלקוח, המוצרים והנמען נכונים.')+layout(`<section class="section"><div class="section-heading"><h2>${escape(state.name)}</h2>${button('עריכה','customer','link-button')}</div><p class="hint">לקוח <bdi>${escape(state.customer)}</bdi> · ${dateText()}<br>חשבונית ${typeNames[state.type]} · סוכן ${escape(state.agent)} · מחסן ${escape(state.warehouse||'ברירת מחדל')}${state.location?` · איתור ${escape(state.location)}`:''}${state.book?`<br>פנקס: ${escape(state.book)}`:''}${state.reference?`<br>מזהה הזמנה: ${escape(state.reference)}`:''}</p></section><section class="section"><div class="section-heading"><h2>מוצרים</h2>${button('עריכה','products','link-button')}</div>${reviewItems()}${state.type!=='gold'?`<p class="hint">${rateDescription()}</p>`:''}</section>${totalBlock("review-total")}<section class="section"><h2>איך הלקוח מקבל את המקור?</h2><p class="hint">המקור יישמר בפריוריטי ותתבקש הורדה למכשיר.</p><label class="check"><input type="checkbox" name="emailEnabled" aria-label="שליחת המקור גם למייל" aria-describedby="recipient" ${state.emailEnabled?'checked':''}><span><strong>שליחת המקור גם למייל</strong><small id="recipient">${state.emailEnabled?`אל <bdi>${escape(state.email)}</bdi>`:'לא יתבקש משלוח מייל.'}</small></span></label>${button('עריכת פרטי קשר','customer','link-button')}<p class="hint" id="deliveryHint">${deliveryHint()}</p></section><p class="hint">בלחיצה תיווצר ותיסגר חשבונית סופית. לאחר מכן ייפתח העתק לחתימה. הסכומים כאן הם תצוגה מקדימה.</p>`)+footer(issueLabel(),'issue',{back:'products',meta:'שלב 3 מתוך 4 · אישור הפקה'});}
function deliveryHint(){return state.emailEnabled?'לאחר ההפקה יישלח אותו מקור לנמען שמופיע כאן, ותתבקש גם הורדה למכשיר.':'לאחר ההפקה תתבקש הורדת המקור בלבד, ללא מייל.';}
function issueLabel(){return state.emailEnabled?'הפקת חשבונית ושליחת מקור':'הפקת חשבונית והורדת מקור';}
function screenProcessing(){return heading('מפיקים את החשבונית','הפעולה מתבצעת. אין צורך להתחיל מחדש.')+layout(statusList([['אומת','נוצרה טיוטה','DEMO-T001'],['בתהליך','סגירה לחשבונית סופית','ממתינים לאישור פריוריטי'],['ממתין','הכנת המקור','שמירה והורדה של אותו מסמך'],['ממתין','פתיחת העתק לחתימה','הלקוח יוכל לעיין ולחתום']])+`<p class="hint">בדיקת מצב תברר את התוצאה של אותו ניסיון.</p>`)+footer('בדיקת מצב ההפקה','check-processing',{meta:'ניסיון הפקה קיים · ללא הפקה נוספת'});}
function documentPreview(){return `<section class="document" aria-label="העתק להמחשת מיקום המידע"><div class="document-title"><strong>העתק חשבונית <bdi>${escape(state.invoiceId)}</bdi></strong><span class="small">מסמך דמה להמחשת העיון לפני חתימה</span></div><div class="summary-row"><span>${escape(state.name)}</span><span>${dateText()}</span></div><table class="document-table"><thead><tr><th>מוצר</th><th>כמות</th><th>סכום</th></tr></thead><tbody>${state.rows.map(row=>`<tr><td>${escape(row.name)}</td><td>${row.qty} ${row.unit}</td><td><span class="amount">${money(lineTotal(row))}</span></td></tr>`).join('')}</tbody></table><div class="summary-row"><strong>סה״כ כולל מע״מ</strong><strong class="amount">${money(totals().total)}</strong></div><p class="document-note">במוצר יוצג כאן העתק ה־PDF של החשבונית. זו המחשה מבנית בלבד, ללא מסמך כספי.</p></section>`;}
function screenSignature(){return stepper(3)+heading('עיון וחתימת לקוח',`חשבונית ${escape(state.invoiceId)} · ההעתק החתום יישמר עם החשבונית.`)+`<div class="signing-workspace"><div><details class="document-details" open><summary>עיון בהעתק החשבונית</summary>${documentPreview()}${button('המשך לשם ולחתימה','finish-reading','document-next')}</details></div><section class="sign-form" aria-label="פרטי החתימה">${state.signatureError?errorBox('שמירת החתימה לא אומתה','השם והציור נשארו כאן. יש לבדוק את המצב לפני ניסיון נוסף.'):''}${field('שם החותם','signer','text','maxlength="80" autocomplete="off"')}<div><div class="canvas-heading"><span class="field-label">חתימת דמה על המסך</span>${button('ניקוי','clear-signature','link-button')}</div><canvas id="signature" aria-label="אזור לציור חתימת דמה" width="640" height="440" tabindex="0"></canvas><p class="hint">אפשר לצייר באצבע, בעט או בעכבר.</p></div><p class="hint" id="signatureHint">הזינו שם וחתמו כדי לאפשר שמירה.</p>${button('חזרה לרשימת החשבוניות','exit-signature','link-button')}</section></div>`+footer(state.signatureError?'בדיקת מצב שמירת החתימה':'שמירת חתימה וסיום',state.signatureError?'check-signature':'save-signature',{meta:'שלב 4 מתוך 4 · חתימה על העתק',disabled:!state.signatureError&&(!state.signer.trim()||state.strokes.length===0)});}
function screenSuccess(){return heading('החתימה נשמרה','כל שלב מוצג לפי התוצאה שלו.','סיום החשבונית')+layout(`<div class="success-heading"><span class="big-number" dir="ltr">${escape(state.invoiceId)}</span><strong>${escape(state.name)}</strong><p class="hint">${dateText()} · <span class="amount">${money(totals().total)}</span></p></div>${statusList([['אומת','החשבונית סופית','מספר החשבונית נשמר'],['זמין','מקור החשבונית','נשמר כקובץ עם החשבונית'],['התבקש','הורדה למכשיר','אפשר להוריד שוב את אותו מקור'],[state.mailUncertain?'לא ודאי':state.emailEnabled?'התקבל':'לא נבחר','משלוח במייל',state.mailUncertain?'תוצאת בקשת השליחה טרם אומתה. אין לשלוח שוב אוטומטית.':state.emailEnabled?`בקשת השליחה אל ${escape(state.email)} התקבלה. אין בכך אישור מסירה.`:'לא התבקש מייל לחשבונית זו'],['אומת','העתק חתום','שמירת ההעתק החתום אושרה בהדגמה']])}<div class="action-list">${button('עיון בהעתק החתום','view-signed')}${button('הורדת המקור הקיים','download')}</div>`)+footer('חשבונית חדשה','fresh',{meta:state.mailUncertain?'החתימה נשמרה · המייל עדיין בבדיקה':'הושלם · אפשר להמשיך ללקוח הבא'});}
const invoices=[{id:'DEMO-001',name:'תכשיטי דוגמה',status:'ממתינה לחתימה',total:826,kind:'signature',action:'המשך לחתימה',date:'16.11.2026'}, {id:'DEMO-002',customer:'900002',email:'second@example.com',name:'לקוח הדגמה נוסף',status:'מייל בבדיקה',total:1180,kind:'mail-uncertain',action:'בדיקת מצב המייל',date:'16.11.2026'}, {id:'DEMO-003',name:'תכשיטי דוגמה',status:'הושלמה',total:590,kind:'invoice',action:'פתיחת החשבונית',date:'15.11.2026'}];
function invoiceResults(){const q=state.invoiceQuery.trim().toLowerCase();const rows=invoices.filter(row=>(state.filter!=='pending'||row.status!=='הושלמה')&&(!q||row.id.toLowerCase().includes(q)||row.name.includes(q)));return rows.length?rows.map(row=>`<article class="invoice-card"><div class="invoice-header"><div><strong><bdi>${row.id}</bdi></strong><div class="hint">${row.date}</div></div><strong class="amount">${money(row.total)}</strong></div><p>${row.name}</p><span class="status-tag">${row.status}</span><div class="invoice-statuses"><span>חשבונית סופית</span><span>מקור זמין</span></div>${button(row.action,'open-existing','primary',`data-target="${row.kind}" data-id="${row.id}"`)}</article>`).join(''):'<div class="empty-state"><h2>אין חשבוניות מתאימות</h2><p>נסו מספר אחר או עברו לכל החשבוניות.</p></div>';}
function screenInvoices(){return heading('החשבוניות שלי','סוכן 90 · ממשיכים מאותה חשבונית.')+`<div class="tabs" role="group" aria-label="סינון חשבוניות">${['pending','all'].map(value=>button(value==='pending'?'ממתינות להשלמה':'כל החשבוניות','filter','',`data-filter="${value}" aria-pressed="${state.filter===value}"`)).join('')}</div><div class="field" style="margin-bottom:24px"><label for="invoiceSearch">חיפוש מספר חשבונית או לקוח</label><input id="invoiceSearch" name="invoiceQuery" value="${escape(state.invoiceQuery)}" placeholder="למשל: DEMO-001" aria-controls="invoiceResults"></div><div class="invoice-grid" id="invoiceResults">${invoiceResults()}</div>`+footer('חשבונית חדשה','fresh',{meta:'הנתונים ברשימה הם להדגמה בלבד'});}
function screenInvoice(){return `<a class="top-link" href="#invoices" data-screen="invoices">חזרה לחשבוניות שלי</a>`+heading(`חשבונית ${escape(state.invoiceId)}`,escape(state.name))+layout(statusList([['אומת','החשבונית סופית',`תאריך ${dateText()} · ${money(totals().total)}`],['זמין','מקור החשבונית','אותו קובץ שמור, ללא הפקה נוספת'],[state.emailEnabled?'התקבל':'לא נבחר','בקשת המייל',state.emailEnabled?`אל ${escape(state.email)} · מסירה לא אומתה`:'לא נבחר משלוח'],[state.signed?'אומת':'ממתין','חתימת הלקוח',state.signed?'העתק חתום נשמר בהדגמה':'החתימה עדיין לא נשמרה']])+`<div class="action-list">${button('הורדת מקור קיים','download')}${button('עיון בהעתק','view-copy')}</div>`)+footer(state.signed?'עיון בהעתק החתום':'השלמת חתימת הלקוח',state.signed?'view-signed':'signature',{back:'invoices',meta:'פעולה על החשבונית הקיימת'});}
function screenRecovery(){const verified=state.checkedRecovery;return `<a class="top-link" href="#invoices" data-screen="invoices">חזרה לחשבוניות שלי</a>`+heading(verified?'הטיוטה נמצאה ואפשר להמשיך':'הסגירה עדיין לא אומתה','החשבונית כבר נוצרה. אין צורך להפיק שוב.')+layout(errorBox(verified?'הטיוטה DEMO-T001 עדיין פתוחה':'התקבל מספר טיוטה DEMO-T001',verified?'בדיקת הדמה אימתה שלא נסגרה. ניתן להמשיך בסגירת אותה טיוטה.':'בודקים אם הסגירה הושלמה לפני שמציעים פעולה נוספת.')+statusList([['אומת','יצירת הטיוטה','DEMO-T001'],[verified?'פתוחה':'לא ודאי','סגירה לסופית',verified?'הטיוטה לא נסגרה':'התוצאה טרם התקבלה'],['ממתין','מקור וחתימה','יוכנו אחרי הסגירה']]))+footer(verified?'המשך סגירת אותה טיוטה':'בדיקת מצב הטיוטה',verified?'resume-draft':'check-recovery',{meta:'אותה טיוטה · אותו ניסיון הפקה'});}
function screenOffline(){return heading('אין חיבור לפריוריטי','הפרטים שהזנתם נשארו כאן.')+layout(errorBox('הפעולה עוד לא התחילה','נדרש חיבור לפני שמירה או הפקה. לאחר החיבור תוכלו להמשיך מאותו שלב.')+`<div class="customer-card"><strong>${escape(state.name)}</strong><span>חשבונית ${typeNames[state.type]} · ${state.rows.length===1?"שורה אחת":state.rows.length+" שורות"}</span></div>`)+footer('בדיקת חיבור מחדש','reconnect',{meta:'שומרים את ההקשר הנוכחי'});}
function screenDuplicate(){return stepper(2)+heading('נמצאה חשבונית עם אותו מזהה','כדאי לבדוק את החשבונית הקיימת לפני הפקה נוספת.')+layout(errorBox('מזהה הזמנה: DEMO-ORDER','החשבונית שנמצאה כבר סופית. שינוי המזהה אינו פותר את הבדיקה אם זו אותה עסקה.')+`<div class="customer-card"><strong>DEMO-001</strong><span>${escape(state.name)} · ${dateText()}</span><span class="amount">${money(totals().total)}</span></div>`)+footer('פתיחת החשבונית הקיימת','invoice',{back:'review',meta:'לא נוצרה חשבונית נוספת'});}
function screenOriginalError(){return heading(state.originalChecked?'המקור הקיים נמצא':'החשבונית סופית; המקור בבדיקה','חשבונית DEMO-001 · ממשיכים באותו מסמך.')+layout(statusList([['אומת','החשבונית סופית','היצירה והסגירה הושלמו'],[state.originalChecked?'זמין':'לא ודאי','מקור החשבונית',state.originalChecked?'נמצא קובץ שמור בנספחים':'בודקים אם כבר נשמר בנספחים'],['ממתין','הורדה ומשלוח','לא מפיקים מקור נוסף במצב לא ודאי']])+errorBox('אין להפיק חשבונית חדשה','בדיקת המקור הקיים מאפשרת להמשיך בלי לשחזר הפקה.'))+footer(state.originalChecked?'הורדת המקור והמשך לחתימה':'בדיקת המקור הקיים',state.originalChecked?'download-continue':'check-original',{meta:'החשבונית כבר קיימת'});}
function screenDownloadError(){return heading('המקור מוכן להורדה','הדפדפן לא אישר את ההורדה האוטומטית.')+layout(statusList([['אומת','החשבונית סופית',escape(state.invoiceId)],['זמין','מקור החשבונית','הקובץ נשמר עם החשבונית'],[state.downloaded?'התבקש':'ממתין','הורדה למכשיר',state.downloaded?'התבקשה הורדה חוזרת בהדגמה':'אפשר להוריד שוב את אותו קובץ']])+button('הורדה חוזרת של המקור','download','primary')+`<p class="hint">אפשר להמשיך לחתימה גם אם ההורדה לא הושלמה. הורדה חוזרת אינה מפיקה מקור נוסף.</p>`)+footer('המשך לחתימת הלקוח','signature',{meta:'אותה חשבונית · אותו מקור'});}
function screenMailUncertain(){return `<a class="top-link" href="#invoices" data-screen="invoices">חזרה לחשבוניות שלי</a>`+heading('החשבונית הופקה; המייל בבדיקה','אין צורך להפיק שוב או לשלוח שוב אוטומטית.')+layout(statusList([['אומת','החשבונית סופית','DEMO-002'],['זמין','מקור החשבונית','נשמר עם החשבונית'],['לא ודאי','בקשת המייל',`אל ${escape(state.email)} · התוצאה טרם אומתה`]])+errorBox('נדרשת בדיקה לפני משלוח נוסף','מטפל מורשה יבדוק את פעולת המשלוח. אפשר להשלים חתימה בנפרד.','mail-check','בדיקת מצב המייל')+button('הורדת המקור הקיים','download'))+footer('המשך לחתימת הלקוח','signature',{meta:'מצב המייל נשמר כלא ודאי'});}

function go(screen,{keepError=false}={}){
  if(!allowedScreens.has(screen))return;
  captureSignature();
  state.screen=screen;
  if(!keepError)state.error='';
  render();
}
function render(){
  const screen=state.screen;
  const customerScreens=['customer','customer-missing','customer-error'];
  const productScreens=['products','product-error','rate-error'];
  let content;
  if(screen==='start')content=screenStart();
  else if(customerScreens.includes(screen))content=screenCustomer();
  else if(productScreens.includes(screen))content=screenProducts();
  else if(screen==='review')content=screenReview();
  else if(screen==='processing')content=screenProcessing();
  else if(['signature','signature-error'].includes(screen))content=screenSignature();
  else if(screen==='success')content=screenSuccess();
  else if(screen==='invoices')content=screenInvoices();
  else if(screen==='invoice')content=screenInvoice();
  else if(screen==='recovery')content=screenRecovery();
  else if(screen==='offline')content=screenOffline();
  else if(screen==='duplicate')content=screenDuplicate();
  else if(screen==='original-error')content=screenOriginalError();
  else if(screen==='download-error')content=screenDownloadError();
  else if(screen==='mail-uncertain')content=screenMailUncertain();
  $('main').classList.toggle('sign-page',['signature','signature-error'].includes(screen));
  $('main').innerHTML=content;
  $('connection').textContent=screen==='offline'?'אין חיבור להדגמה':'מחובר להדגמה';
  if($('signature'))initSignature();

  document.getElementById('pageTitle')?.focus({preventScroll:true});
  window.scrollTo(0,0);
  if(parent!==window)parent.postMessage({type:'wireframe-screen',screen},location.origin);
}
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function updateTotals(){const t=totals();for(const key of ['before','vat','total'])document.querySelectorAll(`[data-total="${key}"]`).forEach(el=>el.textContent=money(t[key]));state.rows.forEach((row,i)=>{const el=$('line-total-'+i);if(el)el.textContent=money(lineTotal(row));});}
function updateSignButton(){const b=document.querySelector('[data-action="save-signature"]');if(b)b.disabled=!state.signer.trim()||state.strokes.length===0;const hint=$('signatureHint');if(hint)hint.textContent=state.signer.trim()&&state.strokes.length?'השם והחתימה מוכנים לשמירה.':'הזינו שם וחתמו כדי לאפשר שמירה.';}
function captureSignature(){} // Strokes are updated during pointer input, without serializing personal data.
function initSignature(){
  const canvas=$('signature'),ctx=canvas.getContext('2d');
  const draw=()=>{ctx.clearRect(0,0,640,440);ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#222';for(const stroke of state.strokes){if(stroke.length<2)continue;ctx.beginPath();stroke.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}};
  const position=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*640/r.width,(e.clientY-r.top)*440/r.height];};
  let stroke=null;
  canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);stroke=[position(e)];e.preventDefault();});
  canvas.addEventListener('pointermove',e=>{if(!stroke)return;stroke.push(position(e));draw();ctx.beginPath();stroke.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();});
  const end=()=>{if(stroke?.length>1)state.strokes.push(stroke);stroke=null;draw();updateSignButton();};
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);draw();updateSignButton();
}
document.addEventListener('input',e=>{
  const target=e.target;
  if(target.dataset.row!==undefined){const row=state.rows[Number(target.dataset.row)];row[target.dataset.key]=target.value;updateTotals();return;}
  if(!target.name)return;
  if(target.name==='customerQuery'){state.customerQuery=target.value;$('customerResults').hidden=!target.value;$('customerResults').innerHTML=customerMatches();return;}
  if(target.name==='productQuery'){state.productQuery=target.value;$('productResults').innerHTML=productMatches();return;}
  if(target.name==='invoiceQuery'){state.invoiceQuery=target.value;$('invoiceResults').innerHTML=invoiceResults();return;}
  if(target.type==='checkbox')return;
  state[target.name]=target.value;
  if(['email','phone'].includes(target.name)){state.dirty=true;const b=document.querySelector('[data-action="customer-next"]');if(b)b.textContent='שמירה והמשך למוצרים';if($('saveHint'))$('saveHint').textContent='השינויים בפרטי הקשר יישמרו בכרטיס הלקוח בפריוריטי.';}
  if(target.name==='signer')updateSignButton();
});
document.addEventListener('change',e=>{
  if(e.target.name==='emailEnabled'){state.emailEnabled=e.target.checked;$('recipient').innerHTML=state.emailEnabled?`אל <bdi>${escape(state.email)}</bdi>`:'לא יתבקש משלוח מייל.';$('deliveryHint').textContent=deliveryHint();document.querySelector('[data-action="issue"]').textContent=issueLabel();}
  if(e.target.name==='boi'){state.boi=e.target.checked;if($('rateDescription'))$('rateDescription').textContent=rateDescription();updateTotals();}
});
document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id==='customerForm')customerNext();else if(e.target.id==='productsForm')productsNext();});
function customerNext(){
  if(!state.selected)return;
  const form=$('customerForm');if(!form?.reportValidity())return;
  if(!$('f-date').checkValidity()){$('f-date').closest('details').open=true;$('f-date').reportValidity();return;}
  const saved=state.dirty;state.dirty=false;go('products');if(saved)toast('השינויים נשמרו בהדגמה. לא עודכן כרטיס לקוח אמיתי.');
}
function productsNext(){
  if(!state.rows.length){state.error='יש להוסיף לפחות מוצר אחד.';render();return;}
  if(!$('productsForm').reportValidity())return;
  if(state.screen==='rate-error')return;
  go('review');
}
document.addEventListener('click',e=>{
  const link=e.target.closest('[data-screen]');if(link){e.preventDefault();go(link.dataset.screen);return;}
  const target=e.target.closest('[data-action]');if(!target||target.disabled)return;
  const action=target.dataset.action;
  if(allowedScreens.has(action)){go(action);return;}
  if(action==='new-type'){state.type=target.dataset.type;state.rows=defaultRows();state.selected=false;state.customerQuery='';state.error='';go('customer');}
  else if(action==='fresh'){state.invoiceId='DEMO-001';state.mailUncertain=false;state.selected=false;state.dirty=false;state.strokes=[];state.signer='';state.signed=false;state.emailEnabled=true;state.reference='';state.rows=defaultRows();go('start');}
  else if(action==='choose-customer'){state.name='תכשיטי דוגמה';state.customer='900001';state.email='demo@example.com';state.phone='0500000000';state.selected=true;state.customerQuery='';render();}
  else if(action==='replace-customer'){state.selected=false;state.customerQuery='';render();$('customerSearch').focus();}
  else if(action==='customer-next')customerNext();
  else if(action==='products-next')productsNext();
  else if(action==='step'){const n=Number(target.dataset.step);if(n===0)go('customer');if(n===1&&state.screen==='review')go('products');if(n===1&&['customer','customer-missing','customer-error'].includes(state.screen))customerNext();if(n===2&&['products','product-error'].includes(state.screen))productsNext();}
  else if(action==='add-product'){state.adding=true;state.productQuery='';render();$('productSearch').focus();}
  else if(action==='add-match'){state.rows.push({...catalog[state.type].find(p=>p.code===target.dataset.code),qty:1,discount:0});state.adding=false;state.productQuery='';state.error='';state.screen='products';render();}
  else if(action==='remove-line'){state.rows.splice(Number(target.dataset.index),1);render();}
  else if(action==='retry-rate'){state.screen='products';render();toast('שער ההדגמה נטען מהמקור שנבחר.');}
  else if(action==='issue'){if(state.busy)return;state.busy=true;go(state.reference==='DEMO-ORDER'?'duplicate':'processing');state.busy=false;}
  else if(action==='check-processing'){go('signature');toast('בדיקת הדמה הושלמה: החשבונית סופית והמקור זמין.');}
  else if(action==='finish-reading'){document.querySelector('.document-details').open=false;$('f-signer').focus();}
  else if(action==='clear-signature'){state.strokes=[];render();}
  else if(action==='save-signature'){if(!state.signer.trim()||!state.strokes.length)return;state.signed=true;const existing=invoices.find(row=>row.id===state.invoiceId);if(existing&&!state.mailUncertain){existing.status='הושלמה';existing.kind='invoice';existing.action='פתיחת החשבונית';}go('success');}
  else if(action==='check-signature'){state.signatureError=false;state.screen='signature';render();toast('בבדיקת הדמה לא נמצאה שמירה קודמת; אפשר לשמור שוב את אותה חתימה.');}
  else if(action==='exit-signature')$('exitDialog').showModal();
  else if(action==='stay-signing')$('exitDialog').close();
  else if(action==='leave-signing'){$('exitDialog').close();go('invoice');}
  else if(action==='filter'){state.filter=target.dataset.filter;render();}
  else if(action==='open-existing'){const row=invoices.find(item=>item.id===target.dataset.id);state.invoiceId=row.id;state.name=row.name;state.customer=row.customer||'900001';state.email=row.email||'demo@example.com';state.type='gold';state.rows=[{...catalog.gold[0],qty:2,price:row.total/1.18/2,discount:0}];state.signed=row.status==='הושלמה';state.mailUncertain=row.kind==='mail-uncertain';state.lastScreen='invoices';go(target.dataset.target);}
  else if(action==='check-recovery'){state.checkedRecovery=true;render();}
  else if(action==='resume-draft')go('processing');
  else if(action==='reconnect'){go('customer');toast('החיבור להדגמה חזר. אפשר להמשיך עם אותם פרטים.');}
  else if(action==='check-original'){state.originalChecked=true;render();}
  else if(action==='download-continue'){go('signature');toast('התבקשה הורדה של המקור הקיים בהדגמה.');}
  else if(action==='download'){state.downloaded=true;toast('הדגמה: הורדה של אותו מקור, ללא הפקה או קובץ כספי.');}
  else if(action==='mail-check')toast('ההדגמה משאירה את המייל בבדיקה. לא יתבצע משלוח נוסף.');
  else if(action==='view-copy'){go('signature');document.querySelector('.document-details').open=true;}
  else if(action==='view-signed')toast('הדגמת מיקום לפעולת עיון בהעתק חתום. לא נוצר מסמך חתום אמיתי.');
});
render();
