import type { ClientRow, Env, SessionRow } from "./types";
import { notifyClient } from "./notify";
import { formatPhoenixDateTime } from "./format";

const REMINDER_MINUTES_BEFORE = 90;
// Wide window (rather than matching the cron interval exactly) so a slow
// cron tick or a brief outage never causes a reminder to be silently missed
// — reminder_sent makes re-checking the same session on the next tick safe.
const WINDOW_START_MINUTES = 80;
const WINDOW_END_MINUTES = 100;

type ReminderRow = SessionRow & {
  c_id: number;
  c_email: string;
  c_phone: string | null;
  c_name: string | null;
  c_role: ClientRow["role"];
  c_created_at: number;
};

export async function sendUpcomingReminders(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now + WINDOW_START_MINUTES * 60;
  const windowEnd = now + WINDOW_END_MINUTES * 60;

  const { results } = await env.DB.prepare(
    `SELECT s.*, c.id as c_id, c.email as c_email, c.phone as c_phone, c.name as c_name,
            c.role as c_role, c.created_at as c_created_at
     FROM sessions s
     JOIN clients c ON c.id = s.client_id
     WHERE s.status = 'booked' AND s.reminder_sent = 0 AND s.starts_at >= ? AND s.starts_at < ?`,
  )
    .bind(windowStart, windowEnd)
    .all<ReminderRow>();

  for (const row of results ?? []) {
    const client: ClientRow = {
      id: row.c_id,
      email: row.c_email,
      phone: row.c_phone,
      name: row.c_name,
      role: row.c_role,
      created_at: row.c_created_at,
    };
    const when = formatPhoenixDateTime(row.starts_at);
    await notifyClient(env, client, {
      smsBody: `FitStrong Club reminder: your session is coming up (${REMINDER_MINUTES_BEFORE} min) on ${when}.`,
      emailSubject: "Upcoming session reminder — FitStrong Club",
      emailBody: `<p>Reminder: your session is coming up soon, on ${when}.</p>`,
    });
    await env.DB.prepare("UPDATE sessions SET reminder_sent = 1 WHERE id = ?").bind(row.id).run();
  }
}
