// I test non registrano il service worker (public/sw.js): con il worker
// attivo le richieste passano da lui e page.route() non le intercetta piu',
// quindi i test che simulano API o immagini rotte non funzionerebbero.
// Solo offline-pwa.spec.mjs lo riabilita per provare proprio quello.
export default {
  use: { serviceWorkers: "block" },
};
