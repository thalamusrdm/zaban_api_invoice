'use strict';
let openInvoiceResend;

(() => {
  const el = id => document.getElementById(id);
  const dialog = el('resendDialog'), form = el('resendForm'), email = el('resendEmail');
  const status = el('resendStatus'), send = el('sendResend'), close = el('closeResend');
  let state = null, request = 0;
  const storageKey = ivnum => 'zabanInvoiceResend:' + ivnum;
  function newRequestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
  }
  function message(text, error = false) {
    status.textContent = text;
    if (error) status.setAttribute('data-state', 'error');
    else status.removeAttribute('data-state');
  }

  openInvoiceResend = async (ivnum, button) => {
    if (state?.busy) return;
    const current = ++request;
    state = null;
    el('resendTitle').textContent = 'שליחה חוזרת · ' + ivnum;
    el('resendCustomer').textContent = '';
    email.value = ''; email.disabled = true; email.readOnly = false;
    send.disabled = true; send.textContent = 'אישור ושליחה חוזרת';
    message('טוען את כתובת המייל של לקוח החשבונית מפריוריטי…');
    if (!dialog.open) dialog.showModal();
    if (button) button.disabled = true;
    try {
      const options = await api('/api/invoices/resend-options?ivnum=' + encodeURIComponent(ivnum));
      if (current !== request) return;
      if (options.ivnum !== ivnum) throw Error('פרטי החשבונית שהתקבלו אינם תואמים לבקשה');
      el('resendCustomer').textContent = 'לקוח ' + options.name + ' · ' + options.custname;
      const stored = JSON.parse(sessionStorage.getItem(storageKey(ivnum)) || 'null');
      const pending = stored?.status === 'pending' ? stored : null;
      state = {ivnum, busy:false, sent:false, pending};
      email.value = pending ? pending.email : options.email || '';
      email.disabled = false;
      email.readOnly = Boolean(pending);
      send.disabled = !options.configured;
      send.textContent = pending ? 'בדיקת תוצאת השליחה הקודמת' : 'אישור ושליחה חוזרת';
      message(!options.configured ? 'משלוח במייל אינו מוגדר במערכת. ניתן להוריד את המסמך מהחשבונית.'
        : pending ? 'קיימת בקשת משלוח שטרם אומתה. הבדיקה תשתמש באותה בקשה ולא תשלח הודעה כפולה.'
          : 'יש לבדוק את כתובת הנמען ולאשר את המשלוח. לא יופק מקור חדש.');
      email.focus();
    } catch (error) {
      if (current === request) message(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const attempt = state;
    if (!attempt || attempt.busy || attempt.sent || send.disabled || !email.reportValidity()) return;
    attempt.busy = true; send.disabled = close.disabled = true; email.readOnly = true;
    send.textContent = 'שולח…';
    try {
      const intent = attempt.pending || {requestId:newRequestId(), email:email.value.trim(), status:'pending'};
      // Persist before the request so refresh/retry cannot silently create a new send.
      sessionStorage.setItem(storageKey(attempt.ivnum), JSON.stringify(intent));
      attempt.pending = intent;
      message('מעביר את מקור החשבונית ' + attempt.ivnum + ' למייל ' + intent.email + '…');
      const result = await api('/api/invoices/resend-original', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ivnum:attempt.ivnum, email:intent.email, requestId:intent.requestId, consent:true}),
      });
      if (result.acceptedByMailServer !== true || result.ivnum !== attempt.ivnum || result.email !== intent.email) {
        throw Error('לא התקבל אישור משלוח התואם לחשבונית ולנמען');
      }
      sessionStorage.setItem(storageKey(attempt.ivnum), JSON.stringify({...intent, status:'complete'}));
      attempt.sent = true;
      message('שרת הדואר קיבל את מקור חשבונית ' + attempt.ivnum + ' לשליחה אל ' + result.email + '. זה אינו אישור מסירה לתיבת הלקוח.');
      send.textContent = 'הבקשה לשליחה התקבלה';
    } catch (error) {
      message('השליחה לא אומתה: ' + error.message + ' אין לשלוח בקשה חדשה לפני בדיקה בתיבה השולחת.', true);
      send.textContent = 'בדיקת תוצאת השליחה הקודמת';
    } finally {
      attempt.busy = false;
      close.disabled = false;
      send.disabled = attempt.sent;
    }
  });
  close.addEventListener('click', () => { if (!state?.busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (state?.busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { ++request; state = null; });
})();
