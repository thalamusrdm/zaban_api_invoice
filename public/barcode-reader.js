'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BarcodeReader=api;})(typeof window==='object'?window:this,function(){
 // DecodeHintType.TRY_HARDER = 3 in @zxing/library 0.23.0; the browser UMD does not export this enum.
 const TRY_HARDER=3;
 function create(zxing){
  if(typeof zxing?.BrowserMultiFormatReader!=='function')throw new Error('ScannerUnavailable');
  return new zxing.BrowserMultiFormatReader(new Map([[TRY_HARDER,true]]),{delayBetweenScanAttempts:180,delayBetweenScanSuccess:500});
 }
 function isExpectedMiss(error){
  const kind=typeof error?.getKind==='function'?error.getKind():error?.name;
  return ['NotFoundException','ChecksumException','FormatException'].includes(kind);
 }
 return {create,isExpectedMiss};
});
