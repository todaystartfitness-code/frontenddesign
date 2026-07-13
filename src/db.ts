export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function getActiveBalance(db: D1Database, clientId: number): Promise<number> {
  const now = nowSeconds();
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(sessions_remaining), 0) as balance
       FROM credit_ledger
       WHERE client_id = ? AND sessions_remaining > 0 AND expires_at > ?`,
    )
    .bind(clientId, now)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

// The credit a booking should draw from: whichever active grant expires soonest.
export async function getSoonestExpiringLedger(
  db: D1Database,
  clientId: number,
): Promise<{ id: number; package_id: number } | null> {
  const now = nowSeconds();
  const row = await db
    .prepare(
      `SELECT id, package_id FROM credit_ledger
       WHERE client_id = ? AND sessions_remaining > 0 AND expires_at > ?
       ORDER BY expires_at ASC LIMIT 1`,
    )
    .bind(clientId, now)
    .first<{ id: number; package_id: number }>();
  return row ?? null;
}

export async function grantCredits(
  db: D1Database,
  params: {
    clientId: number;
    packageId: number;
    sessionsGranted: number;
    expirationDays: number;
    expiresAt?: number;
    source: "purchase" | "manual_admin";
    note?: string;
    createdBy?: string;
  },
): Promise<number> {
  const now = nowSeconds();
  const expiresAt = params.expiresAt ?? now + params.expirationDays * 86400;

  const result = await db
    .prepare(
      `INSERT INTO credit_ledger
        (client_id, package_id, source, sessions_granted, sessions_remaining, granted_at, expires_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.clientId,
      params.packageId,
      params.source,
      params.sessionsGranted,
      params.sessionsGranted,
      now,
      expiresAt,
      params.note ?? null,
    )
    .run();

  const ledgerId = result.meta.last_row_id as number;

  await db
    .prepare(
      `INSERT INTO credit_transactions (ledger_id, client_id, delta, reason, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(ledgerId, params.clientId, params.sessionsGranted, "grant", params.createdBy ?? null)
    .run();

  return ledgerId;
}

export async function adjustLedgerCredits(
  db: D1Database,
  params: { ledgerId: number; clientId: number; delta: number; reason: string; createdBy?: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE credit_ledger
       SET sessions_remaining = MAX(0, sessions_remaining + ?)
       WHERE id = ? AND client_id = ?`,
    )
    .bind(params.delta, params.ledgerId, params.clientId)
    .run();

  await db
    .prepare(
      `INSERT INTO credit_transactions (ledger_id, client_id, delta, reason, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(params.ledgerId, params.clientId, params.delta, params.reason, params.createdBy ?? null)
    .run();
}

// Zeroes out a ledger row's remaining balance (e.g. a mis-assigned package)
// without touching the sessions already deducted from it — those reflect
// real training that happened. The row (and its transaction history) stays
// for the audit trail; it just stops being drawable from.
export async function voidLedgerCredits(
  db: D1Database,
  params: { ledgerId: number; clientId: number; createdBy?: string },
): Promise<{ ok: boolean }> {
  const row = await db
    .prepare("SELECT sessions_remaining FROM credit_ledger WHERE id = ? AND client_id = ?")
    .bind(params.ledgerId, params.clientId)
    .first<{ sessions_remaining: number }>();

  if (!row) return { ok: false };
  if (row.sessions_remaining === 0) return { ok: true };

  await adjustLedgerCredits(db, {
    ledgerId: params.ledgerId,
    clientId: params.clientId,
    delta: -row.sessions_remaining,
    reason: "voided_by_admin",
    createdBy: params.createdBy,
  });

  return { ok: true };
}
