import type { ClientRow, Env } from "./types";
import { isTwilioConfigured, sendSms } from "./twilio";
import { sendEmail } from "./email";

// Notifies a client about their own booking/reschedule/cancellation: SMS if
// they have a phone on file and Twilio is configured, otherwise email (every
// client has an email — it's required at signup). Failures are logged, not
// thrown — a notification hiccup should never undo an already-completed
// booking action.
export async function notifyClient(
  env: Env,
  client: ClientRow,
  params: { smsBody: string; emailSubject: string; emailBody: string },
): Promise<void> {
  try {
    if (client.phone && isTwilioConfigured(env)) {
      await sendSms(env, client.phone, params.smsBody);
    } else {
      await sendEmail(env, client.email, params.emailSubject, params.emailBody);
    }
  } catch (err) {
    console.error("notifyClient failed:", err);
  }
}

// Booking confirmation and reminder emails must never be silently skipped in
// favor of SMS (unlike notifyClient above) — email always goes out, with SMS
// sent as a bonus best-effort channel on top when the client has a phone on
// file and Twilio is configured. Each channel fails independently so an SMS
// hiccup (e.g. Twilio A2P registration issues) can never suppress the email.
export async function notifyClientAlwaysEmail(
  env: Env,
  client: ClientRow,
  params: { smsBody: string; emailSubject: string; emailBody: string },
): Promise<void> {
  try {
    await sendEmail(env, client.email, params.emailSubject, params.emailBody);
  } catch (err) {
    console.error("notifyClientAlwaysEmail email failed:", err);
  }
  if (client.phone && isTwilioConfigured(env)) {
    try {
      await sendSms(env, client.phone, params.smsBody);
    } catch (err) {
      console.error("notifyClientAlwaysEmail sms failed:", err);
    }
  }
}

// Notifies the admin (the one client row with role='admin') about a
// client-initiated booking/reschedule/cancellation. SMS to the admin's
// notification phone number (a settings key, editable in the admin panel)
// if configured, otherwise falls back to the admin's account email.
export async function notifyAdmin(env: Env, message: string): Promise<void> {
  try {
    const admin = await env.DB.prepare("SELECT email FROM clients WHERE role = 'admin' LIMIT 1").first<{
      email: string;
    }>();
    if (!admin) return;

    const phoneRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'admin_phone_number'",
    ).first<{ value: string }>();

    if (phoneRow?.value && isTwilioConfigured(env)) {
      await sendSms(env, phoneRow.value, message);
    } else {
      await sendEmail(env, admin.email, "FitStrong Club notification", `<p>${message}</p>`);
    }
  } catch (err) {
    console.error("notifyAdmin failed:", err);
  }
}
