'use strict';
// Isolated conformance fixtures for the real public/ UI. No .env, ERP, mail or document writes.
// Run: node docs/ux-audit-2026-11-16/preview.cjs
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const root = path.resolve(__dirname, '../../public');
const PORT = Number(process.argv[2] || 18477);
const customer = { CUSTNAME: '900001', CUSTDES: 'לקוח הדגמה לתכנון UX', WTAXNUM: '000000000', WTAXNUMEXPL: '2', VATNUM: '000000000', CTYPECODE: '1', CTYPENAME: 'הדגמה', BUSINESSTYPE: 'תכשיטים' };
const profile = { custname: customer.CUSTNAME, email: 'demo@example.com', phone: '0500000000', digital: true, companyNumber: customer.WTAXNUM, vatNumber: customer.VATNUM, numberExplanation: '2' };
let created = false;
let mail = false;
let calculated = { beforeVat: 700, vat: 126, total: 826 };
const parts = [
  { PARTNAME: '14', BARCODE: '140000', PARTDES: 'זהב 14 קראט — הדגמה', PUNITNAME: 'גרם', BASEPLPRICE: 100, BASEPLCODE: 'USD' },
  { PARTNAME: 'D001', BARCODE: '200001', PARTDES: 'יהלום — הדגמה', PUNITNAME: 'יחידה', BASEPLPRICE: 200, BASEPLCODE: 'USD' },
  { PARTNAME: 'L001', BARCODE: '400001', PARTDES: 'טבעת יהלומי מעבדה — הדגמה', PUNITNAME: 'יחידה', BASEPLPRICE: 300, BASEPLCODE: 'USD' },
];
const pdf = (async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('UX WALKTHROUGH - FICTIONAL DOCUMENT', { x: 45, y: 785, size: 17, font });
  page.drawText('No invoice, original, email or signature is created in Priority.', { x: 45, y: 750, size: 11, font });
  page.drawText('IN900000001 | Demo Customer | 826.00 ILS', { x: 45, y: 705, size: 13, font });
  return Buffer.from(await doc.save());
})();
const rows = () => [{ IVNUM: 'IN900000001', IVDATE: '2026-11-16', STATDES: 'סופית', TOTPRICE: calculated.total, CUSTNAME: customer.CUSTNAME, CDES: customer.CUSTDES, AGENTCODE: '90', DETAILS: 'הדגמה בלבד' }, { IVNUM: 'T900000002', IVDATE: '2026-11-16', STATDES: 'טיוטא', TOTPRICE: 118, CUSTNAME: customer.CUSTNAME, CDES: customer.CUSTDES, AGENTCODE: '90' }];
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:18477');
  try {
    if (url.pathname === '/__scenario') {
      const scenario = url.searchParams.get('name') || 'normal';
      if (!/^[a-z-]+$/.test(scenario)) return json(res, {error:'Invalid fixture'},400);
      created=false;mail=false;
      res.writeHead(302, {'Set-Cookie':'uxScenario='+scenario+'; Path=/; SameSite=Strict',Location:'/?agent=90','Cache-Control':'no-store'});return res.end();
    }
    if (!url.pathname.startsWith('/api/')) {
      const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
      const file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep)) return json(res, { error: 'Not found' }, 404);
      const bytes = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Permissions-Policy': 'camera=(), microphone=()' });
      return res.end(bytes);
    }
    let body = {};
    if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += chunk; body = JSON.parse(raw || '{}'); }
    const key = req.method + ' ' + url.pathname;
    console.log(key); // Method/path only; never logs customer inputs.
    const scenario = /(?:^|; )uxScenario=([a-z-]+)/.exec(req.headers.cookie || '')?.[1] || 'normal';
    const failure = {
      'customer-save-error':['POST /api/customers/digital','שמירת פרטי הלקוח נכשלה — דמה'],
      'exchange-error':['GET /api/exchange-rates','שער הדולר לא זמין — דמה'],
      'close-error':['POST /api/invoices/close','הסגירה לא אומתה — דמה'],
      'original-error':['POST /api/invoices/prepare-original-download','שמירת המקור לא אומתה — דמה'],
      'download-error':['GET /api/invoices/document','ההורדה נחסמה — דמה'],
      'mail-error':['POST /api/invoices/email-original','משלוח המייל לא אומת — דמה'],
      'signature-error':['POST /api/invoices/sign','שמירת החתימה לא אומתה — דמה'],
      'signed-missing':['GET /api/invoices/existing-signed','אין העתק חתום בנספחים — דמה']
    }[scenario];
    if(failure?.[0]===key)return json(res,{error:failure[1]},503);
    if(scenario==='offline' && key.startsWith('GET /api/'))return json(res,{error:'אין חיבור — דמה'},503);
    if(scenario==='progress' && ['POST /api/invoices','POST /api/invoices/close','POST /api/invoices/prepare-original-download','GET /api/invoices/signature-copy'].includes(key))await new Promise(resolve=>setTimeout(resolve,1200));
    switch (key) {
      case 'GET /api/health': return json(res, { ok: true, company: 'הדגמה מקומית בלבד' });
      case 'GET /api/invoices/options': return json(res, { warehouses: [{ code: '1', label: 'מחסן הדגמה' }], agents: [{ code: '90', label: 'סוכן הדגמה' }] });
      case 'GET /api/mail/status': return json(res, { configured: true, from: 'demo@example.com' });
      case 'GET /api/customers':
      case 'GET /api/customers/all': return json(res, { value: [customer] });
      case 'GET /api/customers/details': return json(res, scenario === 'customer-missing' ? {...customer,WTAXNUM:'',WTAXNUMEXPL:'',VATNUM:''} : customer);
      case 'GET /api/customers/digital': return json(res, scenario === 'customer-missing' ? {...profile,email:'',phone:''} : profile);
      case 'POST /api/customers/digital': return json(res, { ...profile, email: body.email || profile.email, phone: body.phone || profile.phone });
      case 'GET /api/parts': {
        const index = ({ '1': 0, '2': 1, '4': 2 })[url.searchParams.get('invoiceType')] ?? 0;
        const term = url.searchParams.get('q') || '';
        const part = parts[index];
        return json(res, { value: !term || [part.PARTNAME, part.BARCODE, part.PARTDES].some(value => value.includes(term)) ? [part] : [] });
      }
      case 'GET /api/exchange-rates': return json(res, { date: url.searchParams.get('date'), source: url.searchParams.get('source') === 'priority' ? 'priority' : 'bank-of-israel', rates: { USD: { rate: 3.5, rateDate: '2026-11-16' }, '$': { rate: 3.5, rateDate: '2026-11-16' } } });
      case 'GET /api/invoices/recent': return json(res, { value: scenario === 'empty' ? [] : rows() });
      case 'GET /api/invoices/check': return json(res, { value: url.searchParams.get('details') === 'DUPLICATE' ? [rows()[0]] : [] });
      case 'POST /api/invoices/original-download-preflight': return json(res, { ready: true });
      case 'POST /api/invoices': {
        calculated = require('../../public/invoice-calculations').totals(body.lines || []);
        created = true; mail = body.sendOriginalEmail === true;
        return json(res, { ivnum: 'T900000001', ...calculated, originalDownload: true });
      }
      case 'POST /api/invoices/close': return json(res, { ivnum: 'IN900000001', status: 'סופית', originalDownload: true, sendOriginalEmail: created && mail, email: 'demo@example.com' });
      case 'POST /api/invoices/prepare-original-download': return json(res, { existing: true });
      case 'POST /api/invoices/email-original': return json(res, { acceptedByMailServer: true, email: 'demo@example.com' });
      case 'POST /api/invoices/sign': return json(res, {ivnum:body.ivnum,attached:true});
      case 'GET /api/invoices/existing-signed':
      case 'GET /api/invoices/signature-copy':
      case 'GET /api/invoices/existing-original':
      case 'GET /api/invoices/document': {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'X-Signature-Token': 'fictional-ux-copy' });
        return res.end(await pdf);
      }
      // All responses are fictional and remain inside this process.
      default: return json(res, { error: 'הפעולה אינה מופעלת בהדגמת UX' }, 404);
    }
  } catch (error) { json(res, { error: error.message }, 500); }
});
server.listen(PORT, '127.0.0.1', () => console.log('Isolated UX preview: http://127.0.0.1:'+PORT+'/?agent=90'));
