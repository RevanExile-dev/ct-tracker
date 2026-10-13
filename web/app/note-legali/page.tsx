import type { Metadata } from "next";
import LegalPage, { Fill } from "@/components/LegalPage";
import { LEGAL_CONTACT_EMAIL, LEGAL_OWNER_ADDRESS, LEGAL_OWNER_NAME } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Note legali e non affiliazione",
  description: "CartaViva non è affiliata a The Pokémon Company, CardTrader, Cardmarket o TCGplayer. Contatti del titolare.",
};

export default function NoteLegaliPage() {
  return (
    <LegalPage title="Note legali e non affiliazione">
      <h2>Nessuna affiliazione</h2>
      <p>
        <strong>
          CartaViva è un progetto indipendente. Non è affiliata, sponsorizzata o approvata da The Pokémon
          Company International, Nintendo, Creatures Inc., GAME FREAK inc., CardTrader,
          Cardmarket o TCGplayer.
        </strong>
      </p>
      <p>
        Pokémon e i nomi dei Pokémon, delle carte e dei personaggi sono marchi e opere dei rispettivi
        titolari. Le immagini delle carte restano di proprietà dei loro autori e di The Pokémon Company e
        sono mostrate solo per identificare le carte. I nomi dei servizi citati (CardTrader, Cardmarket,
        TCGplayer) servono solo a indicare da dove provengono i dati e appartengono ai rispettivi
        titolari.
      </p>

      <h2>Origine dei dati</h2>
      <ul>
        <li>I prezzi e il catalogo vengono da CardTrader, tramite la loro interfaccia per sviluppatori.</li>
        <li>I prezzi di riferimento Cardmarket arrivano da TCGdex e sono solo indicativi.</li>
        <li>I prezzi sono ritardati e non vincolanti (vedi i <a href="/termini">Termini d&apos;uso</a>).</li>
      </ul>

      <h2>Titolare e contatti</h2>
      <p>
        Titolare: <Fill value={LEGAL_OWNER_NAME} />
        <br />
        Sede o indirizzo: <Fill value={LEGAL_OWNER_ADDRESS} />
        <br />
        Email: <Fill value={LEGAL_CONTACT_EMAIL} />
      </p>
      <p>
        Per segnalare un contenuto che ritieni violi i tuoi diritti, o per richieste sui tuoi dati,
        scrivi all&apos;email qui sopra: ti rispondiamo il prima possibile.
      </p>
    </LegalPage>
  );
}
