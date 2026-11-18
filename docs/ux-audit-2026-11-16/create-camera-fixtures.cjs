'use strict';
const fs=require('node:fs');const path=require('node:path');const zxing=require('@zxing/library');const {PNG}=require('pngjs');
const folder=path.join(__dirname,'../camera-scan');fs.mkdirSync(folder,{recursive:true});
function save(matrix,name){const pad=30,png=new PNG({width:matrix.getWidth()+pad*2,height:matrix.getHeight()+pad*2});png.data.fill(255);for(let y=0;y<matrix.getHeight();y++)for(let x=0;x<matrix.getWidth();x++)if(matrix.get(x,y)){const i=((y+pad)*png.width+x+pad)*4;png.data[i]=png.data[i+1]=png.data[i+2]=0;}fs.writeFileSync(path.join(folder,name),PNG.sync.write(png));}
save(new zxing.QRCodeWriter().encode('400001',zxing.BarcodeFormat.QR_CODE,300,300,new Map()),'product-qr.png');
const patterns=zxing.Code128Reader.CODE_PATTERNS; const codes=[105,40,0,1,45,106]; const widths=codes.flatMap(c=>Array.from(patterns[c])); const bars=[];let black=true;for(const w of widths){for(let n=0;n<w*3;n++)bars.push(black);black=!black;}save({getWidth:()=>bars.length,getHeight:()=>140,get:(x,y)=>bars[x]},'product-code128.png');
console.log('Created real QR and Code128 fixtures for fictional product L001.');
