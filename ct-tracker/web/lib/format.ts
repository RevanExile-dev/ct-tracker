export function formatCents(cents: number | null | undefined, currency = "EUR"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" }).format(
    new Date(iso)
  );
}

export function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "long", year: "numeric" }).format(
    new Date(iso)
  );
}

export function priceDeltaPct(latest: number | null, prev: number | null): number | null {
  if (!latest || !prev) return null;
  return ((latest - prev) / prev) * 100;
}
