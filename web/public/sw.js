/* Script di pulizia: l'app offline (service worker) e' stata tolta il
 * 15/10/2026. Chi aveva il vecchio worker installato riceve questo file alla
 * visita successiva: svuota le cache e si disinstalla. Non ha un gestore
 * "fetch", quindi non intercetta nessuna richiesta (le immagini e le pagine
 * passano sempre dalla rete). Il sito non lo registra piu'. */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("cv-")).map((n) => caches.delete(n)));
      await self.registration.unregister();
    })()
  );
});
