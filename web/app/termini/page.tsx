import type { Metadata } from "next";
import LegalPage, { Fill } from "@/components/LegalPage";
import { LEGAL_CONTACT_EMAIL, LEGAL_OWNER_NAME } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Termini d'uso",
  description: "Le regole di utilizzo di CartaViva: servizio gratuito, prezzi indicativi, nessuna garanzia.",
};

export default function TerminiPage() {
  return (
    <LegalPage title="Termini d'uso">
      <p>
        Usando CartaViva accetti le regole qui sotto. Il servizio è offerto da{" "}
        <Fill value={LEGAL_OWNER_NAME} />.
      </p>

      <h2>Cos&apos;è CartaViva</h2>
      <p>
        Un sito gratuito per seguire i prezzi delle carte Pokémon TCG, tenere traccia della propria
        collezione (binder), impostare allarmi prezzo e consultare i dati senza obbligo di registrazione.
      </p>

      <h2>I prezzi sono indicativi</h2>
      <ul>
        <li>
          I prezzi provengono da fonti di terzi (in particolare CardTrader, più riferimenti
          Cardmarket) e arrivano con un certo ritardo: possono essere sbagliati, mancanti o non più
          validi quando li leggi.
        </li>
        <li>Non sono un&apos;offerta di vendita né una promessa di prezzo.</li>
        <li>
          Non sono un consiglio d&apos;acquisto, di vendita o di investimento. Prima di comprare o
          vendere controlla sempre il prezzo e la disponibilità sul sito del venditore.
        </li>
        <li>
          Il valore della collezione e le variazioni mostrate sono calcoli automatici a scopo
          informativo.
        </li>
      </ul>

      <h2>Allarmi e notifiche</h2>
      <p>
        Gli allarmi prezzo e i messaggi Telegram sono un aiuto, non una garanzia: possono arrivare in
        ritardo, non arrivare, o riferirsi a un prezzo già cambiato. Non fare affidamento solo su di
        essi per decisioni importanti.
      </p>

      <h2>Il tuo account</h2>
      <ul>
        <li>Devi avere almeno 14 anni, o il permesso di un genitore.</li>
        <li>Inserisci dati tuoi e veritieri; sei responsabile di ciò che inserisci e dell&apos;accesso alla tua email.</li>
        <li>Per tenere il servizio sostenibile ci sono limiti per account (per esempio sul numero di carte, lotti e allarmi); il sito te lo segnala quando li raggiungi.</li>
        <li>Puoi chiedere la cancellazione dell&apos;account in qualsiasi momento (vedi <a href="/privacy">Privacy</a>).</li>
      </ul>

      <h2>Cosa non puoi fare</h2>
      <ul>
        <li>Copiare in massa il catalogo o i prezzi con programmi automatici (scraping) o aggirare i limiti di richieste.</li>
        <li>Tentare di accedere ai dati di altri utenti, o di danneggiare o sovraccaricare il sito.</li>
        <li>Rivendere o ripubblicare i dati del sito come se fossero tuoi.</li>
      </ul>
      <p>
        Se non rispetti queste regole possiamo limitare o chiudere l&apos;account, avvisandoti quando
        possibile.
      </p>

      <h2>Nessuna garanzia, responsabilità limitata</h2>
      <p>
        Il servizio è offerto &quot;così com&apos;è&quot;, gratuitamente: può essere lento, interrotto
        o cambiare senza preavviso, e non garantiamo che i dati siano privi di errori. Non rispondiamo di
        perdite derivanti dall&apos;uso dei prezzi o dalla mancata ricezione di un allarme, nei limiti
        consentiti dalla legge. Resta fermo ciò che la legge non permette di escludere, compresi i tuoi
        diritti di consumatore.
      </p>

      <h2>Marchi, immagini e contenuti di terzi</h2>
      <p>
        Nomi, immagini e marchi delle carte appartengono ai rispettivi titolari. Vedi la pagina{" "}
        <a href="/note-legali">Note legali e non affiliazione</a>.
      </p>

      <h2>Modifiche, legge applicabile</h2>
      <p>
        Possiamo aggiornare questi termini; la data in alto indica l&apos;ultima versione. Si applica la
        legge italiana; se sei un consumatore restano validi i diritti e il foro previsti dalla legge a
        tua tutela.
      </p>
      <p>
        Contatti: <Fill value={LEGAL_CONTACT_EMAIL} />
      </p>
    </LegalPage>
  );
}
