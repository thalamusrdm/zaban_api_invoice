'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {PNG}=require('pngjs');
const bundle={window:{},TextDecoder,TextEncoder};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/vendor/zxing-browser.min.js'),'utf8'),bundle);
const z=require('@zxing/library');
for(const name of ['product-qr.png','product-code128.png'])test('bundled ZXing decodes '+name,()=>{
 const image=PNG.sync.read(fs.readFileSync(path.join(__dirname,'../docs/camera-scan',name)));
 const gray=new Uint8ClampedArray(image.width*image.height);for(let i=0;i<gray.length;i++)gray[i]=image.data[i*4];
 const bitmap=new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(gray,image.width,image.height)));
 const reader=require('../public/barcode-reader').create(bundle.ZXingBrowser);
 assert.equal(reader.decodeBitmap(bitmap).getText(),'400001');
});

test('live reader searches a clear barcode away from the middle rows of the camera frame',()=>{
 const image=PNG.sync.read(fs.readFileSync(path.join(__dirname,'../docs/camera-scan/product-code128.png')));
 const width=image.width,height=900,gray=new Uint8ClampedArray(width*height).fill(255);
 for(let y=0;y<image.height;y++)for(let x=0;x<width;x++)gray[(y+10)*width+x]=image.data[(y*width+x)*4];
 const bitmap=()=>new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(gray,width,height)));
 const defaultReader=new bundle.ZXingBrowser.BrowserMultiFormatReader(new Map());
 assert.throws(()=>defaultReader.decodeBitmap(bitmap()));
 const reader=require('../public/barcode-reader').create(bundle.ZXingBrowser);
 assert.equal(reader.decodeBitmap(bitmap()).getText(),'400001');
});
