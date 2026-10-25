'use strict';
let resetInvoiceFlow;
let showSignatureFlow;
let completeSignatureFlow;

(() => {
  const panels = ['customerStep', 'productsStep', 'reviewStep', 'signatureDialog'].map(id => document.getElementById(id));
  const stepButtons = [...document.querySelectorAll('[data-step]')];
  const form = document.getElementById('form');
  let currentStep = 0;
  let signingInvoice = null;
  const el = id => document.getElementById(id);

  function review() {
    el('reviewCustomer').textContent = el('custSearch').value;
    const date = el('date').value;
    el('reviewDate').textContent = date ? date.split('-').reverse().join('.') : '—';
    el('reviewDetails').textContent = el('details').value;
    el('reviewDetailsRow').hidden = !el('details').value.trim();
    el('reviewLines').replaceChildren(...[...el('lines').tBodies[0].rows].map(tr => {
      const item = document.createElement('li');
      const product = document.createElement('span');
      const total = document.createElement('span');
      product.textContent = `${tr.querySelector('.l-part').value} · ${tr.querySelector('.l-desc').textContent} · כמות ${tr.querySelector('.l-grams').value}`;
      total.textContent = tr.querySelector('.l-total').textContent;
      item.append(product, total);
      return item;
    }));
  }

  function showStep(index, focus = true) {
    currentStep = index;
    panels.forEach((panel, i) => { panel.hidden = i !== index; });
    stepButtons.forEach((button, i) => {
      button.disabled = signingInvoice ? i !== 3 : i === 3;
      if (i === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    el('previousStep').hidden = index === 0 || index === 3;
    el('nextStep').hidden = index >= 2;
    el('nextStep').textContent = index === 0 ? 'המשך למוצרים' : 'המשך לבדיקה';
    el('stepCount').textContent = `שלב ${index + 1} מתוך 4`;
    el('stepStatus').hidden = true;
    if (index === 2) review();
    if (focus) panels[index].querySelector('h2').focus();
  }

  function revealField(field) {
    const index = panels.findIndex(panel => panel.contains(field));
    if (index !== -1 && index !== currentStep) showStep(index);
    let parent = field.parentElement;
    while (parent && parent !== form) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
  }

  function validateStep(index) {
    const invalid = [...panels[index].querySelectorAll('input, select')].find(field => !field.checkValidity());
    if (invalid) {
      revealField(invalid);
      invalid.reportValidity();
      return false;
    }
    if (index === 0 && !el('custname').value && !/^\d+$/.test(el('custSearch').value.trim())) {
      showStep(0);
      el('stepStatus').textContent = 'בחרו לקוח מהרשימה, או הזינו מספר לקוח.';
      el('stepStatus').hidden = false;
      el('custSearch').focus();
      return false;
    }
    if (index === 1) {
      const rows = [...el('lines').tBodies[0].rows];
      const missing = rows.findIndex(tr => Number(tr.querySelector('.l-price').value) <= 0 || Number(tr.querySelector('.l-exchange').value) <= 0);
      if (missing !== -1 || !rows.length) {
        showStep(1);
        el('stepStatus').textContent = `בשורה ${missing + 1} חסר מחיר או שער דולר. המתינו לטעינה או בחרו מוצר עם מחיר תקין.`;
        el('stepStatus').hidden = false;
        return false;
      }
    }
    return true;
  }

  function navigate(index) {
    if (el('submit').disabled) return;
    if (signingInvoice ? index !== 3 : index === 3) return;
    if (index > currentStep) {
      for (let i = 0; i < index; i++) if (!validateStep(i)) return;
    }
    if (index > 0 && !el('custname').value && /^\d+$/.test(el('custSearch').value.trim())) {
      el('custname').value = el('custSearch').value.trim();
      loadCustDetails(el('custname').value);
    }
    showStep(index);
  }

  el('nextStep').addEventListener('click', () => navigate(Math.min(currentStep + 1, 2)));
  el('previousStep').addEventListener('click', () => navigate(Math.max(currentStep - 1, 0)));
  stepButtons.forEach(button => button.addEventListener('click', () => navigate(Number(button.dataset.step))));
  el('typePicker').addEventListener('click', () => {
    if (!el('invoiceScreen').hidden) {
      el('completionNotice').hidden = true;
      showStep(0, false);
    }
  });
  // Native validation may find a field in an earlier, currently hidden step.
  form.addEventListener('invalid', event => revealField(event.target), true);
  // Enter advances through the flow; only the final step can create an invoice.
  form.addEventListener('keydown', event => {
    if (event.key === 'Enter' && currentStep === 3 && event.target.tagName === 'INPUT') {
      event.preventDefault();
      return;
    }
    if (event.defaultPrevented || event.key !== 'Enter' || currentStep >= 2 || event.target.tagName !== 'INPUT') return;
    event.preventDefault();
    navigate(currentStep + 1);
  });
  form.addEventListener('submit', event => {
    if (currentStep !== 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (currentStep < 2) navigate(currentStep + 1);
    }
  }, true);
  // Once creation clears the lines, leave the old review before the next invoice.
  resetInvoiceFlow = () => {
    signingInvoice = null;
    el('changeType').disabled = false;
    showStep(0, false);
  };
  showSignatureFlow = ivnum => {
    signingInvoice = ivnum;
    el('typePicker').hidden = true;
    el('invoiceScreen').hidden = false;
    el('changeType').disabled = true;
    showStep(3);
  };
  completeSignatureFlow = ivnum => {
    resetInvoiceFlow();
    el('invoiceScreen').hidden = true;
    el('typePicker').hidden = false;
    el('completionDetails').textContent = `ההעתק החתום של חשבונית ${ivnum} נשמר ואומת בנספחים בפריוריטי. אפשר להתחיל חשבונית חדשה.`;
    el('completionNotice').hidden = false;
    el('msg').className = 'msg';
    el('documentMsg').className = 'msg';
    el('custSearch').value = '';
    el('custname').value = '';
    if (typeof loadRecent === 'function') loadRecent();
    el('custChosen').textContent = '';
    el('custInfo').classList.remove('show');
    el('custEdit').classList.remove('show');
    el('details').value = '';
    el('completionTitle').focus();
    window.scrollTo(0, 0);
  };
})();
