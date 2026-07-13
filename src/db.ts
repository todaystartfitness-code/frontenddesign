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

export async function grantCredits(
  db: D1Database,
  params: {
    clientId: number;
    packageId: number;
    sessionsGranted: number;
    expirationDays: number;
    source: "purchase" | "manual_admin";
    note?: string;
    createdBy?: string;
  },
): Promise<number> {
  const now = nowSeconds();
  const expiresAt = now + params.expirationDays * 86400;

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
