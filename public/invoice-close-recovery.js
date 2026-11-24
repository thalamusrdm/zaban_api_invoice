'use strict';
// The saved draft number resolves on the server to its immutable IV, even
// after closing changed its number. This never calls invoice creation.
(async () => {
  const pending = sessionStorage.getItem('zabanPendingClose');
  if (pending) await closeInvoice(pending, null, false);
})();
