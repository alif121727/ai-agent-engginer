// Service worker hanya untuk app shell; video tetap diambil dari jaringan.
// Berkas terpisah (bukan inline) supaya CSP `script-src 'self'` tidak memblokirnya.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
