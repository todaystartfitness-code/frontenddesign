import type { BusinessHoursOverrideRow, BusinessHoursRow, SessionRow } from "./types";

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

// Computes open start times for a session of `durationMinutes` on `dateStr`
// (a YYYY-MM-DD America/Phoenix calendar date). Buffers around existing
// bookings use the larger of the before/after buffer on both sides (per
// the "take the larger" business rule), applied uniformly.
export async function computeAvailableSlots(
  db: D1Database,
  dateStr: string,
  durationMinutes: number,
  now: number = Math.floor(Date.now() / 1000),
  excludeSessionId?: number,
): Promise<Slot[]> {
  const hours = await getHoursForDate(db, dateStr);
  if (hours.isClosed || hours.openMinute === null || hours.closeMinute === null) return [];

  const settings = await getSettings(db);
  const bufferSeconds = Math.max(settings.bufferBeforeMinutes, settings.bufferAfterMinutes) * 60;

  const openUtc = phoenixDateToUtcSeconds(dateStr, hours.openMinute);
  const closeUtc = phoenixDateToUtcSeconds(dateStr, hours.closeMinute);
  const lastStartUtc = closeUtc - durationMinutes * 60;
  if (lastStartUtc < openUtc) return [];

  const booked = await getBookedSessionsForDay(db, dateStr);
  const blocked = booked
    .filter((s) => s.id !== excludeSessionId)
    .map((s) => ({
      start: s.starts_at - bufferSeconds,
      end: s.ends_at + bufferSeconds,
    }));

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
  db: D1Database,
  startsAt: number,
  endsAt: number,
  excludeSessionId?: number,
  skipHoursCheck = false,
): Promise<boolean> {
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
  return !booked.some((s) => {
    if (excludeSessionId && s.id === excludeSessionId) return false;
    const blockedStart = s.starts_at - bufferSeconds;
    const blockedEnd = s.ends_at + bufferSeconds;
    return startsAt < blockedEnd && endsAt > blockedStart;
  });
}
