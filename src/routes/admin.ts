import type { ClientRow, Env, PackageRow } from "../types";
import { getActiveBalance, grantCredits, adjustLedgerCredits, voidLedgerCredits } from "../db";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Packages ---------------------------------------------------------

export async function listPackages(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM credit_ledger l
       WHERE l.package_id = p.id AND l.sessions_remaining > 0 AND l.expires_at > unixepoch()
      ) as active_grants
     FROM packages p
     ORDER BY archived ASC, is_drop_in ASC, price_cents ASC`,
  ).all<PackageRow & { active_grants: number }>();
  return jsonResponse({ packages: results });
}

export async function createPackage(request: Request, env: Env): Promise<Response> {
  const body = await request.json<Partial<PackageRow>>().catch(() => ({}) as Partial<PackageRow>);
  const { name, session_count, price_cents, expiration_days } = body;

  if (
    !name ||
    typeof session_count !== "number" ||
    typeof price_cents !== "number" ||
    typeof expiration_days !== "number"
  ) {
    return jsonResponse(
      { error: "name, session_count, price_cents, and expiration_days are required." },
      400,
    );
  }

  const isDropIn = body.is_drop_in ? 1 : 0;

  const result = await env.DB.prepare(
    `INSERT INTO packages (name, session_count, price_cents, expiration_days, is_drop_in)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(name, session_count, price_cents, expiration_days, isDropIn)
    .run();

  return jsonResponse({ id: result.meta.last_row_id }, 201);
}

export async function updatePackage(
  request: Request,
  env: Env,
  packageId: number,
): Promise<Response> {
  const body = await request.json<Partial<PackageRow>>().catch(() => ({}) as Partial<PackageRow>);
  const existing = await env.DB.prepare("SELECT * FROM packages WHERE id = ?")
    .bind(packageId)
    .first<PackageRow>();

  if (!existing) {
    return jsonResponse({ error: "Package not found." }, 404);
  }

  const next = {
    name: body.name ?? existing.name,
    session_count: body.session_count ?? existing.session_count,
    price_cents: body.price_cents ?? existing.price_cents,
    expiration_days: body.expiration_days ?? existing.expiration_days,
    is_drop_in: body.is_drop_in !== undefined ? (body.is_drop_in ? 1 : 0) : existing.is_drop_in,
    archived: body.archived !== undefined ? (body.archived ? 1 : 0) : existing.archived,
  };

  await env.DB.prepare(
    `UPDATE packages
     SET name = ?, session_count = ?, price_cents = ?, expiration_days = ?, is_drop_in = ?, archived = ?, updated_at = unixepoch()
     WHERE id = ?`,
  )
    .bind(
      next.name,
      next.session_count,
      next.price_cents,
      next.expiration_days,
      next.is_drop_in,
      next.archived,
      packageId,
    )
    .run();

  return jsonResponse({ ok: true });
}

// --- Clients ------------------------------------------------------------

export async function listClients(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM clients WHERE role = 'client' ORDER BY created_at DESC",
  ).all<ClientRow>();

  const clients = await Promise.all(
    (results ?? []).map(async (c) => ({
      ...c,
      balance: await getActiveBalance(env.DB, c.id),
    })),
  );

  return jsonResponse({ clients });
}

export async function createClient(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{ email?: string; name?: string; phone?: string }>()
    .catch(() => ({}) as { email?: string; name?: string; phone?: string });
  const email = body.email?.trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return jsonResponse({ error: "A valid email is required." }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM clients WHERE email = ?")
    .bind(email)
    .first();
  if (existing) {
    return jsonResponse({ error: "A client with that email already exists." }, 409);
  }

  const result = await env.DB.prepare(
    "INSERT INTO clients (email, name, phone, role) VALUES (?, ?, ?, 'client')",
  )
    .bind(email, body.name ?? null, body.phone ?? null)
    .run();

  return jsonResponse({ id: result.meta.last_row_id }, 201);
}

export async function grantClientCredits(
  request: Request,
  env: Env,
  clientId: number,
): Promise<Response> {
  const body = await request
    .json<{ package_id?: number; sessions?: number; note?: string; expires_on?: string }>()
    .catch(
      () => ({}) as { package_id?: number; sessions?: number; note?: string; expires_on?: string },
    );

  if (!body.package_id) {
    return jsonResponse({ error: "package_id is required." }, 400);
  }

  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ? AND role = 'client'")
    .bind(clientId)
    .first<ClientRow>();
  if (!client) {
    return jsonResponse({ error: "Client not found." }, 404);
  }

  const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ?")
    .bind(body.package_id)
    .first<PackageRow>();
  if (!pkg) {
    return jsonResponse({ error: "Package not found." }, 404);
  }

  let expiresAt: number | undefined;
  if (body.expires_on) {
    const parsed = Date.parse(`${body.expires_on}T23:59:59Z`);
    if (Number.isNaN(parsed)) {
      return jsonResponse({ error: "expires_on must be a valid date (YYYY-MM-DD)." }, 400);
    }
    expiresAt = Math.floor(parsed / 1000);
  }

  const ledgerId = await grantCredits(env.DB, {
    clientId,
    packageId: pkg.id,
    sessionsGranted: body.sessions ?? pkg.session_count,
    expirationDays: pkg.expiration_days,
    expiresAt,
    source: "manual_admin",
    note: body.note,
    createdBy: "admin",
  });

  return jsonResponse({ ledgerId }, 201);
}

export async function voidClientCredit(
  env: Env,
  clientId: number,
  ledgerId: number,
): Promise<Response> {
  const result = await voidLedgerCredits(env.DB, {
    ledgerId,
    clientId,
    createdBy: "admin",
  });

  if (!result.ok) {
    return jsonResponse({ error: "Credit grant not found." }, 404);
  }

  return jsonResponse({ ok: true });
}

export async function adjustClientCredits(
  request: Request,
  env: Env,
  clientId: number,
): Promise<Response> {
  const body = await request
    .json<{ ledger_id?: number; delta?: number; reason?: string }>()
    .catch(() => ({}) as { ledger_id?: number; delta?: number; reason?: string });

  if (!body.ledger_id || typeof body.delta !== "number" || !body.reason) {
    return jsonResponse({ error: "ledger_id, delta, and reason are required." }, 400);
  }

  await adjustLedgerCredits(env.DB, {
    ledgerId: body.ledger_id,
    clientId,
    delta: body.delta,
    reason: body.reason,
    createdBy: "admin",
  });

  return jsonResponse({ ok: true });
}

export async function getClientDetail(env: Env, clientId: number): Promise<Response> {
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ? AND role = 'client'")
    .bind(clientId)
    .first<ClientRow>();
  if (!client) {
    return jsonResponse({ error: "Client not found." }, 404);
  }

  const { results: ledger } = await env.DB.prepare(
    `SELECT l.*, p.name as package_name
     FROM credit_ledger l
     JOIN packages p ON p.id = l.package_id
     WHERE l.client_id = ?
     ORDER BY l.expires_at ASC`,
  )
    .bind(clientId)
    .all();

  return jsonResponse({
    client,
    balance: await getActiveBalance(env.DB, clientId),
    ledger: ledger ?? [],
  });
}
