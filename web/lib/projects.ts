"use client";

/** Client dei progetti di desideri (API in web/app/api/account/projects).
 * Solo per chi ha fatto login: i progetti vivono nell'account. */
export interface WishlistProject {
  id: string;
  name: string;
  cardIds: number[];
}

async function errorOf(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error ?? `Errore ${res.status}`);
}

export async function fetchProjects(): Promise<WishlistProject[]> {
  const res = await fetch("/api/account/projects");
  if (!res.ok) throw await errorOf(res);
  return res.json();
}

export async function createProject(name: string): Promise<WishlistProject> {
  const res = await fetch("/api/account/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await errorOf(res);
  return res.json();
}

export async function renameProject(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/account/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await errorOf(res);
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/account/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw await errorOf(res);
}

export async function addCardToProject(projectId: string, cardId: number): Promise<void> {
  const res = await fetch(`/api/account/projects/${projectId}/cards/${cardId}`, { method: "PUT" });
  if (!res.ok) throw await errorOf(res);
}

export async function removeCardFromProject(projectId: string, cardId: number): Promise<void> {
  const res = await fetch(`/api/account/projects/${projectId}/cards/${cardId}`, { method: "DELETE" });
  if (!res.ok) throw await errorOf(res);
}

interface PricedCard {
  id: number;
  best_price_cents?: number | null;
  latest_price_cents?: number | null;
}

/** Quanto manca a completare un progetto: le carte che hai gia' nel binder
 * non contano. Stesso prezzo mostrato sulla lista desideri (best, poi
 * ultimo); le carte senza prezzo non entrano nel totale e vengono contate. */
export function projectTotals(cards: PricedCard[], ownedIds: Set<number>) {
  let cents = 0;
  let missing = 0;
  let unpriced = 0;
  let owned = 0;
  for (const c of cards) {
    if (ownedIds.has(c.id)) { owned += 1; continue; }
    missing += 1;
    const p = c.best_price_cents ?? c.latest_price_cents;
    if (p && p > 0) cents += p;
    else unpriced += 1;
  }
  return { cents, missing, unpriced, owned };
}
