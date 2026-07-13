export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  RESEND_API_KEY: string;
}

export type Role = "client" | "admin";

export interface ClientRow {
  id: number;
  email: string;
  phone: string | null;
  name: string | null;
  role: Role;
  created_at: number;
}

export interface PackageRow {
  id: number;
  name: string;
  session_count: number;
  price_cents: number;
  expiration_days: number;
  session_duration_minutes: number;
  is_drop_in: number;
  archived: number;
  created_at: number;
  updated_at: number;
}

export interface CreditLedgerRow {
  id: number;
  client_id: number;
  package_id: number;
  source: "purchase" | "manual_admin";
  sessions_granted: number;
  sessions_remaining: number;
  granted_at: number;
  expires_at: number;
  note: string | null;
}

export interface BusinessHoursRow {
  day_of_week: number; // 0 = Sunday
  is_closed: number;
  open_minute: number | null;
  close_minute: number | null;
}

export interface BusinessHoursOverrideRow {
  date: string; // YYYY-MM-DD, America/Phoenix
  is_closed: number;
  open_minute: number | null;
  close_minute: number | null;
  note: string | null;
}

export type SessionStatus = "booked" | "cancelled" | "completed";

export interface SessionRow {
  id: number;
  client_id: number;
  ledger_id: number | null;
  starts_at: number;
  ends_at: number;
  duration_minutes: number;
  status: SessionStatus;
  created_by: "client" | "admin";
  credit_restored: number;
  cancelled_at: number | null;
  cancelled_reason: string | null;
  google_event_id: string | null;
  created_at: number;
}
