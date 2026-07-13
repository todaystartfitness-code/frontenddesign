import type { ClientRow, Env } from "../types";

import { getActiveBalance } from "../db";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function getMe(client: ClientRow): Promise<Response> {
  return jsonResponse({ client });
}

export async function getMyCredits(env: Env, client: ClientRow): Promise<Response> {
  const balance = await getActiveBalance(env.DB, client.id);

  const { results: ledger } = await env.DB.prepare(
    `SELECT l.sessions_remaining, l.expires_at, p.name as package_name
     FROM credit_ledger l
     JOIN packages p ON p.id = l.package_id
     WHERE l.client_id = ? AND l.sessions_remaining > 0 AND l.expires_at > unixepoch()
     ORDER BY l.expires_at ASC`,
  )
    .bind(client.id)
    .all();

  return jsonResponse({ balance, ledger: ledger ?? [] });
}
