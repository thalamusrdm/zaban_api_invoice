'use strict';

// The draft number changes on closing. Persist its internal identity before
// starting the procedure; never infer identity from a customer, amount or date.
function invoiceCloser({priority, store, keyFor, base, user, close, preflight, prepareOriginal}) {
  const pending = new Map();
  const mappingKey = number => keyFor(base, 'close:' + number);
  const workflowKey = iv => keyFor(base, iv);
  const escape = value => String(value).replace(/'/g, "''");
  const fail = message => Object.assign(new Error(message), {status:409});
  const fields = 'IV,IVNUM,STATDES,OWNERLOGIN,CUSTNAME,TOTPRICE';
  const final = inv => inv.STATDES === 'סופית' && /^IN\d+$/.test(inv.IVNUM);

  async function remember(inv) {
    if (!Number.isSafeInteger(inv.IV) || inv.IV <= 0 || !inv.IVNUM) throw fail('חסר מזהה פנימי של החשבונית; אין להפיק אותה שוב.');
    const key = mappingKey(inv.IVNUM);
    await store.bind(key, String(inv.IV));
    await store.write(key, 'close-target', {iv:inv.IV, number:inv.IVNUM});
  }
  function verify(inv, iv) {
    if (!inv || inv.IV !== iv || inv.OWNERLOGIN !== user || !inv.CUSTNAME) throw fail('זהות החשבונית או משתמש הטיפול לא אומתו. לא תופעל סגירה.');
    return inv;
  }
  async function current(iv) {
    const result = await priority('GET', 'AINVOICES?$select=' + fields + '&$filter=' + encodeURIComponent('IV eq ' + iv) + '&$top=2');
    if (result?.value?.length !== 1) throw fail('לא ניתן לאמת את הסגירה בפריוריטי. אין להפיק חשבונית נוספת.');
    return verify(result.value[0], iv);
  }
  async function resolve(number) {
    if (typeof number !== 'string' || !/^[A-Za-z0-9-]{1,16}$/.test(number)) throw fail('חסר מספר חשבונית תקין');
    const target = await store.read(mappingKey(number), 'close-target');
    if (target) return current(target.iv);
    const inv = await priority('GET', `AINVOICES(IVNUM='${escape(number)}',IVTYPE='A',DEBIT='D')?$select=${fields}`);
    verify(inv, inv?.IV);
    await remember(inv);
    return inv;
  }
  async function result(inv) {
    const context = await store.read(workflowKey(inv.IV));
    if (context && context.custname !== inv.CUSTNAME) throw fail('הלקוח בחשבונית שונה מהלקוח שנשמר בתהליך. נדרשת בדיקה.');
    return {ivnum:inv.IVNUM, iv:inv.IV, status:inv.STATDES, closed:final(inv),
      originalDownload:!!context?.originalDownload, digitalEmail:!!context?.digitalEmail,
      sendOriginalEmail:!!context?.sendOriginalEmail, email:context?.email};
  }
  async function status(number) {
    const inv = await resolve(number);
    const state = await store.read(workflowKey(inv.IV), 'closing');
    return {...await result(inv), pending:!final(inv) && !!state && state.status !== 'complete'};
  }
  async function finish(inv) {
    const data = await result(inv);
    if (!data.closed) throw fail('החשבונית עדיין אינה סופית; לא יופק מקור.');
    // This continues even if the browser disconnected while the procedure ran.
    // Preparation has its own persisted guard and checks existing attachments.
    if (data.originalDownload) await prepareOriginal(inv.IVNUM);
    return data;
  }
  async function run(number) {
    const before = await resolve(number);
    if (pending.has(before.IV)) return pending.get(before.IV);
    const task = (async () => {
      if (final(before)) return finish(before);
      if (before.STATDES !== 'טיוטא') throw fail('סטטוס החשבונית אינו מאפשר סגירה.');
      const key = workflowKey(before.IV);
      const context = await store.read(key);
      if (context && context.custname !== before.CUSTNAME) throw fail('הלקוח בחשבונית השתנה.');
      // Failed preflight does not mark the financial procedure as attempted.
      if (!await store.read(key, 'closing')) await preflight(before, context);
      try {
        await store.once(key, 'closing', async () => {
          let outcome, error;
          try { outcome = await close(before.IVNUM); } catch (e) { error = e.message; }
          const after = await current(before.IV);
          if (!final(after)) throw fail('סגירת החשבונית לא אומתה: ' +
            ([...(outcome?.messages || []), ...(outcome?.formMessages || []), error].filter(Boolean).join('\n') || 'החשבונית עדיין טיוטה'));
          return {iv:after.IV};
        });
      } catch (error) {
        // A timeout (including a previous process's uncertain state) is never
        // permission to run the procedure again. Reconcile by IV only.
        const after = await current(before.IV);
        if (final(after)) return finish(after);
        throw error;
      }
      return finish(await current(before.IV));
    })().finally(() => pending.delete(before.IV));
    pending.set(before.IV, task);
    return task;
  }
  return {remember, run, status};
}
module.exports = {invoiceCloser};
