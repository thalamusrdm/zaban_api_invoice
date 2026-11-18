'use strict';
const https=require('node:https');const http=require('node:http');const fs=require('node:fs');const crypto=require('node:crypto');const path=require('node:path');const assert=require('node:assert/strict');
const ca=new crypto.X509Certificate(fs.readFileSync(path.join(__dirname,'../.local-https/zaban-camera-test.cer')));
const address=process.env.LOCAL_HTTPS_ADDRESS||'10.0.0.2';
function get(protocol,port,url,options={}){return new Promise((resolve,reject)=>{const req=protocol.get({hostname:address,port,path:url,timeout:5000,...options},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('timeout',()=>req.destroy(new Error('Timeout')));req.on('error',reject);});}
(async()=>{
 for(const url of ['/?agent=90','/barcode-reader.js?v=2','/camera-scanner.js?v=2','/vendor/zxing-browser.min.js']){const res=await get(https,18474,url,{ca:ca.toString()});assert.equal(res.status,200);assert.equal(res.headers['permissions-policy'],'camera=(self), microphone=()');assert.ok(res.body.length>100);console.log('Verified trusted TLS + HTTP 200: '+url);}
 const cert=await get(http,18475,'/zaban-camera-test.cer');assert.equal(cert.status,200);assert.equal(new crypto.X509Certificate(cert.body).fingerprint256,ca.fingerprint256);
 const forbidden=await get(http,18475,'/server.pfx');assert.equal(forbidden.status,404);
 console.log('Certificate download verified; private key unavailable over HTTP.');
 console.log('Certificate expires: '+ca.validTo);
})().catch(error=>{console.error(error);process.exitCode=1;});
