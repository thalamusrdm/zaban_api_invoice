'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const bidi = require('bidi-js')();
const { signatureFields } = require('./signature-fields');
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
// Fill the name and signature lines already printed on the invoice copy.
async function signedCopy(copy, png, {ivnum,custname,signer,signedAt}) {
  if(!/^IN[0-9]+$/.test(ivnum) || !custname || typeof signer!=='string' || !signer.trim() || signer.length>80 || /[\x00-\x1f\u202a-\u202e\u2066-\u2069]/.test(signer) || !Number.isFinite(Date.parse(signedAt))) throw inputError('חסרים פרטי החותם או החשבונית');
  const fields=await signatureFields(copy);
  const doc=await PDFDocument.load(copy);
  const page=doc.getPage(fields.pageIndex);
  doc.registerFontkit(fontkit);
  const hebrew=await doc.embedFont(await fs.readFile(path.join(__dirname,'public','fonts','NotoSansHebrew-Regular.ttf')),{subset:true});
  const latin=await doc.embedFont(StandardFonts.Helvetica);
  const supportedHebrew=new Set(hebrew.getCharacterSet()),supportedLatin=new Set(latin.getCharacterSet());
  function drawRtl(text,right,y,size,maxWidth) {
    // Unicode BiDi handles numbers and mixed names. Draw visual glyphs individually
    // so fontkit does not reverse an already reordered Hebrew run a second time.
    const visual=bidi.getReorderedString(text,bidi.getEmbeddingLevels(text,'rtl'));
    const glyphs=Array.from(visual).map(char=>{const cp=char.codePointAt(0);const font=supportedHebrew.has(cp)?hebrew:supportedLatin.has(cp)?latin:null;if(!font)throw inputError('שם החותם מכיל תו שאינו נתמך במסמך');return {char,font};});
    const nominal=glyphs.reduce((sum,g)=>sum+g.font.widthOfTextAtSize(g.char,size),0);
    const actual=Math.min(size,nominal>0?size*maxWidth/nominal:size);
    if(actual<7)throw inputError('שם החותם ארוך מדי לשדה שבחשבונית');
    let x=right-glyphs.reduce((sum,g)=>sum+g.font.widthOfTextAtSize(g.char,actual),0);
    for(const g of glyphs){page.drawText(g.char,{x,y,size:actual,font:g.font,color:rgb(.1,.15,.2)});x+=g.font.widthOfTextAtSize(g.char,actual);}
  }
  const name=fields.name,signature=fields.signature;
  drawRtl(signer.trim(),name.x+name.width-3,name.y+3,10,name.width-6);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(signedAt)).map(x=>[x.type,x.value]));
  drawRtl('נחתם בתאריך '+parts.day+'/'+parts.month+'/'+parts.year+' בשעה '+parts.hour+':'+parts.minute+' (שעון ישראל)',name.x+name.width,name.y-24,7.5,name.x+name.width-signature.x);
  // Crop the empty canvas and make its white background transparent so the
  // printed signature line stays visible beneath the handwriting.
  const ink=PNG.sync.read(png);let minX=ink.width,minY=ink.height,maxX=-1,maxY=-1;
  for(let y=0;y<ink.height;y++)for(let x=0;x<ink.width;x++){const i=(y*ink.width+x)*4;if(ink.data[i+3]>40&&Math.min(ink.data[i],ink.data[i+1],ink.data[i+2])<220){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
  if(maxX<minX)throw inputError('יש לחתום על המסך לפני השמירה');
  minX=Math.max(0,minX-2);minY=Math.max(0,minY-2);maxX=Math.min(ink.width-1,maxX+2);maxY=Math.min(ink.height-1,maxY+2);
  const cropped=new PNG({width:maxX-minX+1,height:maxY-minY+1});
  for(let y=0;y<cropped.height;y++)for(let x=0;x<cropped.width;x++){const src=((minY+y)*ink.width+minX+x)*4,dst=(y*cropped.width+x)*4;ink.data.copy(cropped.data,dst,src,src+4);if(Math.min(ink.data[src],ink.data[src+1],ink.data[src+2])>245)cropped.data[dst+3]=0;}
  const image=await doc.embedPng(PNG.sync.write(cropped));
  const scaled=image.scaleToFit(signature.width-4,25);
  page.drawImage(image,{x:signature.x+(signature.width-scaled.width)/2,y:signature.y-7,width:scaled.width,height:scaled.height});
  const digest=createHash('sha256').update(copy).digest('hex');
  doc.setTitle('העתק חשבונית חתום '+ivnum);
  doc.setSubject('חתימת לקוח: '+signer.trim());
  doc.setKeywords(['העתק חתום','מזהה העתק: '+digest]);
  return Buffer.from(await doc.save());
}

module.exports={emailAddress,digitalConsent,keyFor,workflowStore,signatureImage,signedCopy};
