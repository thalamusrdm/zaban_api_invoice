'use strict';
// Locate the actual printed signature fields, never fixed page coordinates.
const path=require('node:path');
const standardFontDataUrl=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replace(/\\/g,'/')+'/';
let pdfjsPromise;
async function signatureFields(bytes) {
  const pdfjs=await (pdfjsPromise ||= import('pdfjs-dist/legacy/build/pdf.mjs'));
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,standardFontDataUrl});
  const invalid=message=>Object.assign(new Error(message),{status:400});
  try {
    const doc=await task.promise;
    const page=await doc.getPage(doc.numPages);
    const {items}=await page.getTextContent();
    const texts=items.filter(item=>typeof item.str==='string' && item.transform?.length===6).map(item=>({text:item.str.replace(/[\u200e\u200f\u202a-\u202e]/g,'').trim().replace(/\s+/g,' '),x:item.transform[4],y:item.transform[5],width:item.width,height:item.height}));
    function field(label) {
      const labels=texts.filter(item=>item.text.replace(/[:：]$/,'')===label);
      if(labels.length!==1)throw invalid('לא ניתן לזהות באופן חד-משמעי את שדה ״'+label+'״ בחשבונית. החתימה לא צורפה.');
      const anchor=labels[0];
      const candidates=texts.filter(item=>/^_{5,}$/.test(item.text) && Math.abs(item.y-anchor.y)<Math.max(3,anchor.height*.5) && item.x+item.width<=anchor.x+2 && anchor.x-(item.x+item.width)<24).sort((a,b)=>b.x-a.x);
      if(candidates.length!==1 || candidates[0].width<40)throw invalid('לא נמצא קו ברור למילוי ״'+label+'״ בחשבונית. החתימה לא צורפה.');
      return candidates[0];
    }
    const name=field('שם הלקוח'),signature=field('חתימת הלקוח');
    if(Math.abs(name.y-signature.y)>4 || signature.x+signature.width>name.x-4)throw invalid('פריסת שדות החתימה בחשבונית אינה תואמת. החתימה לא צורפה.');
    return {pageIndex:doc.numPages-1,name,signature};
  } finally {await task.destroy();}
}
module.exports={signatureFields};
