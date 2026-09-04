import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";

// pages.verifyRequest in lib/auth.ts: Auth.js ci porta qui in automatico
// subito dopo aver inviato l'email con il link di accesso (provider
// "resend", type "email") - non e' collegata a mano da nessun form.
export default function VerifyRequestPage() {
  return (
    <main className="max-w-md mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />

      <h2 className="font-display text-2xl font-bold text-ink-primary">Controlla la tua email</h2>
      <p className="text-ink-muted mt-3">
        Ti abbiamo inviato un link di accesso. Controlla la posta (anche lo spam) — il link scade tra 15 minuti.
      </p>

      <Link
        href="/"
        className="text-sm text-accent-bright hover:text-accent transition-colors inline-flex items-center gap-1.5 mt-8"
      >
        ← Torna al catalogo
      </Link>
    </main>
  );
}
