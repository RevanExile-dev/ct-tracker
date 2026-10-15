// Il sito non usa piu' un service worker (public/sw.js e' solo lo script di
// pulizia). I test lo bloccano comunque: con un worker attivo page.route()
// non intercetterebbe piu' le richieste.
// Solo pwa-cleanup.spec.mjs lo riabilita per provare proprio la pulizia.
export default {
  use: { serviceWorkers: "block" },
};
