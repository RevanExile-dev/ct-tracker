import type { Metadata } from "next";
import LegalPage, { Fill } from "@/components/LegalPage";
import { LEGAL_CONTACT_EMAIL, LEGAL_OWNER_ADDRESS, LEGAL_OWNER_NAME } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Informativa sulla privacy",
  description: "Quali dati raccoglie CartaViva, perché, per quanto tempo e come puoi chiederne la cancellazione.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Informativa sulla privacy">
      <p>
        Questa pagina spiega, in modo semplice, quali dati personali tratta CartaViva quando la usi
        (informativa ai sensi dell&apos;art. 13 del Regolamento UE 2016/679, GDPR).
      </p>

      <h2>Chi è il titolare</h2>
      <p>
        Titolare del trattamento: <Fill value={LEGAL_OWNER_NAME} />
        <br />
        Sede o indirizzo: <Fill value={LEGAL_OWNER_ADDRESS} />
        <br />
        Contatto per qualsiasi richiesta sui tuoi dati: <Fill value={LEGAL_CONTACT_EMAIL} />
      </p>

      <h2>Se usi il sito senza accedere</h2>
      <p>
        Puoi consultare catalogo, prezzi, movimenti e scanner senza creare un account. In questo caso
        non ci dai nessun dato: il sito non ti chiede nome né email e non usa strumenti di statistica o
        pubblicità. Come ogni sito, il tuo indirizzo IP viene visto dal servizio di hosting (Vercel) per
        far arrivare le pagine, e dal sito stesso per limitare le richieste eccessive (vedi
        &quot;Protezione dagli abusi&quot;).
      </p>

      <p>
        Il sito conserva anche i registri tecnici normali di un servizio online (per esempio indirizzo
        IP, pagina richiesta, tipo di browser), tenuti dal fornitore di hosting per sicurezza e
        funzionamento, per il tempo previsto dal fornitore stesso.
      </p>

      <h2>Se crei un account</h2>
      <p>Puoi accedere con Google oppure con un link inviato per email. I dati trattati sono:</p>
      <ul>
        <li>
          <strong>Dati dell&apos;account</strong>: indirizzo email e, se accedi con Google, nome e foto
          profilo che Google ci comunica, più l&apos;identificativo del tuo account Google. Servono per
          riconoscerti e farti ritrovare i tuoi dati su ogni dispositivo.
        </li>
        <li>
          <strong>Sessione di accesso</strong>: un codice che ti tiene collegato (vedi pagina Cookie).
        </li>
        <li>
          <strong>I tuoi contenuti</strong>: le carte del binder (con quantità, lingua, condizione,
          eventuali prezzi e date d&apos;acquisto che inserisci), i lotti, la lista desideri, i filtri
          salvati, il valore storico della collezione e gli allarmi prezzo.
        </li>
        <li>
          <strong>Telegram (facoltativo)</strong>: se colleghi il bot, conserviamo il numero della chat
          Telegram collegata e ti mandiamo i messaggi degli allarmi. Puoi scollegarlo quando vuoi dalla
          pagina Telegram del tuo account.
        </li>
      </ul>
      <p>
        <strong>Perché li usiamo e su quale base</strong>: per darti il servizio che hai richiesto
        (account, binder, allarmi): è l&apos;esecuzione del servizio che chiedi (art. 6.1.b GDPR). Non
        usiamo i tuoi dati per pubblicità, non li vendiamo e non facciamo profilazione.
      </p>

      <h2>Protezione dagli abusi</h2>
      <p>
        Per evitare che qualcuno sovraccarichi il sito o invii email di accesso in massa, il sito conta
        le richieste per indirizzo IP. Questi contatori restano in memoria o in una tabella del database
        per al massimo un&apos;ora e poi vengono cancellati. La base è l&apos;interesse legittimo a
        tenere il servizio sicuro e funzionante (art. 6.1.f GDPR).
      </p>

      <h2>Scanner e fotocamera</h2>
      <p>
        Se usi lo scanner, la fotocamera o le foto che scegli vengono elaborate nel tuo dispositivo:{" "}
        <strong>le immagini non vengono inviate né salvate sui nostri server</strong>. Il programma di
        lettura del testo (OCR) viene scaricato dal servizio jsDelivr (cdn.jsdelivr.net) solo quando
        apri lo scanner, quindi quel servizio vede il tuo indirizzo IP.
      </p>

      <h2>A chi arrivano i dati (fornitori)</h2>
      <ul>
        <li>
          <strong>Vercel Inc.</strong> (USA): ospita il sito e ne serve le pagine.
        </li>
        <li>
          <strong>Neon, Inc.</strong>: ospita il database dove stanno account e contenuti.
        </li>
        <li>
          <strong>Resend</strong> (USA): invia le email con il link di accesso; riceve il tuo indirizzo
          email solo se scegli l&apos;accesso via email.
        </li>
        <li>
          <strong>Google</strong>: solo se scegli &quot;Continua con Google&quot;; la tua foto profilo
          Google viene poi caricata dai server di Google (googleusercontent.com).
        </li>
        <li>
          <strong>Telegram</strong>: solo se colleghi il bot. I messaggi degli allarmi passano dai
          server di Telegram, che ha una propria informativa.
        </li>
        <li>
          <strong>CardTrader e la sua rete di distribuzione (CloudFront)</strong>: le immagini delle
          carte vengono caricate direttamente dal tuo browser dai loro server, che quindi vedono il tuo
          indirizzo IP, come per qualsiasi immagine su internet.
        </li>
        <li>
          <strong>jsDelivr</strong>: vedi sopra, solo per lo scanner.
        </li>
      </ul>
      <p>
        Alcuni di questi fornitori hanno sede negli Stati Uniti. Il trasferimento dei dati fuori
        dall&apos;Unione Europea avviene sulla base degli strumenti previsti dal GDPR (decisione di
        adeguatezza UE-USA per chi aderisce al Data Privacy Framework, oppure clausole contrattuali
        standard). Per i dettagli di ciascun fornitore vale la sua informativa.
      </p>

      <h2>Per quanto tempo conserviamo i dati</h2>
      <ul>
        <li>Account e contenuti: finché il tuo account esiste. Se ne chiedi la cancellazione li eliminiamo.</li>
        <li>Link di accesso per email: validi 15 minuti.</li>
        <li>Codice per collegare Telegram: valido 15 minuti.</li>
        <li>Contatori anti-abuso: al massimo un&apos;ora.</li>
        <li>
          Salvataggi di sicurezza del database e registri tecnici del fornitore di hosting seguono i
          tempi dei rispettivi fornitori.
        </li>
      </ul>

      <h2>I tuoi diritti</h2>
      <p>
        Puoi chiederci in ogni momento di accedere ai tuoi dati, correggerli, cancellarli, limitarne
        l&apos;uso, riceverne una copia in formato leggibile (portabilità) oppure opporti al
        trattamento. Per la cancellazione dell&apos;account scrivi a <Fill value={LEGAL_CONTACT_EMAIL} />{" "}
        dall&apos;indirizzo con cui ti sei registrato: eliminiamo account, binder, lotti, lista
        desideri, filtri, allarmi e collegamento Telegram. Puoi anche scollegare Telegram da solo, e
        togliere carte e lotti dal sito quando vuoi. Rispondiamo entro un mese. Se ci hai dato un
        consenso (per esempio al collegamento Telegram) puoi ritirarlo in qualsiasi momento.
      </p>
      <p>
        Se ritieni che i tuoi dati siano trattati male puoi presentare reclamo al Garante per la
        protezione dei dati personali (<a href="https://www.garanteprivacy.it" target="_blank" rel="noopener noreferrer">garanteprivacy.it</a>).
      </p>

      <h2>Età minima</h2>
      <p>
        Per creare un account devi avere almeno 14 anni (in Italia a questa età si può dare il
        consenso ai servizi online da soli). Sotto i 14 anni serve un genitore o chi ne fa le veci.
      </p>

      <h2>Modifiche</h2>
      <p>
        Se cambiano i dati che raccogliamo o i fornitori che usiamo, aggiorniamo questa pagina e la data
        in alto.
      </p>
    </LegalPage>
  );
}
