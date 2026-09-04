"use client";

import { SessionProvider } from "next-auth/react";

/** Wrapper minimo: SessionProvider stesso usa hook React (context), quindi
 * non puo' stare direttamente nel root layout (Server Component). */
export default function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
