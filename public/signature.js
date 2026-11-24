'use strict';
function digitalCreationId(){let id=sessionStorage.getItem('zabanPendingCreation');if(!id){if(crypto.randomUUID)id=crypto.randomUUID();else {const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20); }sessionStorage.setItem('zabanPendingCreation',id);}return id;}
function completeDigitalCreation(){sessionStorage.removeItem('zabanPendingCreation');}
let signingState=null,signatureLoad=0,signatureDrawing=false,signaturePoints=0;
const emailPending=new Set();
const signatureCanvas=document.getElementById('signatureCanvas');
const signatureContext=signatureCanvas.getContext('2d');
function fitInvoiceSignatureCanvas(){
  const bounds=signatureCanvas.getBoundingClientRect();
  if(bounds.width>0 && bounds.height>0){
    const height=Math.max(1,Math.round(signatureCanvas.width*bounds.height/bounds.width));
    if(signatureCanvas.height!==height)signatureCanvas.height=height;
  }
}
function clearInvoiceSignature(){fitInvoiceSignatureCanvas();signatureContext.fillStyle='white';signatureContext.fillRect(0,0,signatureCanvas.width,signatureCanvas.height);signaturePoints=0;signatureDrawing=false;}
function updateSignatureButton(){
  const state=signingState;
  const pending=state && emailPending.has(state.ivnum);
  const button=document.getElementById('saveSignature');
  button.disabled=!state || state.saving || state.saved || pending;
  button.textContent=state?.saved?'אישור החתימה נשמר':state?.saving?'שומר את האישור…':!state?'ממתינים לטעינת המקור…':'שמירת אישור החתימה בנספחים';
  document.getElementById('clearSignature').disabled=!state || state.saving || state.saved;
  document.getElementById('signatureName').readOnly=Boolean(!state || state.saving || state.saved);
  document.getElementById('signatureConsent').disabled=Boolean(!state || state.saving || state.saved);
  document.getElementById('closeSignature').disabled=Boolean(state?.saving);
  signatureCanvas.setAttribute('aria-disabled',String(!state || state.saving || state.saved));
}
async function openInvoiceForSigning(ivnum){
  const request=++signatureLoad;
  document.getElementById('signatureStatus').removeAttribute('data-state');
  const dialog=document.getElementById('signatureDialog');
  const waitingForCopy=typeof InvoiceProgress!=='undefined' && InvoiceProgress.isOpen();
  if(waitingForCopy)InvoiceProgress.update('signature');
  if(signingState?.url)URL.revokeObjectURL(signingState.url);
  signingState=null;clearInvoiceSignature();updateSignatureButton();
  document.getElementById('signatureName').value='';document.getElementById('signatureConsent').checked=false;document.getElementById('signaturePdf').src='about:blank';
  document.getElementById('signatureCopyLink').removeAttribute('href');
  document.getElementById('signatureTitle').textContent='עיון במקור וחתימה · '+ivnum;
  document.getElementById('signatureStatus').textContent='טוען את מקור החשבונית שנשמר בפריוריטי…';
  if(!waitingForCopy){
    if(typeof showSignatureFlow==='function')showSignatureFlow(ivnum);
    else if(!dialog.open)dialog.showModal();
  }
  try{
    const response=await fetch('/api/invoices/signature-copy?ivnum='+encodeURIComponent(ivnum));
    if(!response.ok){const error=await response.json();throw Error(error.error||'טעינת המקור נכשלה');}
    if(!(response.headers.get('content-type')||'').includes('application/pdf'))throw Error('לא התקבל PDF של מקור החשבונית');
    const token=response.headers.get('X-Signature-Token');if(!token)throw Error('חסר מזהה מקור לחתימה');
    const blob=await response.blob();if(!blob.size)throw Error('התקבל מקור ריק');
    if(request!==signatureLoad)return false;
    const url=URL.createObjectURL(blob);signingState={ivnum,token,url,saving:false};
    document.getElementById('signaturePdf').src=url;document.getElementById('signatureCopyLink').href=url;
    document.getElementById('signatureStatus').textContent='יש לעיין במקור, להזין שם, לאשר ולחתום. אישור החתימה יישמר בנפרד מהמקור.';
    updateSignatureButton();return true;
  }catch(e){if(request===signatureLoad)document.getElementById('signatureStatus').textContent=e.message+' — החשבונית קיימת ואין להפיק אותה שוב.';return false;}
  finally{
    if(waitingForCopy && request===signatureLoad){
      InvoiceProgress.hide();
      if(typeof showSignatureFlow==='function')showSignatureFlow(ivnum);
      else if(!dialog.open)dialog.showModal();
    }
  }
}
async function finishOriginalDownload(data){
  let ready = false;
  if(typeof InvoiceProgress!=='undefined')InvoiceProgress.update('original');
  const notice=document.getElementById('documentMsg');
  notice.className='msg show';notice.textContent='שומר את מקור החשבונית '+data.ivnum+' בנספחים בפריוריטי…';
  try{
    await api('/api/invoices/prepare-original-download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ivnum:data.ivnum})});
    ready = true;
    const readyNotice='המקור של חשבונית '+data.ivnum+' נשמר בפריוריטי. ניתן להוריד אותו בסיום בלחיצה על ״הורדת מקור״.';
    notice.className='msg show ok';notice.textContent=readyNotice;
    if(data.sendOriginalEmail){
      notice.textContent='מעביר את מקור החשבונית '+data.ivnum+' למייל '+data.email+'…';
      try{
        const result=await api('/api/invoices/email-original',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ivnum:data.ivnum,email:data.email})});
        if(!result.acceptedByMailServer)throw Error('שרת הדואר לא אישר את בקשת השליחה');
        notice.className='msg show ok';
        notice.textContent=readyNotice+' שרת הדואר קיבל את המקור לשליחה אל '+result.email+'. זה אינו אישור מסירה לתיבת הלקוח.';
      }catch(e){
        notice.className='msg show warn';
        notice.textContent=readyNotice+' משלוח המקור במייל לא אומת: '+e.message+' אין להפיק חשבונית נוספת.';
      }
    }
  }catch(e){
    notice.className='msg show warn';notice.textContent='החשבונית '+data.ivnum+' סופית, אך הכנת המקור לא אומתה: '+e.message+'. אין להפיק חשבונית נוספת. לא נשלח מייל. ';
    const retry=document.createElement('button');retry.type='button';retry.className='close-btn prepare-original-btn';retry.dataset.iv=data.ivnum;retry.dataset.email=data.email||'';retry.dataset.sendOriginalEmail=String(!!data.sendOriginalEmail);retry.textContent='בדיקת המקור הקיים והמשך לחתימה';notice.appendChild(retry);
  }finally{await openInvoiceForSigning(data.ivnum);}
  return ready;
}
async function finishDigitalInvoice(data){
  const notice=document.getElementById('documentMsg');
  notice.className='msg show';notice.textContent='החשבונית '+data.ivnum+' סופית. מעביר בקשת משלוח מקור למייל '+data.email+'…';
  emailPending.add(data.ivnum);updateSignatureButton();
  try{
    const result=await api('/api/invoices/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ivnum:data.ivnum,email:data.email,digitalEmail:true,consent:true})});
    if(!result.acceptedByPriority)throw Error('פריוריטי לא אישרה את בקשת המשלוח');
    notice.className='msg show ok';notice.textContent='פריוריטי אישרה את בקשת משלוח המקור של '+data.ivnum+' אל '+result.email+'. יש להשלים את אישור חתימת הלקוח. אישור בקשת המשלוח אינו אישור מסירה לתיבת המייל.';
  }catch(e){notice.className='msg show warn';notice.textContent='החשבונית '+data.ivnum+' סופית, אך משלוח המקור לא אומת: '+e.message+'. אין להפיק חשבונית נוספת או לשלוח שוב לפני בדיקה בפריוריטי. אפשר לשמור את אישור החתימה בנפרד.';}
  finally{emailPending.delete(data.ivnum);await openInvoiceForSigning(data.ivnum);updateSignatureButton();}
}
function signaturePosition(event){const r=signatureCanvas.getBoundingClientRect();return {x:(event.clientX-r.left)*signatureCanvas.width/r.width,y:(event.clientY-r.top)*signatureCanvas.height/r.height};}
signatureCanvas.addEventListener('pointerdown',e=>{if(!signingState || signingState.saving || signingState.saved)return;if(signaturePoints===0)clearInvoiceSignature();e.preventDefault();signatureCanvas.setPointerCapture(e.pointerId);const p=signaturePosition(e);signatureContext.beginPath();signatureContext.moveTo(p.x,p.y);signatureContext.strokeStyle='#172033';signatureContext.lineWidth=2.5;signatureContext.lineCap='round';signatureDrawing=true;});
signatureCanvas.addEventListener('pointermove',e=>{if(!signatureDrawing)return;e.preventDefault();const p=signaturePosition(e);signatureContext.lineTo(p.x,p.y);signatureContext.stroke();signaturePoints++;});
for(const event of ['pointerup','pointercancel'])signatureCanvas.addEventListener(event,()=>{signatureDrawing=false;});
document.getElementById('clearSignature').addEventListener('click',()=>{if(!signingState?.saving && !signingState?.saved)clearInvoiceSignature();});
document.getElementById('closeSignature').addEventListener('click',()=>{
  if(signingState?.saving)return;
  if(signingState && !signingState.saved && !confirm('החתימה עדיין לא נשמרה. לעבור לחשבונית נוספת?'))return;
  signatureLoad++;
  if(typeof resetInvoiceFlow==='function'){
    resetInvoiceFlow();
    document.getElementById('msg').className='msg';
    document.getElementById('documentMsg').className='msg';
  }
});
document.getElementById('saveSignature').addEventListener('click',async()=>{
  const state=signingState;if(!state || state.saving || state.saved)return;
  const signer=document.getElementById('signatureName').value.trim();const status=document.getElementById('signatureStatus');
  if(!signer){status.setAttribute('data-state','error');status.textContent='יש להזין את שם החותם';return;}if(signaturePoints<2){status.setAttribute('data-state','error');status.textContent='יש לחתום על המסך לפני השמירה';return;}
  if(!document.getElementById('signatureConsent').checked){status.setAttribute('data-state','error');status.textContent='יש לאשר שהחתימה מתייחסת לחשבונית המוצגת';return;}
  status.removeAttribute('data-state');
  state.saving=true;updateSignatureButton();status.textContent='שומר את אישור החתימה בנספחי החשבונית '+state.ivnum+'…';
  try{
    const result=await api('/api/invoices/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ivnum:state.ivnum,token:state.token,signer,acknowledgement:true,signature:signatureCanvas.toDataURL('image/png')})});
    if(result.attached!==true || result.ivnum!==state.ivnum)throw Error('לא התקבל אישור שמירה לחשבונית המבוקשת');
    if(signingState===state){
      state.saved=true;
      status.textContent='אישור החתימה נשמר ואומת בנספחי חשבונית '+result.ivnum+'. המקור נשמר ללא שינוי.';
      document.getElementById('saveSignature').disabled=true;
      if(typeof completeSignatureFlow==='function')completeSignatureFlow(result.ivnum);
    }
  }catch(e){if(signingState===state){status.setAttribute('data-state','error');status.textContent='שמירת החתימה לא אומתה: '+e.message+'. החתימה נשארה על המסך; אין להפיק חשבונית נוספת.';}}
  finally{state.saving=false;if(signingState===state)updateSignatureButton();}
});
clearInvoiceSignature();
