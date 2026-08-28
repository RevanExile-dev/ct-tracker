"use client";

import { useEffect, useMemo, useState } from "react";
import { CardRow, fetchCards, fetchExpansions, fetchMeta } from "@/lib/db";
import CardTile from "@/components/CardTile";
import Toolbar from "@/components/Toolbar";
import SiteHeader from "@/components/SiteHeader";

export default function Home() {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [expansions, setExpansions] = useState<{ code: string; name: string }[]>([]);
  const [lastSync, setLastSync] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [expansionCode, setExpansionCode] = useState("");
  const [onlyPremium, setOnlyPremium] = useState(false);

  useEffect(() => {
    fetchCards({})
      .then(setCards)
      .catch((e) => setError(String(e.message ?? e)));
    fetchExpansions().then(setExpansions).catch(() => {});
    fetchMeta()
      .then((m) => setLastSync(m["last_price_sync"]))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!cards) return null;
    return cards.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (expansionCode && c.expansion_code !== expansionCode) return false;
      if (onlyPremium && c.is_premium !== 1) return false;
      return true;
    });
  }, [cards, search, expansionCode, onlyPremium]);

  return (
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <SiteHeader lastSync={lastSync} />

      <Toolbar
        search={search}
        onSearch={setSearch}
        expansions={expansions}
        expansionCode={expansionCode}
        onExpansionChange={setExpansionCode}
        onlyPremium={onlyPremium}
        onTogglePremium={() => setOnlyPremium((v) => !v)}
      />

      {error && (
        <div className="mt-8 rounded-card border border-signal-down/30 bg-signal-down/5 text-signal-down p-5 font-mono text-sm">
          {error}
          <div className="text-ink-muted mt-2 font-body">
            Verifica che il workflow &quot;Sync prezzi&quot; sia già stato eseguito almeno una
            volta e che il file sia stato copiato in{" "}
            <code className="text-ink-primary">web/public/data/cardtrader.db</code>.
          </div>
        </div>
      )}

      {!cards && !error && (
        <div className="mt-16 text-center text-ink-muted font-mono text-sm animate-pulse">
          Carico il database locale…
        </div>
      )}

      {filtered && filtered.length === 0 && (
        <div className="mt-16 text-center text-ink-muted">
          Nessuna carta trovata. Prova a modificare la ricerca o i filtri.
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5 mt-8">
          {filtered.map((card) => (
            <CardTile key={card.id} card={card} />
          ))}
        </div>
      )}
    </main>
  );
}
