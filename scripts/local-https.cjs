'use strict';
// Development only: LAN HTTPS proxy; never exposes the app via a public tunnel.
const http=require('node:http');const https=require('node:https');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const net=require('node:net');
const address=process.env.LOCAL_HTTPS_ADDRESS||'10.0.0.2';
if(net.isIP(address)!==4||!(/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/).test(address))throw new Error('Use a private LAN IPv4 address.');
const dir=path.join(__dirname,'../.local-https');const cert=fs.readFileSync(path.join(dir,'zaban-camera-test.cer'));const leaf=fs.readFileSync(path.join(dir,'server.pfx'));
const ca=new crypto.X509Certificate(cert);const fingerprint=ca.fingerprint256;
const proxy=https.createServer({pfx:leaf,passphrase:'',minVersion:'TLSv1.2'},(req,res)=>{
 const upstream=http.request({hostname:'127.0.0.1',port:18473,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:18473','x-forwarded-proto':'https'}},remote=>{
  res.writeHead(remote.statusCode,{...remote.headers,'Permissions-Policy':'camera=(self), microphone=()'});remote.pipe(res);
 });
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Local invoice server is unavailable.');});
 req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
const setup=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='GET'&&req.url==='/zaban-camera-test.cer'){
  res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="zaban-camera-test.cer"'});return res.end(cert);
 }
 if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
 res.end('<!doctype html><html lang="he" dir="rtl"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HTTPS לבדיקה מקומית</title><style>body{font:18px system-ui;max-width:650px;margin:40px auto;padding:20px;line-height:1.7}code{overflow-wrap:anywhere;font-size:13px}</style><h1>סריקת מצלמה באייפון</h1><p>1. <a href="/zaban-camera-test.cer">הורדת תעודת Zaban Local Camera Test</a></p><p>2. הגדרות ← כללי ← VPN וניהול מכשירים ← הפרופיל שהורד ← התקנה.</p><p>3. הגדרות ← כללי ← אודות ← הגדרות אמון באישורים ← הפעלת אמון עבור Zaban Local Camera Test.</p><p>4. <a href="https://'+address+':18474/?agent=90">פתיחת המערכת ב-HTTPS</a> ואישור גישה למצלמה.</p><p>התעודה מיועדת לבדיקה זו בלבד. הסירו את הפרופיל בתום הבדיקה. אין לעקוף אזהרת אבטחה אם היא עדיין מוצגת.</p><p>טביעת אצבע SHA-256:</p><code dir="ltr">'+fingerprint+'</code></html>');
});
for(const server of [proxy,setup])server.on('error',error=>{console.error(error.message);process.exit(1);});
proxy.listen(18474,address,()=>console.log('HTTPS: https://'+address+':18474/?agent=90'));
setup.listen(18475,address,()=>{console.log('iPhone setup: http://'+address+':18475/');console.log('CA SHA256: '+fingerprint);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{proxy.close();setup.close();setTimeout(()=>process.exit(),500).unref();});
