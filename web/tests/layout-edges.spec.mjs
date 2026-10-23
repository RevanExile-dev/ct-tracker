import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// /account/delete aveva l'intestazione fuori dal contenitore: testo incollato al
// bordo sinistro e menu al bordo destro, su ogni schermo (16/10/2026, segnalato da
// Cri). Qui nessun testo delle pagine "di servizio" deve toccare il bordo
// (< 6px) ne' uscire dallo schermo, ne' deve esserci scroll orizzontale.
const PAGES = ["/account/delete", "/account/alerts", "/account/telegram", "/login", "/privacy", "/cookie", "/termini", "/note-legali", "/lots", "/wishlist"];
const SIZES = [
  { name: "telefono", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "PC", width: 1440, height: 900 },
];

for (const size of SIZES) {
  for (const path of PAGES) {
    test(`nessun testo sul bordo: ${path} (${size.name})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.route("**/api/auth/session", (route) =>
        route.fulfill({ status: 200, json: { user: { name: "Test", email: "test@example.test", id: "x" }, expires: "2099-01-01T00:00:00Z" } }));
      await page.goto(`${BASE_URL}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      const problems = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out = [];
        if (document.documentElement.scrollWidth > vw + 1) out.push(`scroll orizzontale ${document.documentElement.scrollWidth}>${vw}`);
        for (const el of document.querySelectorAll("body *")) {
          if (el.closest("footer, [aria-hidden=true], .sr-only")) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
          const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!hasText) continue;
          let p = el.parentElement, scroller = false;
          while (p && p !== document.body) {
            const o = getComputedStyle(p).overflowX;
            if (o === "auto" || o === "scroll" || o === "hidden") { scroller = true; break; }
            p = p.parentElement;
          }
          if (scroller) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || r.width >= vw - 2) continue;
          if (r.left < 6 || r.right > vw - 6) out.push(`<${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 40)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        return out;
      });
      expect(problems).toEqual([]);
    });
  }
}
