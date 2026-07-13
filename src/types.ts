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
