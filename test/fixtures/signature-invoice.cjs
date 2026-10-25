'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const fontkit=require('@pdf-lib/fontkit');
const {StandardFonts}=require('pdf-lib');
async function addSignatureFields(document,page,y=377.7){
  document.registerFontkit(fontkit);
  const hebrew=await document.embedFont(await fs.readFile(path.join(__dirname,'../../public/fonts/NotoSansHebrew-Regular.ttf')),{subset:true});
  const latin=await document.embedFont(StandardFonts.Helvetica);
  page.drawText('_______________',{x:313.4,y,size:7.55,font:latin});
  page.drawText('חתימת הלקוח',{x:385.2,y,size:7.55,font:hebrew});
  page.drawText('__________________________',{x:435.1,y,size:7.55,font:latin});
  page.drawText('שם הלקוח',{x:551.1,y,size:7.55,font:hebrew});
}
module.exports={addSignatureFields};
