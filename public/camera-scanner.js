'use strict';
(() => {
  const el = id => document.getElementById(id);
  const dialog = el('cameraScanner'), video = el('cameraVideo'), status = el('cameraScannerStatus');
  const preview = video.parentElement, photoInput = el('cameraPhotoInput');
  let session = 0, liveEpoch = 0, stream = null, controls = null, startingLive = false, consumed = false;
  const active = id => id === session && dialog.open;
  const liveAvailable = () => window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
  function showStatus(message, error = false) {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  }
  function stopTracks(source) { for (const track of source?.getTracks() || []) track.stop(); }
  function stopLive() {
    liveEpoch++;
    startingLive = false;
    const running = controls; controls = null;
    try { running?.stop(); } catch {} finally {
      stopTracks(stream); stream = null;
      video.pause(); video.srcObject = null;
    }
  }
  function releaseSession() {
    session++;
    stopLive();
    photoInput.value = '';
  }
  function closeScanner() { releaseSession(); if (dialog.open) dialog.close(); }
  function makeReader() {
    return BarcodeReader.create(window.ZXingBrowser);
  }
  async function receiveResult(value, id) {
    if (!active(id) || consumed) return;
    const code = PartLookup.normalize(value);
    if (!PartLookup.isValid(code)) {
      showStatus('הקוד שזוהה אינו קוד מוצר תקין. כוונו לברקוד של המוצר ונסו שוב.', true);
      return;
    }
    consumed = true;
    closeScanner();
    try { await receiveCameraBarcode(code); }
    catch { showMsg('warn', 'לא ניתן להשלים את חיפוש המוצר. הקוד נשאר בשורה; אפשר לנסות שוב.'); }
  }
  function cameraError(error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'אין הרשאה למצלמה. אפשר לאפשר גישה בהגדרות הדפדפן, או לצלם ברקוד דרך הכפתור למטה.';
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return 'לא נמצאה מצלמה זמינה. אפשר לבחור צילום של הברקוד.';
    if (error.message === 'ScannerUnavailable') return 'מנוע הסריקה לא נטען. רעננו את העמוד או הזינו מק״ט ידנית.';
    if (error.message === 'DecoderStopped') return 'המצלמה נפתחה אבל הסריקה נעצרה. לחצו על ניסיון נוסף, או צלמו את הברקוד דרך הכפתור למטה.';
    return 'לא ניתן לפתוח את המצלמה. סגרו יישום אחר שמשתמש בה, או נסו צילום של הברקוד.';
  }
  async function startLive(id) {
    stopLive();
    const epoch = liveEpoch;
    if (!liveAvailable()) {
      preview.hidden = true;
      el('retryCamera').hidden = true;
      showStatus('לסריקה חיה בטלפון יש לפתוח את המערכת ב־HTTPS. אפשר לצלם ברקוד או לבחור תמונה באמצעות הכפתור למטה.');
      return;
    }
    el('retryCamera').hidden = false;
    preview.hidden = false;
    startingLive = true;
    showStatus('פותח מצלמה… אשרו גישה אם הדפדפן מבקש.');
    let acquired;
    try {
      const reader = makeReader();
      acquired = await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
      if (!active(id) || liveEpoch !== epoch || document.hidden) { stopTracks(acquired); return; }
      stream = acquired;
      let misses = 0;
      const scanning = await reader.decodeFromStream(acquired, video, (result, error, scanControls) => {
        if (!active(id) || liveEpoch !== epoch) { scanControls?.stop(); return; }
        if (result) { receiveResult(result.getText(), id); return; }
        if (error && !BarcodeReader.isExpectedMiss(error)) {
          stopLive(); preview.hidden = true;
          showStatus(cameraError(new Error('DecoderStopped')), true);
          return;
        }
        if (++misses === 25) showStatus('הסריקה פעילה. השאירו שוליים לבנים מסביב לברקוד והחזיקו אותו ישר מול המצלמה. אפשר גם לצלם דרך הכפתור למטה.');
      });
      if (!active(id) || liveEpoch !== epoch || document.hidden) { scanning.stop(); stopTracks(acquired); return; }
      controls = scanning;
      startingLive = false;
      showStatus('כוונו לברקוד או ל־QR. לאחר הזיהוי המצלמה תיסגר והמוצר יתווסף לשורה.');
    } catch (error) {
      stopTracks(acquired);
      if (!active(id) || liveEpoch !== epoch) return;
      stopLive();
      preview.hidden = true;
      showStatus(cameraError(error), true);
    }
  }
  async function openScanner() {
    if (dialog.open || el('productsStep').hidden) return;
    const id = ++session;
    consumed = false;
    el('cameraPhoto').disabled = false;
    photoInput.value = '';
    dialog.showModal();
    await startLive(id);
  }
  el('scanProduct').addEventListener('click', openScanner);
  el('closeCameraScanner').addEventListener('click', closeScanner);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeScanner(); });
  dialog.addEventListener('close', releaseSession);
  el('retryCamera').addEventListener('click', () => startLive(session));
  el('cameraPhoto').addEventListener('click', () => {
    stopLive(); preview.hidden = true;
    showStatus('צלמו את הברקוד או בחרו תמונה ברורה שלו.');
    photoInput.value = '';
    photoInput.click();
  });
  photoInput.addEventListener('cancel', () => {
    if (dialog.open) showStatus('לא נבחרה תמונה. אפשר לנסות שוב או לחזור להזנת מק״ט.');
  });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0], id = session;
    if (!file || !active(id)) return;
    if (file.type && !file.type.startsWith('image/')) { showStatus('בחרו תמונה של הברקוד.', true); return; }
    stopLive(); preview.hidden = true;
    el('cameraPhoto').disabled = true;
    showStatus('מפענח את הברקוד בתמונה…');
    const url = URL.createObjectURL(file);
    try {
      const result = await makeReader().decodeFromImageUrl(url);
      await receiveResult(result.getText(), id);
    } catch (error) {
      if (active(id)) showStatus(error.message === 'ScannerUnavailable' ? cameraError(error) : 'לא זוהה ברקוד בתמונה. צלמו מקרוב, בתאורה טובה, כשהקוד כולו בתוך התמונה.', true);
    } finally {
      URL.revokeObjectURL(url);
      if (active(id)) { el('cameraPhoto').disabled = false; photoInput.value = ''; }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    const wasLive = Boolean(stream || controls || startingLive);
    stopLive();
    if (dialog.open && wasLive) showStatus('הסריקה הופסקה כשהיישום עבר לרקע. לחצו על ניסיון נוסף כדי להפעיל שוב את המצלמה.');
  });
  window.addEventListener('pagehide', releaseSession);
  const flowObserver = new MutationObserver(() => {
    if (dialog.open && (el('productsStep').hidden || el('invoiceScreen').hidden)) closeScanner();
  });
  flowObserver.observe(el('form'), {attributes:true,attributeFilter:['data-flow-step']});
  flowObserver.observe(el('invoiceScreen'), {attributes:true,attributeFilter:['hidden']});
})();
