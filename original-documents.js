'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
// A persisted intent prevents regeneration after a crash, timeout or restart.
function originalStore(directory) {
  const pending = new Map();
  async function run(key, produce, download) {
    await fs.mkdir(directory, { recursive: true });
    const id = createHash('sha256').update(key).digest('hex');
    const stateFile = path.join(directory, id + '.json');
    const pdfFile = path.join(directory, id + '.pdf');
    let state;
    try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (state?.status === 'complete') return fs.readFile(pdfFile);
    if (!state) {
      try { await fs.writeFile(stateFile, JSON.stringify({ status: 'started', at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code === 'EEXIST') throw new Error('הפקת המקור כבר התחילה. אין להפיק שוב; נדרשת בדיקה בפריוריטי.'); throw e; }
      // Intentionally retain started state if generation has an ambiguous result.
      let document;
      try { document = await produce(); }
      catch (err) {
        await fs.writeFile(stateFile, JSON.stringify({ status: 'started', error: err.message || String(err), at: new Date().toISOString() }), { mode: 0o600 });
        throw err;
      }
      state = { status: 'generated', document };
      await fs.writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    }
    if (state.status !== 'generated') throw new Error('ניסיון הפקת מקור קודם לא הושלם בוודאות. ' + (state.error ? 'סיבה שנשמרה: ' + state.error + '. ' : '') + 'נדרשת בדיקה בפריוריטי לפני ניסיון נוסף. הפקה נוספת חסומה. ניתן להוריד העתק בנפרד.');
    const buffer = await download(state.document);
    if (buffer.subarray(0, 5).toString() !== '%PDF-' || !buffer.includes(Buffer.from('/ByteRange'))) throw new Error('הקובץ שהוחזר אינו PDF חתום מאומת. לא סומן כמקור ולא תופעל הפקה נוספת.');
    await fs.writeFile(pdfFile, buffer, { mode: 0o600 });
    await fs.writeFile(stateFile, JSON.stringify({ status: 'complete', at: new Date().toISOString() }), { mode: 0o600 });
    return buffer;
  }
  return (key, produce, download) => {
    if (pending.has(key)) return pending.get(key);
    const task = run(key, produce, download).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}
module.exports = { originalStore };
