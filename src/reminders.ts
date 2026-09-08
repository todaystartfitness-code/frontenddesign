import type { ClientRow, Env, SessionRow } from "./types";
import { notifyClientAlwaysEmail } from "./notify";
import { formatPhoenixDateTime } from "./format";

type ReminderRow = SessionRow & {
  c_id: number;
  c_email: string;
  c_phone: string | null;
  c_name: string | null;
  c_role: ClientRow["role"];
  c_created_at: number;
};

// Two reminder tiers, each tracked by its own sent flag so a slow cron tick
// or brief outage never causes a reminder to be silently missed — re-checking
// the same session on a later tick is safe. Windows are wider than the
// 5-minute cron interval for the same reason.
const REMINDER_TIERS = [
  { column: "reminder_24h_sent", label: "24 hours", minutesBefore: 24 * 60, windowMinutes: 15 },
  { column: "reminder_2h_sent", label: "2 hours", minutesBefore: 2 * 60, windowMinutes: 15 },
] as const;

export async function sendUpcomingReminders(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  for (const tier of REMINDER_TIERS) {
    const windowStart = now + (tier.minutesBefore - tier.windowMinutes) * 60;
    const windowEnd = now + (tier.minutesBefore + tier.windowMinutes) * 60;

    const { results } = await env.DB.prepare(
      `SELECT s.*, c.id as c_id, c.email as c_email, c.phone as c_phone, c.name as c_name,
              c.role as c_role, c.created_at as c_created_at
       FROM sessions s
       JOIN clients c ON c.id = s.client_id
       WHERE s.status = 'booked' AND s.${tier.column} = 0 AND s.starts_at >= ? AND s.starts_at < ?`,
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
      await notifyClientAlwaysEmail(env, client, {
        smsBody: `FitStrong Club reminder: your session is coming up (${tier.label}) on ${when}.`,
        emailSubject: "Upcoming session reminder — FitStrong Club",
        emailBody: `<p>Reminder: your session is coming up in about ${tier.label}, on ${when}.</p>`,
      });
      await env.DB.prepare(`UPDATE sessions SET ${tier.column} = 1 WHERE id = ?`).bind(row.id).run();
    }
  }
}
