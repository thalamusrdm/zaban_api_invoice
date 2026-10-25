'use strict';
let openSignedInvoice;

(() => {
  const dialog = document.getElementById('signedCopyDialog');
  const status = document.getElementById('signedCopyStatus');
  const frame = document.getElementById('signedCopyPdf');
  const link = document.getElementById('signedCopyLink');
  let request = 0, documentUrl = null;

  function clearDocument() {
    frame.src = 'about:blank';
    frame.hidden = true;
    link.hidden = true;
    link.removeAttribute('href');
    if (documentUrl) URL.revokeObjectURL(documentUrl);
    documentUrl = null;
  }

  openSignedInvoice = async (ivnum, button) => {
    const currentRequest = ++request;
    clearDocument();
    document.getElementById('signedCopyTitle').textContent = 'העתק חתום · ' + ivnum;
    status.textContent = 'טוען את ההעתק החתום מהנספחים בפריוריטי…';
    if (!dialog.open) dialog.showModal();
    if (button) button.disabled = true;
    try {
      const response = await fetch('/api/invoices/existing-signed?ivnum=' + encodeURIComponent(ivnum));
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw Error(error.error || 'לא ניתן לטעון את ההעתק החתום. אפשר לנסות שוב.');
      }
      if (!(response.headers.get('content-type') || '').includes('application/pdf')) throw Error('לא התקבל PDF של ההעתק החתום.');
      const blob = await response.blob();
      if (!blob.size) throw Error('ההעתק החתום שהתקבל ריק.');
      if (request !== currentRequest) return;
      documentUrl = URL.createObjectURL(blob);
      frame.src = documentUrl;
      frame.hidden = false;
      link.href = documentUrl;
      link.hidden = false;
      status.textContent = 'ההעתק החתום נטען מהנספחים של חשבונית ' + ivnum + ' בפריוריטי.';
    } catch (error) {
      if (request === currentRequest) status.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  };
  document.getElementById('closeSignedCopy').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { ++request; clearDocument(); });
})();
