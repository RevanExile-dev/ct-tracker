import "server-only";
import { getPgPool } from "./pgPool";
import {
  AccountLimitError, MAX_PROJECT_CARDS, MAX_PROJECT_NAME_LENGTH, MAX_WISHLIST_PROJECTS, limitMessage,
} from "./accountLimits";

// Progetti di desideri: sottocartelle della lista desideri (es. "completare
// un binder"). Tabelle wishlist_projects / wishlist_project_cards in
// web/db/schema.sql. Ogni funzione filtra SEMPRE per user_id: un id di
// progetto di un altro utente non trova mai niente.

export interface WishlistProject {
  id: string;
  name: string;
  cardIds: number[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidProjectId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Nome pulito (spazi ridotti) o null se vuoto/troppo lungo. */
export function cleanProjectName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= MAX_PROJECT_NAME_LENGTH ? name : null;
}

export async function listProjects(userId: string): Promise<WishlistProject[]> {
  const { rows } = await getPgPool().query(
    `SELECT p.id, p.name,
            COALESCE(array_agg(c.blueprint_id ORDER BY c.added_at) FILTER (WHERE c.blueprint_id IS NOT NULL), '{}') AS card_ids
     FROM wishlist_projects p
     LEFT JOIN wishlist_project_cards c ON c.project_id = p.id
     WHERE p.user_id = $1
     GROUP BY p.id
     ORDER BY p.created_at`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, cardIds: r.card_ids as number[] }));
}

export async function createProject(userId: string, name: string): Promise<WishlistProject> {
  const pool = getPgPool();
  const { rows: count } = await pool.query("SELECT count(*)::int AS n FROM wishlist_projects WHERE user_id = $1", [userId]);
  if (count[0].n >= MAX_WISHLIST_PROJECTS) throw new AccountLimitError(limitMessage("progetti", MAX_WISHLIST_PROJECTS));
  const { rows } = await pool.query(
    "INSERT INTO wishlist_projects (user_id, name) VALUES ($1, $2) RETURNING id, name",
    [userId, name],
  );
  return { id: rows[0].id, name: rows[0].name, cardIds: [] };
}

/** false se il progetto non esiste o non e' dell'utente. */
export async function renameProject(userId: string, projectId: string, name: string): Promise<boolean> {
  const { rowCount } = await getPgPool().query(
    "UPDATE wishlist_projects SET name = $3 WHERE id = $2 AND user_id = $1",
    [userId, projectId, name],
  );
  return (rowCount ?? 0) > 0;
}

/** Elimina SOLO il progetto scelto dall'utente (e le sue righe carta, via
 * CASCADE): la lista desideri e il binder non si toccano. */
export async function deleteProject(userId: string, projectId: string): Promise<boolean> {
  const { rowCount } = await getPgPool().query(
    "DELETE FROM wishlist_projects WHERE id = $2 AND user_id = $1",
    [userId, projectId],
  );
  return (rowCount ?? 0) > 0;
}

/** false se il progetto non e' dell'utente. Aggiungere due volte la stessa
 * carta non fa nulla; il tetto blocca solo le carte nuove. */
export async function addProjectCard(userId: string, projectId: string, blueprintId: number): Promise<boolean> {
  const pool = getPgPool();
  const { rows: owned } = await pool.query("SELECT 1 FROM wishlist_projects WHERE id = $2 AND user_id = $1", [userId, projectId]);
  if (!owned.length) return false;
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n, count(*) FILTER (WHERE blueprint_id = $2)::int AS has FROM wishlist_project_cards WHERE project_id = $1",
    [projectId, blueprintId],
  );
  if (!rows[0].has && rows[0].n >= MAX_PROJECT_CARDS) {
    throw new AccountLimitError(limitMessage("carte in un progetto", MAX_PROJECT_CARDS));
  }
  await pool.query(
    "INSERT INTO wishlist_project_cards (project_id, blueprint_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [projectId, blueprintId],
  );
  return true;
}

export async function removeProjectCard(userId: string, projectId: string, blueprintId: number): Promise<boolean> {
  const { rowCount } = await getPgPool().query(
    `DELETE FROM wishlist_project_cards c USING wishlist_projects p
     WHERE c.project_id = p.id AND p.user_id = $1 AND p.id = $2 AND c.blueprint_id = $3`,
    [userId, projectId, blueprintId],
  );
  return (rowCount ?? 0) > 0;
}
