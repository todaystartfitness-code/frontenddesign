import type { BusinessHoursOverrideRow, BusinessHoursRow, ClientRow, Env, PackageRow, SessionRow } from "../types";
import { adjustLedgerCredits, getSoonestExpiringLedger, nowSeconds } from "../db";
import { getSettings, isSlotAvailable } from "../availability";
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "../google";
import { normalizePhoneE164 } from "../phone";
import { notifyClient } from "../notify";
import { formatPhoenixDateTime } from "../format";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- Business hours (weekly) --------------------------------------------

export async function listBusinessHours(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM business_hours ORDER BY day_of_week ASC",
  ).all<BusinessHoursRow>();
  return jsonResponse({ hours: results ?? [] });
}

export async function updateBusinessHours(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{ days?: Partial<BusinessHoursRow>[] }>()
    .catch(() => ({}) as { days?: Partial<BusinessHoursRow>[] });

  if (!Array.isArray(body.days)) {
    return jsonResponse({ error: "days array is required." }, 400);
  }

  for (const day of body.days) {
    if (typeof day.day_of_week !== "number" || day.day_of_week < 0 || day.day_of_week > 6) {
      return jsonResponse({ error: "Each day needs a day_of_week between 0 and 6." }, 400);
    }
    const isClosed = day.is_closed ? 1 : 0;
    await env.DB.prepare(
      `INSERT INTO business_hours (day_of_week, is_closed, open_minute, close_minute)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(day_of_week) DO UPDATE SET is_closed = ?, open_minute = ?, close_minute = ?`,
    )
      .bind(
        day.day_of_week,
        isClosed,
        isClosed ? null : (day.open_minute ?? null),
        isClosed ? null : (day.close_minute ?? null),
        isClosed,
        isClosed ? null : (day.open_minute ?? null),
        isClosed ? null : (day.close_minute ?? null),
      )
      .run();
  }

  return jsonResponse({ ok: true });
}

// --- Business hours overrides (date-specific) ---------------------------

export async function listBusinessHoursOverrides(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM business_hours_overrides WHERE date >= date('now') ORDER BY date ASC",
  ).all<BusinessHoursOverrideRow>();
  return jsonResponse({ overrides: results ?? [] });
}

export async function upsertBusinessHoursOverride(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<Partial<BusinessHoursOverrideRow>>()
    .catch(() => ({}) as Partial<BusinessHoursOverrideRow>);

  if (!body.date || !DATE_RE.test(body.date)) {
    return jsonResponse({ error: "A valid date (YYYY-MM-DD) is required." }, 400);
  }

  const isClosed = body.is_closed ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO business_hours_overrides (date, is_closed, open_minute, close_minute, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET is_closed = ?, open_minute = ?, close_minute = ?, note = ?`,
  )
    .bind(
      body.date,
      isClosed,
      isClosed ? null : (body.open_minute ?? null),
      isClosed ? null : (body.close_minute ?? null),
      body.note ?? null,
      isClosed,
      isClosed ? null : (body.open_minute ?? null),
      isClosed ? null : (body.close_minute ?? null),
      body.note ?? null,
    )
    .run();

  return jsonResponse({ ok: true });
}

export async function deleteBusinessHoursOverride(env: Env, date: string): Promise<Response> {
  await env.DB.prepare("DELETE FROM business_hours_overrides WHERE date = ?").bind(date).run();
  return jsonResponse({ ok: true });
}

// --- Settings (buffers, reschedule window) -------------------------------

export async function getSettingsRoute(env: Env): Promise<Response> {
  const settings = await getSettings(env.DB);
  const phoneRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_phone_number'").first<{
    value: string;
  }>();
  return jsonResponse({ ...settings, adminPhoneNumber: phoneRow?.value ?? null });
}

export async function updateSettings(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{
      buffer_before_minutes?: number;
      buffer_after_minutes?: number;
      reschedule_window_hours?: number;
      admin_phone_number?: string | null;
    }>()
    .catch(
      () =>
        ({}) as {
          buffer_before_minutes?: number;
          buffer_after_minutes?: number;
          reschedule_window_hours?: number;
          admin_phone_number?: string | null;
        },
    );

  const updates: [string, number | undefined][] = [
    ["buffer_before_minutes", body.buffer_before_minutes],
    ["buffer_after_minutes", body.buffer_after_minutes],
    ["reschedule_window_hours", body.reschedule_window_hours],
  ];

  for (const [key, value] of updates) {
    if (value === undefined) continue;
    if (typeof value !== "number" || value < 0) {
      return jsonResponse({ error: `${key} must be a non-negative number.` }, 400);
    }
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    )
      .bind(key, String(value), String(value))
      .run();
  }

  if (body.admin_phone_number !== undefined) {
    const raw = (body.admin_phone_number ?? "").trim();
    if (!raw) {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'admin_phone_number'").run();
    } else {
      const phone = normalizePhoneE164(raw);
      if (!phone) {
        return jsonResponse({ error: "Enter a valid phone number for admin notifications." }, 400);
      }
      await env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES ('admin_phone_number', ?) ON CONFLICT(key) DO UPDATE SET value = ?",
      )
        .bind(phone, phone)
        .run();
    }
  }

  return jsonResponse({ ok: true });
}

// --- Sessions (admin view/override booking/reschedule/cancel) -----------

export async function listSessions(env: Env, url: URL): Promise<Response> {
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from"); // unix seconds, inclusive
  const to = url.searchParams.get("to"); // unix seconds, exclusive

  const clauses: string[] = [];
  const binds: (string | number)[] = [];

  if (status) {
    clauses.push("s.status = ?");
    binds.push(status);
  }
  if (from) {
    clauses.push("s.starts_at >= ?");
    binds.push(Number(from));
  }
  if (to) {
    clauses.push("s.starts_at < ?");
    binds.push(Number(to));
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const { results } = await env.DB.prepare(
    `SELECT s.*, c.email as client_email, c.name as client_name
     FROM sessions s
     JOIN clients c ON c.id = s.client_id
     ${where}
     ORDER BY s.starts_at ASC`,
  )
    .bind(...binds)
    .all();

  return jsonResponse({ sessions: results ?? [] });
}

export async function adminBookSession(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{
      client_id?: number;
      starts_at?: number;
      duration_minutes?: number;
      deduct?: boolean;
      allow_double_booking?: boolean;
    }>()
    .catch(
      () =>
        ({}) as {
          client_id?: number;
          starts_at?: number;
          duration_minutes?: number;
          deduct?: boolean;
          allow_double_booking?: boolean;
        },
    );

  if (typeof body.client_id !== "number" || typeof body.starts_at !== "number") {
    return jsonResponse({ error: "client_id and starts_at are required." }, 400);
  }

  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND role = 'client'")
    .bind(body.client_id)
    .first();
  if (!client) return jsonResponse({ error: "Client not found." }, 404);

  const deduct = body.deduct !== false;
  let ledgerId: number | null = null;
  let durationMinutes = body.duration_minutes;

  if (deduct) {
    const ledger = await getSoonestExpiringLedger(env.DB, body.client_id);
    if (!ledger) {
      return jsonResponse(
        { error: "This client has no active session credits to deduct. Uncheck deduct, or grant credits first." },
        400,
      );
    }
    ledgerId = ledger.id;
    if (!durationMinutes) {
      const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ?")
        .bind(ledger.package_id)
        .first<PackageRow>();
      durationMinutes = pkg?.session_duration_minutes ?? 60;
    }
  } else if (!durationMinutes) {
    durationMinutes = 60;
  }

  const startsAt = body.starts_at;
  const endsAt = startsAt + durationMinutes * 60;

  // Admin overrides can book outside business hours, and two clients can be
  // placed in the same overlapping slot when allow_double_booking is set
  // (e.g. training partners who work out together) — otherwise the normal
  // conflict check applies.
  if (!body.allow_double_booking) {
    const available = await isSlotAvailable(env, startsAt, endsAt, undefined, true);
    if (!available) {
      return jsonResponse({ error: "That time conflicts with an existing session." }, 409);
    }
  }

  const result = await env.DB.prepare(
    `INSERT INTO sessions (client_id, ledger_id, starts_at, ends_at, duration_minutes, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'booked', 'admin')`,
  )
    .bind(body.client_id, ledgerId, startsAt, endsAt, durationMinutes)
    .run();

  if (deduct && ledgerId) {
    await adjustLedgerCredits(env.DB, {
      ledgerId,
      clientId: body.client_id,
      delta: -1,
      reason: "session_booked_by_admin",
      createdBy: "admin",
    });
  }

  const clientRow = await env.DB.prepare("SELECT * FROM clients WHERE id = ?")
    .bind(body.client_id)
    .first<ClientRow>();

  // Best-effort calendar mirror (conflicts are already prevented above).
  try {
    const eventId = await createCalendarEvent(env, {
      startsAt,
      endsAt,
      clientLabel: clientRow?.name || clientRow?.email || "client",
    });
    if (eventId) {
      await env.DB.prepare("UPDATE sessions SET google_event_id = ? WHERE id = ?")
        .bind(eventId, result.meta.last_row_id as number)
        .run();
    }
  } catch (err) {
    console.error("Google Calendar event create failed:", err);
  }

  if (clientRow) {
    const when = formatPhoenixDateTime(startsAt);
    await notifyClient(env, clientRow, {
      smsBody: `FitStrong Club: you're booked for a session on ${when}.`,
      emailSubject: "Session booked — FitStrong Club",
      emailBody: `<p>You're booked for a session on ${when}.</p>`,
    });
  }

  return jsonResponse({ id: result.meta.last_row_id }, 201);
}

export async function adminRescheduleSession(
  request: Request,
  env: Env,
  sessionId: number,
): Promise<Response> {
  const session = await env.DB.prepare("SELECT * FROM sessions WHERE id = ? AND status = 'booked'")
    .bind(sessionId)
    .first<SessionRow>();
  if (!session) return jsonResponse({ error: "Session not found." }, 404);

  const body = await request.json<{ starts_at?: number }>().catch(() => ({}) as { starts_at?: number });
  if (typeof body.starts_at !== "number") {
    return jsonResponse({ error: "starts_at is required." }, 400);
  }

  const newEndsAt = body.starts_at + session.duration_minutes * 60;
  const available = await isSlotAvailable(env, body.starts_at, newEndsAt, session.id, true);
  if (!available) {
    return jsonResponse({ error: "That time conflicts with an existing session." }, 409);
  }

  await env.DB.prepare("UPDATE sessions SET starts_at = ?, ends_at = ? WHERE id = ?")
    .bind(body.starts_at, newEndsAt, sessionId)
    .run();

  if (session.google_event_id) {
    try {
      await updateCalendarEvent(env, session.google_event_id, body.starts_at, newEndsAt);
    } catch (err) {
      console.error("Google Calendar event update failed:", err);
    }
  }

  const clientRow = await env.DB.prepare("SELECT * FROM clients WHERE id = ?")
    .bind(session.client_id)
    .first<ClientRow>();
  if (clientRow) {
    const when = formatPhoenixDateTime(body.starts_at);
    await notifyClient(env, clientRow, {
      smsBody: `FitStrong Club: your session has been rescheduled to ${when}.`,
      emailSubject: "Session rescheduled — FitStrong Club",
      emailBody: `<p>Your session has been rescheduled to ${when}.</p>`,
    });
  }

  return jsonResponse({ ok: true });
}

export async function adminCancelSession(
  request: Request,
  env: Env,
  sessionId: number,
): Promise<Response> {
  const session = await env.DB.prepare("SELECT * FROM sessions WHERE id = ? AND status = 'booked'")
    .bind(sessionId)
    .first<SessionRow>();
  if (!session) return jsonResponse({ error: "Session not found." }, 404);

  const body = await request
    .json<{ restore_credit?: boolean }>()
    .catch(() => ({}) as { restore_credit?: boolean });

  await env.DB.prepare(
    "UPDATE sessions SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ? WHERE id = ?",
  )
    .bind(nowSeconds(), "admin_cancelled", sessionId)
    .run();

  if (body.restore_credit && session.ledger_id) {
    await adjustLedgerCredits(env.DB, {
      ledgerId: session.ledger_id,
      clientId: session.client_id,
      delta: 1,
      reason: "cancellation_restored",
      createdBy: "admin",
    });
    await env.DB.prepare("UPDATE sessions SET credit_restored = 1 WHERE id = ?").bind(sessionId).run();
  }

  if (session.google_event_id) {
    try {
      await deleteCalendarEvent(env, session.google_event_id);
    } catch (err) {
      console.error("Google Calendar event delete failed:", err);
    }
  }

  const clientRow = await env.DB.prepare("SELECT * FROM clients WHERE id = ?")
    .bind(session.client_id)
    .first<ClientRow>();
  if (clientRow) {
    const when = formatPhoenixDateTime(session.starts_at);
    await notifyClient(env, clientRow, {
      smsBody: `FitStrong Club: your session on ${when} has been cancelled.`,
      emailSubject: "Session cancelled — FitStrong Club",
      emailBody: `<p>Your session on ${when} has been cancelled.</p>`,
    });
  }

  return jsonResponse({ ok: true });
}

export async function restoreSessionCredit(env: Env, sessionId: number): Promise<Response> {
  const session = await env.DB.prepare(
    "SELECT * FROM sessions WHERE id = ? AND status = 'cancelled' AND credit_restored = 0",
  )
    .bind(sessionId)
    .first<SessionRow>();
  if (!session) {
    return jsonResponse({ error: "Session not found, not cancelled, or already restored." }, 404);
  }
  if (!session.ledger_id) {
    return jsonResponse({ error: "This session didn't deduct a credit, so there's nothing to restore." }, 400);
  }

  await adjustLedgerCredits(env.DB, {
    ledgerId: session.ledger_id,
    clientId: session.client_id,
    delta: 1,
    reason: "cancellation_restored",
    createdBy: "admin",
  });
  await env.DB.prepare("UPDATE sessions SET credit_restored = 1 WHERE id = ?").bind(sessionId).run();

  return jsonResponse({ ok: true });
}
