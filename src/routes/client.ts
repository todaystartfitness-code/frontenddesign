import type { ClientRow, Env, PackageRow, SessionRow } from "../types";

import { adjustLedgerCredits, getActiveBalance, getSoonestExpiringLedger, nowSeconds } from "../db";
import { computeAvailableSlots, getSettings, isSlotAvailable } from "../availability";
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "../google";

// Calendar mirroring is best-effort: a Google hiccup shouldn't lose a
// booking that's already validated and stored. Conflicts are prevented at
// availability-check time (which does fail closed), not at mirror time.
async function mirrorCreate(
  env: Env,
  sessionId: number,
  startsAt: number,
  endsAt: number,
  clientLabel: string,
): Promise<void> {
  try {
    const eventId = await createCalendarEvent(env, { startsAt, endsAt, clientLabel });
    if (eventId) {
      await env.DB.prepare("UPDATE sessions SET google_event_id = ? WHERE id = ?")
        .bind(eventId, sessionId)
        .run();
    }
  } catch (err) {
    console.error("Google Calendar event create failed:", err);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

async function getClientSessionDuration(
  env: Env,
  clientId: number,
): Promise<{ ledgerId: number; durationMinutes: number } | null> {
  const ledger = await getSoonestExpiringLedger(env.DB, clientId);
  if (!ledger) return null;
  const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ?")
    .bind(ledger.package_id)
    .first<PackageRow>();
  if (!pkg) return null;
  return { ledgerId: ledger.id, durationMinutes: pkg.session_duration_minutes };
}

export async function getAvailability(
  env: Env,
  client: ClientRow,
  dateStr: string | null,
  rescheduleSessionId: string | null,
): Promise<Response> {
  if (!dateStr || !DATE_RE.test(dateStr)) {
    return jsonResponse({ error: "date (YYYY-MM-DD) is required." }, 400);
  }

  // Rescheduling uses the original session's own duration (it can't change
  // package mid-reschedule) and excludes that session's own current time
  // from blocking, so nearby slots don't look unavailable against itself.
  let durationMinutes: number;
  let excludeSessionId: number | undefined;

  if (rescheduleSessionId) {
    const session = await env.DB.prepare(
      "SELECT * FROM sessions WHERE id = ? AND client_id = ? AND status = 'booked'",
    )
      .bind(Number(rescheduleSessionId), client.id)
      .first<SessionRow>();
    if (!session) return jsonResponse({ error: "Session not found." }, 404);
    durationMinutes = session.duration_minutes;
    excludeSessionId = session.id;
  } else {
    const credit = await getClientSessionDuration(env, client.id);
    if (!credit) {
      return jsonResponse({
        slots: [],
        duration_minutes: null,
        message: "You have no active session credits. Contact your trainer to purchase or renew a package.",
      });
    }
    durationMinutes = credit.durationMinutes;
  }

  const slots = await computeAvailableSlots(
    env,
    dateStr,
    durationMinutes,
    nowSeconds(),
    excludeSessionId,
  );
  return jsonResponse({ slots, duration_minutes: durationMinutes });
}

export async function bookSession(request: Request, env: Env, client: ClientRow): Promise<Response> {
  const body = await request.json<{ starts_at?: number }>().catch(() => ({}) as { starts_at?: number });
  if (typeof body.starts_at !== "number") {
    return jsonResponse({ error: "starts_at is required." }, 400);
  }

  const credit = await getClientSessionDuration(env, client.id);
  if (!credit) {
    return jsonResponse({ error: "You have no active session credits." }, 400);
  }

  const startsAt = body.starts_at;
  const endsAt = startsAt + credit.durationMinutes * 60;

  if (startsAt < nowSeconds()) {
    return jsonResponse({ error: "That time has already passed." }, 400);
  }

  const available = await isSlotAvailable(env, startsAt, endsAt);
  if (!available) {
    return jsonResponse({ error: "That time is no longer available. Please pick another slot." }, 409);
  }

  const result = await env.DB.prepare(
    `INSERT INTO sessions (client_id, ledger_id, starts_at, ends_at, duration_minutes, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'booked', 'client')`,
  )
    .bind(client.id, credit.ledgerId, startsAt, endsAt, credit.durationMinutes)
    .run();

  await adjustLedgerCredits(env.DB, {
    ledgerId: credit.ledgerId,
    clientId: client.id,
    delta: -1,
    reason: "session_booked",
    createdBy: "client",
  });

  await mirrorCreate(
    env,
    result.meta.last_row_id as number,
    startsAt,
    endsAt,
    client.name || client.email,
  );

  return jsonResponse({ id: result.meta.last_row_id }, 201);
}

export async function getMySessions(env: Env, client: ClientRow): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM sessions WHERE client_id = ? ORDER BY starts_at DESC LIMIT 50`,
  )
    .bind(client.id)
    .all<SessionRow>();
  return jsonResponse({ sessions: results ?? [] });
}

async function loadOwnBookedSession(
  env: Env,
  client: ClientRow,
  sessionId: number,
): Promise<SessionRow | null> {
  const session = await env.DB.prepare(
    "SELECT * FROM sessions WHERE id = ? AND client_id = ? AND status = 'booked'",
  )
    .bind(sessionId, client.id)
    .first<SessionRow>();
  return session ?? null;
}

async function isOutsideRescheduleWindow(env: Env, session: SessionRow): Promise<boolean> {
  const settings = await getSettings(env.DB);
  return session.starts_at - nowSeconds() > settings.rescheduleWindowHours * 3600;
}

export async function rescheduleMySession(
  request: Request,
  env: Env,
  client: ClientRow,
  sessionId: number,
): Promise<Response> {
  const session = await loadOwnBookedSession(env, client, sessionId);
  if (!session) return jsonResponse({ error: "Session not found." }, 404);

  if (!(await isOutsideRescheduleWindow(env, session))) {
    return jsonResponse(
      { error: "This session is too soon to self-reschedule. Please contact your trainer directly." },
      403,
    );
  }

  const body = await request.json<{ starts_at?: number }>().catch(() => ({}) as { starts_at?: number });
  if (typeof body.starts_at !== "number") {
    return jsonResponse({ error: "starts_at is required." }, 400);
  }

  const newStartsAt = body.starts_at;
  const newEndsAt = newStartsAt + session.duration_minutes * 60;

  if (newStartsAt < nowSeconds()) {
    return jsonResponse({ error: "That time has already passed." }, 400);
  }

  const available = await isSlotAvailable(env, newStartsAt, newEndsAt, session.id);
  if (!available) {
    return jsonResponse({ error: "That time is no longer available. Please pick another slot." }, 409);
  }

  await env.DB.prepare("UPDATE sessions SET starts_at = ?, ends_at = ? WHERE id = ?")
    .bind(newStartsAt, newEndsAt, session.id)
    .run();

  if (session.google_event_id) {
    try {
      await updateCalendarEvent(env, session.google_event_id, newStartsAt, newEndsAt);
    } catch (err) {
      console.error("Google Calendar event update failed:", err);
    }
  }

  return jsonResponse({ ok: true });
}

export async function cancelMySession(
  env: Env,
  client: ClientRow,
  sessionId: number,
): Promise<Response> {
  const session = await loadOwnBookedSession(env, client, sessionId);
  if (!session) return jsonResponse({ error: "Session not found." }, 404);

  if (!(await isOutsideRescheduleWindow(env, session))) {
    return jsonResponse(
      { error: "This session is too soon to self-cancel. Please contact your trainer directly." },
      403,
    );
  }

  await env.DB.prepare(
    "UPDATE sessions SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ? WHERE id = ?",
  )
    .bind(nowSeconds(), "client_cancelled", session.id)
    .run();

  if (session.google_event_id) {
    try {
      await deleteCalendarEvent(env, session.google_event_id);
    } catch (err) {
      console.error("Google Calendar event delete failed:", err);
    }
  }

  return jsonResponse({ ok: true });
}
