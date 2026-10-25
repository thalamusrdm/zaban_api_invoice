'use strict';

const InvoiceProgress = (() => {
  const dialog = document.getElementById('invoiceProgressDialog');
  const status = document.getElementById('invoiceProgressStatus');
  const form = document.getElementById('form');
  const stages = [...dialog.querySelectorAll('[data-progress]')];
  const messages = {
    creating: 'בודקים את הפרטים ויוצרים את החשבונית…',
    closing: 'סוגרים את החשבונית לחשבונית סופית…',
    original: 'מכינים את המקור ושומרים אותו להורדה…',
    signature: 'מכינים את העתק החשבונית לחתימת הלקוח…',
  };

  function update(stage) {
    if (!dialog.open || !messages[stage]) return;
    status.textContent = messages[stage];
    const activeIndex = stages.findIndex(item => item.dataset.progress === stage);
    stages.forEach((item, index) => {
      item.dataset.state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
      if (index === activeIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  }

  // Escape must not hide an operation that is still running in Priority.
  dialog.addEventListener('cancel', event => event.preventDefault());
  return {
    show(stage = 'creating') {
      if (!dialog.open) dialog.showModal();
      form.setAttribute('aria-busy', 'true');
      update(stage);
    },
    update,
    hide() {
      if (dialog.open) dialog.close();
      form.removeAttribute('aria-busy');
    },
    isOpen: () => dialog.open,
  };
})();
