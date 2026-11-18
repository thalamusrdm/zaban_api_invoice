'use strict';
// Read-only presentation of the existing invoice state. No API calls or business writes.
(() => {
  const el = id => document.getElementById(id);
  let editingCustomer = false;
  let previousCustomer = '';
  const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
  function refresh() {
    const agentNumber = el('agent').value.trim();
    setText(el('envAgent'), /^\d{1,16}$/.test(agentNumber) ? 'סוכן ' + agentNumber : '');
    const number = el('custname').value;
    if (number !== previousCustomer) { editingCustomer = false; previousCustomer = number; }
    const selected = Boolean(number && el('custSearch').value);
    el('customerSelection').hidden = !selected || editingCustomer;
    el('customerSearchGroup').hidden = selected && !editingCustomer;
    setText(el('selectedCustomerName'), el('custSearch').value);
    setText(el('selectedCustomerNumber'), 'מספר לקוח ' + number);
    const values = {
      customer: selected ? el('custSearch').value : 'לא נבחר לקוח',
      number: selected ? 'לקוח ' + number : '',
      type: el('invoiceType').selectedOptions[0]?.textContent || '',
      date: el('date').value.split('-').reverse().join('.'),
      agent: (el('agent').value || '—') + ' / ' + (el('warehouse').value || '—'),
      before: el('tBefore').textContent,
      vat: el('tVat').textContent,
      total: el('tTotal').textContent,
    };
    for (const node of document.querySelectorAll('[data-summary]')) setText(node, values[node.dataset.summary] || '');
    setText(el('footerAmount'), 'לפני מע״מ: ' + values.before);
    const rows = [...el('lines').tBodies[0].rows];
    setText(el('cartLineCount'), rows.length === 1 ? 'שורה אחת' : rows.length + ' שורות');
    for (const row of rows) {
      const input = row.querySelector('.l-part');
      const unit = row.querySelector('.l-unit').textContent;
      const quantityCell = row.querySelector('.l-grams').parentElement;
      if (unit && unit !== 'לפי המוצר') quantityCell.setAttribute('data-unit', unit);
      else quantityCell.removeAttribute('data-unit');
      row.classList.toggle('has-product', Boolean(input.value.trim() && (row.dataset.selectedPart === input.value.trim() || row.dataset.displayPart === input.value.trim())));
    }
  }
  el('changeCustomer').addEventListener('click', () => {
    editingCustomer = true;
    refresh();
    el('custSearch').focus();
    el('custSearch').select();
  });
  el('custList').addEventListener('click', () => { editingCustomer = false; refresh(); });
  el('custSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') { editingCustomer = false; refresh(); }
  });
  el('form').addEventListener('input', refresh);
  el('form').addEventListener('change', refresh);
  el('typePicker').addEventListener('click', refresh);
  const observer = new MutationObserver(refresh);
  for (const id of ['custChosen', 'customerDelivery', 'tBefore', 'tVat', 'tTotal', 'selectedTypeTitle', 'lines']) {
    observer.observe(el(id), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
  const errorNodes = ['msg', 'documentMsg', 'stepStatus', 'signatureStatus', 'customerDeliveryStatus', 'completionDocumentStatus'].map(el);
  let pendingError = null;
  function revealError(node) {
    if (!node || !node.matches('.msg.show.err, .msg.show.warn, .step-error:not([hidden]), [data-state="error"]') || !node.getBoundingClientRect().height) return;
    if (el('invoiceProgressDialog').open) { pendingError = node; return; }
    pendingError = null;
    node.focus({preventScroll:true});
    node.scrollIntoView({block:'nearest'});
  }
  const errorObserver = new MutationObserver(records => {
    for (const node of errorNodes) if (records.some(record => node === record.target || node.contains(record.target))) revealError(node);
  });
  for (const node of errorNodes) errorObserver.observe(node, {childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','data-state']});
  el('invoiceProgressDialog').addEventListener('close', () => revealError(pendingError));
  refresh();
})();
