import type { ClientRow, Env, Role } from "./types";

const MAGIC_LINK_TTL_SECONDS = 15 * 60;
// 6 months: regular clients should essentially never see the login screen
// again on a device they've used before.
const SESSION_TTL_SECONDS = 180 * 24 * 60 * 60;

export const AUDIENCE_COOKIE: Record<"app" | "admin", string> = {
  app: "fs_app_session",
  admin: "fs_admin_session",
};

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) =>
    c === "+" ? "-" : c === "/" ? "_" : "",
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type LoginChannel = "email" | "phone";

// `identifier` is an email address or an E.164 phone number, depending on
// `channel` — stored in the same column either way (see migration 0006).
export async function createMagicLinkToken(
  db: D1Database,
  identifier: string,
  audience: "app" | "admin",
  channel: LoginChannel = "email",
): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_LINK_TTL_SECONDS;
  const value = channel === "email" ? identifier.toLowerCase() : identifier;
  await db
    .prepare(
      "INSERT INTO magic_link_tokens (email, audience, channel, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(value, audience, channel, tokenHash, expiresAt)
    .run();
  return token;
}

export async function verifyMagicLinkToken(
  db: D1Database,
  rawToken: string,
  audience: "app" | "admin",
): Promise<{ identifier: string; channel: LoginChannel } | null> {
  const tokenHash = await sha256Hex(rawToken);
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      "SELECT id, email, channel, expires_at, used_at FROM magic_link_tokens WHERE token_hash = ? AND audience = ?",
    )
    .bind(tokenHash, audience)
    .first<{
      id: number;
      email: string;
      channel: LoginChannel;
      expires_at: number;
      used_at: number | null;
    }>();

  if (!row || row.used_at !== null || row.expires_at < now) {
    return null;
  }

  await db
    .prepare("UPDATE magic_link_tokens SET used_at = ? WHERE id = ?")
    .bind(now, row.id)
    .run();

  return { identifier: row.email, channel: row.channel };
}

export async function createSession(db: D1Database, clientId: number): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await db
    .prepare(
      "INSERT INTO login_sessions (client_id, session_token_hash, expires_at) VALUES (?, ?, ?)",
    )
    .bind(clientId, tokenHash, expiresAt)
    .run();
  return token;
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie");
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export async function getSessionClient(
  env: Env,
  request: Request,
  audience: "app" | "admin",
): Promise<ClientRow | null> {
  const cookies = parseCookies(request);
  const token = cookies[AUDIENCE_COOKIE[audience]];
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT c.id, c.email, c.phone, c.name, c.role, c.created_at
     FROM login_sessions s
     JOIN clients c ON c.id = s.client_id
     WHERE s.session_token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<ClientRow>();

  if (!row) return null;
  if (audience === "admin" && row.role !== "admin") return null;
  return row;
}

export function sessionCookieHeader(
  audience: "app" | "admin",
  token: string,
): string {
  // Path=/ (not /admin or /app) so the cookie also reaches /api/admin/* and
  // /api/me* — the two audiences stay isolated by cookie name, not path.
  return `${AUDIENCE_COOKIE[audience]}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieHeader(audience: "app" | "admin"): string {
  return `${AUDIENCE_COOKIE[audience]}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function requireRole(client: ClientRow | null, role: Role): client is ClientRow {
  return client !== null && client.role === role;
}
