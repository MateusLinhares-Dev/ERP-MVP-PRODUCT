(function(global){
  'use strict';
  // Unicode is preserved as UTF-8 by encodeURIComponent at the single URL boundary.
  // Remove decorative pictograms from business messages, not names or financial data.
  function formatBusinessText(message){
    return String(message==null?'':message)
      .normalize('NFC')
      .replace(/\r\n?/g,'\n')
      .replace(/[\uFE0E\uFE0F\u200D\u20E3]/g,'')
      .replace(/\p{Extended_Pictographic}/gu,'')
      .replace(/[━═]{4,}/g,'--------------------------------')
      .replace(/^[ \t]*[▸•][ \t]*/gm,'- ')
      .replace(/[ \t]+\n/g,'\n')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  }
  global.erpWhatsFormat=formatBusinessText;
})(window);
