'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { PNG } = require('pngjs');
function inputError(message){return Object.assign(new Error(message),{status:400});}
function emailAddress(value) {
  const email = String(value || '').trim();
  if (email.length > 68 || !/^[\x21-\x7e]+$/.test(email) || !/^[^\s@<>;,]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(email)) throw inputError('יש להזין כתובת מייל תקינה אחת, עד 68 תווים');
  const [local,domain]=email.split('@');
  if(local.startsWith('.') || local.endsWith('.') || local.includes('..') || /[()\[\]\\:"\s]/.test(local) || domain.split('.').some(label=>!/[a-z0-9]/i.test(label) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw inputError('כתובת המייל אינה תקינה');
  return email;
}
function digitalConsent(body) {
  if (body?.digitalEmail !== true || body?.consent !== true) throw inputError('יש לסמן ״חשבונית דיגיטלית במייל״ ולאשר את כתובת הנמען לפני ההפקה');
  return emailAddress(body.email);
}
function keyFor(base, iv) { return createHash('sha256').update(base + '|' + iv).digest('hex'); }
function workflowStore(directory) {
  const pending = new Map();
  const file = (key, name) => { if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-z-]+$/.test(name)) throw inputError('Invalid workflow key'); return path.join(directory, key + '-' + name); };
  async function read(key, name = 'context') { try { return JSON.parse(await fs.readFile(file(key,name)+'.json','utf8')); } catch(e) { if(e.code==='ENOENT') return null; throw e; } }
  async function write(key, name, data) { await fs.mkdir(directory,{recursive:true}); const target=file(key,name)+'.json'; const tmp=target+'.'+randomUUID(); await fs.writeFile(tmp,JSON.stringify(data),{mode:0o600}); await fs.rename(tmp,target); }
  async function once(key, name, fn) {
    const id=key+'-'+name;
    if(pending.has(id)) return pending.get(id);
    const task=(async()=>{
      const old=await read(key,name);
      if(old?.status==='complete') return old.result;
      if(old) throw inputError('ניסיון קודם של פעולה זו לא אומת. נדרשת בדיקה בפריוריטי; לא יופעל ניסיון משלוח או צירוף נוסף אוטומטית.');
      await fs.mkdir(directory,{recursive:true});
      try { await fs.writeFile(file(key,name)+'.json',JSON.stringify({status:'started',at:new Date().toISOString()}),{flag:'wx',mode:0o600}); } catch(e) { if(e.code==='EEXIST') throw inputError('הפעולה כבר התחילה. יש לבדוק את תוצאתה לפני ניסיון נוסף.'); throw e; }
      try { const result=await fn(); await write(key,name,{status:'complete',at:new Date().toISOString(),result}); return result; }
      catch(e) { await write(key,name,{status:'uncertain',at:new Date().toISOString(),error:e.message}); throw e; }
    })().finally(()=>pending.delete(id));
    pending.set(id,task); return task;
  }
  async function saveFile(key,name,buffer) { await fs.mkdir(directory,{recursive:true}); await fs.writeFile(file(key,name)+'.pdf',buffer,{mode:0o600}); }
  const readFile=(key,name)=>fs.readFile(file(key,name)+'.pdf');
  async function bind(key,fingerprint){await fs.mkdir(directory,{recursive:true});try{await fs.writeFile(file(key,'binding')+'.json',JSON.stringify({fingerprint}),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const existing=await read(key,'binding');if(existing.fingerprint!==fingerprint)throw inputError('ניסיון ההפקה הקודם השתמש בפרטים אחרים. יש לברר את מצבו לפני הפקה חדשה.');}}
  return {read,write,once,saveFile,readFile,bind};
}
function signatureImage(datauri) {
  if(typeof datauri!=='string' || datauri.length>2800000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(datauri)) throw inputError('החתימה חייבת להיות תמונת PNG תקינה');
  const buffer=Buffer.from(datauri.split(',')[1],'base64');
  if(buffer.length<24 || buffer.readUInt32BE(16)>2000 || buffer.readUInt32BE(20)>1000) throw inputError('ממדי החתימה אינם תקינים');
  const image=PNG.sync.read(buffer);
  if(image.width<200 || image.height<80) throw inputError('החתימה קטנה מדי');
  let ink=0;
  for(let i=0;i<image.data.length;i+=4) if(image.data[i+3]>40 && Math.min(image.data[i],image.data[i+1],image.data[i+2])<220) ink++;
  if(ink<30) throw inputError('יש לחתום על המסך לפני השמירה');
  return buffer;
}
async function signedCopy(copy, png, {ivnum,custname,signer,signedAt}) {
  if(!/^IN[0-9]+$/.test(ivnum) || !custname || typeof signer!=='string' || !signer.trim() || signer.length>80 || /[\x00-\x1f]/.test(signer)) throw inputError('חסרים פרטי החותם או החשבונית');
  const doc=await PDFDocument.load(copy);
  const page=doc.addPage([595,300]);
  const font=await doc.embedFont(StandardFonts.Helvetica);
  const digest=createHash('sha256').update(copy).digest('hex');
  page.drawText('Customer signature on invoice copy',{x:35,y:265,size:16,font,color:rgb(.1,.15,.2)});
  for(const [i,text]of ['Invoice: '+ivnum,'Customer: '+String(custname).replace(/[^\x20-\x7e]/g,''),'Signed at: '+signedAt,'Copy SHA-256: '+digest.slice(0,32),digest.slice(32)].entries()) page.drawText(text,{x:35,y:240-i*17,size:10,font});
  const image=await doc.embedPng(png); const scaled=image.scaleToFit(490,115);
  page.drawImage(image,{x:35,y:25,width:scaled.width,height:scaled.height});
  doc.setTitle('Signed copy '+ivnum);doc.setSubject('Customer signature: '+signer.trim());
  return Buffer.from(await doc.save());
}
module.exports={emailAddress,digitalConsent,keyFor,workflowStore,signatureImage,signedCopy};
