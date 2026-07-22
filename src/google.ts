import type { Env } from "./types";

// Google Calendar integration. The admin connects once via OAuth (consent
// screen), we store the refresh token in the settings table, and from then
// on every availability check consults the calendar's free/busy and every
// booking is mirrored as a calendar event.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
].join(" ");

export function googleRedirectUri(origin: string): string {
  return `${origin}/api/admin/google/callback`;
}

export function googleAuthUrl(env: Env, origin: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function getStoredRefreshToken(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'google_refresh_token'")
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function exchangeCodeForRefreshToken(
  env: Env,
  code: string,
  origin: string,
): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(origin),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json<{ refresh_token?: string }>();
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token. Disconnect the app at myaccount.google.com/permissions and try connecting again.");
  }
  return data.refresh_token;
}

export async function storeRefreshToken(db: D1Database, token: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO settings (key, value) VALUES ('google_refresh_token', ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    )
    .bind(token, token)
    .run();
}

// Presence of a stored refresh token doesn't mean Google still honors it
// (revoked access, expired after 6 months unused, password change, etc.) —
// this actually exercises the refresh so the dashboard's "Connected" status
// reflects reality instead of just "we saved a token once."
export async function checkGoogleConnection(env: Env): Promise<{ connected: boolean; error?: string }> {
  const refreshToken = await getStoredRefreshToken(env.DB);
  if (!refreshToken) return { connected: false };
  try {
    await getAccessToken(env);
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : "Google token refresh failed." };
  }
}

async function getAccessToken(env: Env): Promise<string | null> {
  const refreshToken = await getStoredRefreshToken(env.DB);
  if (!refreshToken) return null;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json<{ access_token: string }>();
  return data.access_token;
}

export interface BusyInterval {
  start: number; // unix seconds
  end: number;
}

// Busy intervals on the primary calendar between two times. Returns null if
// Google isn't connected yet (callers then skip calendar blocking); throws on
// API failure so booking paths fail closed rather than double-book.
export async function getBusyIntervals(
  env: Env,
  fromSeconds: number,
  toSeconds: number,
): Promise<BusyInterval[] | null> {
  const accessToken = await getAccessToken(env);
  if (!accessToken) return null;

  const res = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: new Date(fromSeconds * 1000).toISOString(),
      timeMax: new Date(toSeconds * 1000).toISOString(),
      items: [{ id: "primary" }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Google freeBusy failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json<{
    calendars: { primary: { busy: { start: string; end: string }[] } };
  }>();

  return (data.calendars.primary.busy ?? []).map((b) => ({
    start: Math.floor(Date.parse(b.start) / 1000),
    end: Math.floor(Date.parse(b.end) / 1000),
  }));
}

export async function createCalendarEvent(
  env: Env,
  params: { startsAt: number; endsAt: number; clientLabel: string },
): Promise<string | null> {
  const accessToken = await getAccessToken(env);
  if (!accessToken) return null;

  const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: `Training — ${params.clientLabel}`,
      description: "Booked via the FitStrong Club app.",
      start: { dateTime: new Date(params.startsAt * 1000).toISOString() },
      end: { dateTime: new Date(params.endsAt * 1000).toISOString() },
    }),
  });

  if (!res.ok) {
    throw new Error(`Google event create failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json<{ id: string }>();
  return data.id;
}

export async function updateCalendarEvent(
  env: Env,
  eventId: string,
  startsAt: number,
  endsAt: number,
): Promise<void> {
  const accessToken = await getAccessToken(env);
  if (!accessToken) return;

  const res = await fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      start: { dateTime: new Date(startsAt * 1000).toISOString() },
      end: { dateTime: new Date(endsAt * 1000).toISOString() },
    }),
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`Google event update failed (${res.status}): ${await res.text()}`);
  }
}

export async function deleteCalendarEvent(env: Env, eventId: string): Promise<void> {
  const accessToken = await getAccessToken(env);
  if (!accessToken) return;

  const res = await fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 404/410 = already gone (deleted by hand in Google Calendar) — fine.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google event delete failed (${res.status}): ${await res.text()}`);
  }
}
