import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { EmailConfig } from "next-auth/providers/email";
import PostgresAdapter from "@auth/pg-adapter";
import { getPgPool } from "./pgPool";

// Provider email (magic link) scritto a mano invece di passare per
// l'helper Nodemailer/Email di next-auth: quegli helper si aspettano un
// trasporto SMTP (pacchetto "nodemailer" come dipendenza in piu'), mentre
// qui basta una singola chiamata HTTP all'API di Resend. La forma
// dell'oggetto (id/type/name/from/maxAge/sendVerificationRequest) e'
// quella richiesta da EmailConfig - verificata leggendo
// node_modules/@auth/core/providers/email.d.ts, non a memoria.
const resendEmailProvider: EmailConfig = {
  id: "resend",
  type: "email",
  name: "Email",
  from: process.env.AUTH_EMAIL_FROM ?? "CartaViva <onboarding@resend.dev>",
  // Il link scade dopo 15 minuti: abbastanza per un accesso normale,
  // abbastanza corto da limitare il danno se l'email finisse nelle mani
  // sbagliate.
  maxAge: 15 * 60,
  async sendVerificationRequest({ identifier, url, provider }) {
    const apiKey = process.env.AUTH_RESEND_KEY;
    if (!apiKey) {
      throw new Error("AUTH_RESEND_KEY non impostata: impossibile inviare l'email di accesso.");
    }
    // L'URL generato da Auth.js ha piu' parametri in query string separati
    // da "&" (callbackUrl/token/email) - un "&" grezzo dentro un attributo
    // HTML href="..." non e' HTML valido (andrebbe "&amp;") e puo' confondere
    // client email/filtri antispam che si aspettano entita' codificate.
    const escapedUrl = url.replace(/&/g, "&amp;");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: provider.from,
        to: identifier,
        subject: "Accedi a CartaViva",
        html: `
          <p>Clicca sul link qui sotto per accedere a CartaViva:</p>
          <p><a href="${escapedUrl}">${escapedUrl}</a></p>
          <p style="color:#888;font-size:13px">Il link scade tra 15 minuti. Se non hai richiesto questo accesso, ignora pure questa email — non e' stato creato nessun account.</p>
        `,
      }),
    });
    if (!res.ok) {
      throw new Error(`Invio email di accesso fallito (${res.status}): ${await res.text()}`);
    }
  },
};

const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  // Inizializzazione "lazy" (funzione invece di oggetto diretto): il pool
  // Postgres viene creato solo alla prima richiesta che tocca davvero
  // l'autenticazione, non ad ogni import di questo modulo - importante
  // perche' pagine che non toccano mai il login (es. il catalogo, che
  // legge solo cardtrader.db via sql.js) non devono richiedere
  // POSTGRES_URL per poter fare build/render.
  adapter: PostgresAdapter(getPgPool()),
  // Bastano i riferimenti ai provider (non chiamati con {...opzioni}):
  // next-auth deduce automaticamente clientId/clientSecret dalle variabili
  // AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (convenzione AUTH_{PROVIDER}_{ID|SECRET},
  // verificata in node_modules/next-auth/index.d.ts).
  providers: [Google, resendEmailProvider],
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
    // Auth.js ci porta qui in automatico subito dopo che
    // sendVerificationRequest ha inviato l'email (provider "resend") -
    // senza questa pagina dedicata userebbe quella di sistema, non in
    // italiano e fuori tema col resto del sito.
    verifyRequest: "/login/verifica",
  },
}));

export const { GET, POST } = handlers;
export { auth, signIn, signOut };
