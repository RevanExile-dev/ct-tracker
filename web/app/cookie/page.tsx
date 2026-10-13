import type { Metadata } from "next";
import LegalPage, { Fill } from "@/components/LegalPage";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Cookie e memoria del browser",
  description: "Quali cookie e quali dati salvati nel browser usa CartaViva.",
};

export default function CookiePage() {
  return (
    <LegalPage title="Cookie e memoria del browser">
      <p>
        CartaViva usa <strong>solo strumenti tecnici</strong>, cioè necessari al funzionamento del sito.
        Per questo <strong>non mostra il banner dei cookie</strong>: non serve il tuo consenso per
        strumenti di questo tipo (linee guida del Garante privacy del 10 giugno 2021). Non usiamo cookie
        di statistica, di pubblicità o di profilazione, né nostri né di terzi.
      </p>

      <h2>Cookie</h2>
      <p>Compaiono solo se accedi o provi ad accedere (nomi dati dalla libreria di accesso Auth.js):</p>
      <ul>
        <li>
          <strong>authjs.session-token</strong>: ti tiene collegato dopo l&apos;accesso. Si cancella
          quando esci dall&apos;account o alla scadenza della sessione.
        </li>
        <li>
          <strong>authjs.csrf-token</strong> e <strong>authjs.callback-url</strong>: proteggono il modulo
          di accesso da richieste false e ricordano a quale pagina tornare.
        </li>
        <li>
          Cookie temporanei di verifica (<strong>pkce</strong>, <strong>state</strong>,{" "}
          <strong>nonce</strong>) durante l&apos;accesso con Google: durano pochi minuti.
        </li>
      </ul>

      <h2>Memoria del browser (localStorage e sessionStorage)</h2>
      <p>
        Il sito salva nel tuo browser, senza mandarli a nessuno finché non accedi, alcune preferenze per
        farti ritrovare le cose come le hai lasciate:
      </p>
      <ul>
        <li>il tuo binder, la lista desideri e i filtri salvati (anche senza account: restano solo su questo dispositivo);</li>
        <li>la posizione di scorrimento della pagina, per tornare dove eri (sessionStorage, si svuota alla chiusura della scheda).</li>
      </ul>
      <p>
        Se accedi, binder, lista desideri e filtri vengono uniti con quelli del tuo account (vedi{" "}
        <a href="/privacy">Privacy</a>). Puoi cancellare questi dati dalle impostazioni del browser,
        alla voce &quot;dati dei siti&quot;.
      </p>

      <h2>Servizi di terzi</h2>
      <p>
        Il sito non incorpora widget, video o script di terzi che impostano cookie. Le immagini delle
        carte arrivano dai server di CardTrader/CloudFront e lo scanner scarica il lettore di testo da
        jsDelivr: sono richieste di file, che non usiamo per tracciarti, ma quei server vedono il tuo
        indirizzo IP (vedi <a href="/privacy">Privacy</a>).
      </p>

      <h2>Se un giorno cambia</h2>
      <p>
        Se in futuro aggiungessimo statistiche di visita, pubblicità o altri strumenti non tecnici,
        chiederemo prima il tuo consenso con un banner e aggiorneremo questa pagina.
      </p>
      <p>
        Domande: <Fill value={LEGAL_CONTACT_EMAIL} />
      </p>
    </LegalPage>
  );
}
