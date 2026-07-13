import type { BusinessHoursOverrideRow, BusinessHoursRow, Env, SessionRow } from "./types";
import { getBusyIntervals, type BusyInterval } from "./google";

// Arizona (America/Phoenix) does not observe DST — a fixed UTC-7 offset
// year-round, so no timezone library/DB is needed anywhere in this module.
const PHOENIX_UTC_OFFSET_SECONDS = 7 * 3600;

const SLOT_STEP_MINUTES = 15;

export interface Slot {
  starts_at: number;
  ends_at: number;
}

interface DayHours {
  isClosed: boolean;
  openMinute: number | null;
  closeMinute: number | null;
}

export function phoenixDateToUtcSeconds(dateStr: string, minuteOfDay: number): number {
  const midnightUtc = Date.parse(`${dateStr}T00:00:00Z`) / 1000;
  return midnightUtc + PHOENIX_UTC_OFFSET_SECONDS + minuteOfDay * 60;
}

export function utcSecondsToPhoenixDateStr(utcSeconds: number): string {
  const shifted = new Date((utcSeconds - PHOENIX_UTC_OFFSET_SECONDS) * 1000);
  return shifted.toISOString().slice(0, 10);
}

function dayOfWeekForDate(dateStr: string): number {
  // The Y-M-D calendar date names an unambiguous weekday regardless of
  // timezone, so parsing it as UTC midnight is safe for this purpose.
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export async function getSettings(
  db: D1Database,
): Promise<{ bufferBeforeMinutes: number; bufferAfterMinutes: number; rescheduleWindowHours: number }> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string;
  }>();
  const map: Record<string, string> = {};
  for (const row of results ?? []) map[row.key] = row.value;

  return {
    bufferBeforeMinutes: Number(map.buffer_before_minutes ?? 15),
    bufferAfterMinutes: Number(map.buffer_after_minutes ?? 30),
    rescheduleWindowHours: Number(map.reschedule_window_hours ?? 24),
  };
}

export async function getHoursForDate(db: D1Database, dateStr: string): Promise<DayHours> {
  const override = await db
    .prepare("SELECT * FROM business_hours_overrides WHERE date = ?")
    .bind(dateStr)
    .first<BusinessHoursOverrideRow>();

  if (override) {
    return {
      isClosed: !!override.is_closed,
      openMinute: override.open_minute,
      closeMinute: override.close_minute,
    };
  }

  const weekly = await db
    .prepare("SELECT * FROM business_hours WHERE day_of_week = ?")
    .bind(dayOfWeekForDate(dateStr))
    .first<BusinessHoursRow>();

  if (!weekly) return { isClosed: true, openMinute: null, closeMinute: null };

  return {
    isClosed: !!weekly.is_closed,
    openMinute: weekly.open_minute,
    closeMinute: weekly.close_minute,
  };
}

async function getBookedSessionsForDay(
  db: D1Database,
  dateStr: string,
): Promise<SessionRow[]> {
  const dayStart = phoenixDateToUtcSeconds(dateStr, 0);
  // 3-hour margin on each side comfortably covers any buffer bleed without
  // needing to reason about cross-midnight edge cases (sessions are <= 60min
  // and buffers are small relative to a full day).
  const { results } = await db
    .prepare(
      `SELECT * FROM sessions
       WHERE status = 'booked' AND starts_at < ? AND ends_at > ?`,
    )
    .bind(dayStart + 86400 + 10800, dayStart - 10800)
    .all<SessionRow>();
  return results ?? [];
}

// Google Calendar busy intervals for the day (with margin), or [] if the
// calendar isn't connected yet. Throws on API failure so callers fail closed
// (better to show no slots than to double-book over a calendar event).
async function getGoogleBusyForDay(env: Env, dateStr: string): Promise<BusyInterval[]> {
  const dayStart = phoenixDateToUtcSeconds(dateStr, 0);
  const busy = await getBusyIntervals(env, dayStart - 10800, dayStart + 86400 + 10800);
  return busy ?? [];
}

// Computes open start times for a session of `durationMinutes` on `dateStr`
// (a YYYY-MM-DD America/Phoenix calendar date). Buffers around existing
// bookings use the larger of the before/after buffer on both sides (per
// the "take the larger" business rule), applied uniformly. Google Calendar
// busy intervals (Lunacal bookings, personal events, anything) block slots
// the same way — the calendar is the shared source of truth.
export async function computeAvailableSlots(
  env: Env,
  dateStr: string,
  durationMinutes: number,
  now: number = Math.floor(Date.now() / 1000),
  excludeSessionId?: number,
): Promise<Slot[]> {
  const db = env.DB;
  const hours = await getHoursForDate(db, dateStr);
  if (hours.isClosed || hours.openMinute === null || hours.closeMinute === null) return [];

  const settings = await getSettings(db);
  const bufferSeconds = Math.max(settings.bufferBeforeMinutes, settings.bufferAfterMinutes) * 60;

  const openUtc = phoenixDateToUtcSeconds(dateStr, hours.openMinute);
  const closeUtc = phoenixDateToUtcSeconds(dateStr, hours.closeMinute);
  const lastStartUtc = closeUtc - durationMinutes * 60;
  if (lastStartUtc < openUtc) return [];

  const booked = await getBookedSessionsForDay(db, dateStr);
  // The excluded session (a reschedule's own current slot) is also mirrored
  // on Google Calendar; drop the busy interval that exactly matches it so
  // its calendar echo doesn't block either.
  const excluded = excludeSessionId ? booked.find((s) => s.id === excludeSessionId) : undefined;
  const googleBusy = (await getGoogleBusyForDay(env, dateStr)).filter(
    (b) => !(excluded && b.start === excluded.starts_at && b.end === excluded.ends_at),
  );
  const blocked = booked
    .filter((s) => s.id !== excludeSessionId)
    .map((s) => ({
      start: s.starts_at - bufferSeconds,
      end: s.ends_at + bufferSeconds,
    }))
    .concat(
      googleBusy.map((b) => ({
        start: b.start - bufferSeconds,
        end: b.end + bufferSeconds,
      })),
    );

  const slots: Slot[] = [];
  const stepSeconds = SLOT_STEP_MINUTES * 60;
  for (let start = openUtc; start <= lastStartUtc; start += stepSeconds) {
    if (start < now) continue;
    const end = start + durationMinutes * 60;
    const conflicts = blocked.some((b) => start < b.end && end > b.start);
    if (!conflicts) slots.push({ starts_at: start, ends_at: end });
  }
  return slots;
}

// Re-validates that a specific candidate slot is still free (used at booking
// time to guard against a race between fetching availability and confirming).
export async function isSlotAvailable(
  env: Env,
  startsAt: number,
  endsAt: number,
  excludeSessionId?: number,
  skipHoursCheck = false,
): Promise<boolean> {
  const db = env.DB;
  const settings = await getSettings(db);
  const bufferSeconds = Math.max(settings.bufferBeforeMinutes, settings.bufferAfterMinutes) * 60;

  const dateStr = utcSecondsToPhoenixDateStr(startsAt);

  if (!skipHoursCheck) {
    const hours = await getHoursForDate(db, dateStr);
    if (hours.isClosed || hours.openMinute === null || hours.closeMinute === null) return false;

    const openUtc = phoenixDateToUtcSeconds(dateStr, hours.openMinute);
    const closeUtc = phoenixDateToUtcSeconds(dateStr, hours.closeMinute);
    if (startsAt < openUtc || endsAt > closeUtc) return false;
  }

  const booked = await getBookedSessionsForDay(db, dateStr);
  const excluded = excludeSessionId ? booked.find((s) => s.id === excludeSessionId) : undefined;

  const googleBusy = (await getGoogleBusyForDay(env, dateStr)).filter(
    (b) => !(excluded && b.start === excluded.starts_at && b.end === excluded.ends_at),
  );
  const googleConflict = googleBusy.some((b) => {
    const blockedStart = b.start - bufferSeconds;
    const blockedEnd = b.end + bufferSeconds;
    return startsAt < blockedEnd && endsAt > blockedStart;
  });
  if (googleConflict) return false;

  return !booked.some((s) => {
    if (excludeSessionId && s.id === excludeSessionId) return false;
    const blockedStart = s.starts_at - bufferSeconds;
    const blockedEnd = s.ends_at + bufferSeconds;
    return startsAt < blockedEnd && endsAt > blockedStart;
  });
}
