import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signIn } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";

// Nota su "next-auth/lib/actions.js" (letto direttamente, non a memoria):
// signIn() senza redirectTo esplicito usa l'header Referer come pagina di
// arrivo dopo il login completato - qui sara' sempre "/login" (l'origine
// del form), che pero' va bene: il controllo "if (session) redirect('/')"
// qui sotto fa gia' il salto finale verso la home al render successivo,
// senza bisogno di passare redirectTo a mano per ciascun provider.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // auth() interroga Postgres (l'adapter serve anche solo a controllare se
  // esiste gia' una sessione), quindi puo' fallire se POSTGRES_URL/i
  // secret dell'account non sono ancora configurati - una finestra reale
  // tra "il codice e' mersato" e "le variabili d'ambiente sono impostate
  // su Vercel", non solo teorica (vedi lo stesso problema gia' risolto per
  // le colonne DB nuove in web/lib/db.ts). Senza questo try/catch
  // l'intera pagina andrebbe in errore invece di spiegare cosa manca.
  let session;
  try {
    session = await auth();
  } catch {
    return <LoginNotConfigured />;
  }
  if (session) redirect("/");
  const params = await searchParams;

  async function signInWithGoogle() {
    "use server";
    await signIn("google");
  }

  async function signInWithEmail(formData: FormData) {
    "use server";
    await signIn("resend", formData);
  }

  return (
    <main className="max-w-md mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />

      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-8"
      >
        ← Torna al catalogo
      </Link>

      <h2 className="font-display text-2xl font-bold text-ink-primary">Accedi</h2>
      <p className="text-ink-muted mt-1 mb-8">
        Il tuo binder, la lista desideri e i filtri salvati ti seguono su ogni dispositivo.
      </p>

      {params.error && (
        <div className="rounded-card border border-signal-down/30 bg-signal-down/5 text-signal-down p-4 text-sm mb-6">
          Accesso non riuscito. Riprova — se il problema continua, il link potrebbe essere scaduto.
        </div>
      )}

      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-3 min-h-12 rounded-card border border-base-border bg-base-surface text-ink-primary font-medium hover:border-accent/60 transition-colors active:scale-95"
        >
          <GoogleIcon />
          Continua con Google
        </button>
      </form>

      <div className="flex items-center gap-3 my-6 text-ink-faint text-xs font-mono uppercase tracking-wider">
        <div className="h-px flex-1 bg-base-border" />
        oppure
        <div className="h-px flex-1 bg-base-border" />
      </div>

      <form action={signInWithEmail} className="space-y-3">
        <label className="sr-only" htmlFor="login-email">Indirizzo email</label>
        <input
          id="login-email"
          type="email"
          name="email"
          required
          placeholder="tua@email.it"
          className="w-full bg-base-surface2 border border-base-border rounded-lg px-4 py-3 text-sm text-ink-primary placeholder:text-ink-faint outline-none focus:border-accent/60"
        />
        <button
          type="submit"
          className="w-full min-h-12 rounded-card border border-accent/60 bg-accent/10 text-accent-bright font-medium hover:bg-accent/15 transition-colors active:scale-95"
        >
          Invia link di accesso
        </button>
      </form>
    </main>
  );
}

function LoginNotConfigured() {
  return (
    <main className="max-w-md mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />
      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-8"
      >
        ← Torna al catalogo
      </Link>
      <h2 className="font-display text-2xl font-bold text-ink-primary">Accedi</h2>
      <div className="rounded-card border border-base-border bg-base-surface/55 text-ink-muted p-5 text-sm mt-6">
        L&apos;accesso non è ancora configurato su questo sito. Riprova più tardi.
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.92c1.7-1.57 2.68-3.88 2.68-6.64z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
