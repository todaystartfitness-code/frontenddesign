import type { ClientRow, Env, PackageRow } from "../types";
import { grantCredits, nowSeconds } from "../db";
import { isSlotAvailable } from "../availability";
import { createCheckoutSession, isStripeConfigured, verifyWebhook } from "../stripe";
import { createCalendarEvent } from "../google";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Buyable packages for the client portal (active, priced above zero).
// The drop-in is included so the UI knows the current drop-in price/duration.
export async function listBuyablePackages(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, session_count, price_cents, expiration_days, session_duration_minutes, is_drop_in
     FROM packages WHERE archived = 0
     ORDER BY is_drop_in ASC, price_cents ASC`,
  ).all<PackageRow>();
  return jsonResponse({ packages: results ?? [], payments_enabled: isStripeConfigured(env) });
}

export async function checkoutPackage(
  request: Request,
  env: Env,
  client: ClientRow,
  origin: string,
): Promise<Response> {
  if (!isStripeConfigured(env)) {
    return jsonResponse({ error: "Online payments aren't set up yet. Contact your trainer to purchase." }, 503);
  }

  const body = await request
    .json<{ package_id?: number }>()
    .catch(() => ({}) as { package_id?: number });
  if (!body.package_id) return jsonResponse({ error: "package_id is required." }, 400);

  const pkg = await env.DB.prepare(
    "SELECT * FROM packages WHERE id = ? AND archived = 0 AND is_drop_in = 0",
  )
    .bind(body.package_id)
    .first<PackageRow>();
  if (!pkg) return jsonResponse({ error: "Package not found." }, 404);
  if (pkg.price_cents <= 0) {
    return jsonResponse({ error: "This package can't be purchased online. Contact your trainer." }, 400);
  }

  const checkout = await createCheckoutSession(env, {
    productName: `${pkg.name} — FitStrong Club`,
    amountCents: pkg.price_cents,
    customerEmail: client.email,
    successUrl: `${origin}/app/dashboard.html?purchase=success`,
    cancelUrl: `${origin}/app/dashboard.html?purchase=cancelled`,
    metadata: {
      kind: "package",
      client_id: String(client.id),
      package_id: String(pkg.id),
    },
  });

  await env.DB.prepare(
    `INSERT INTO purchases (client_id, package_id, kind, stripe_checkout_session_id, amount_cents)
     VALUES (?, ?, 'package', ?, ?)`,
  )
    .bind(client.id, pkg.id, checkout.id, pkg.price_cents)
    .run();

  return jsonResponse({ url: checkout.url });
}

const HOLD_MINUTES = 35; // just past Stripe's 30-minute checkout expiry

export async function checkoutDropIn(
  request: Request,
  env: Env,
  client: ClientRow,
  origin: string,
): Promise<Response> {
  if (!isStripeConfigured(env)) {
    return jsonResponse({ error: "Online payments aren't set up yet. Contact your trainer to book a drop-in." }, 503);
  }

  const body = await request
    .json<{ starts_at?: number }>()
    .catch(() => ({}) as { starts_at?: number });
  if (typeof body.starts_at !== "number") {
    return jsonResponse({ error: "starts_at is required." }, 400);
  }

  const dropIn = await env.DB.prepare(
    "SELECT * FROM packages WHERE is_drop_in = 1 AND archived = 0 ORDER BY updated_at DESC LIMIT 1",
  ).first<PackageRow>();
  if (!dropIn) {
    return jsonResponse({ error: "No drop-in option is currently offered. Contact your trainer." }, 400);
  }

  const startsAt = body.starts_at;
  const endsAt = startsAt + dropIn.session_duration_minutes * 60;

  if (startsAt < nowSeconds()) {
    return jsonResponse({ error: "That time has already passed." }, 400);
  }

  const available = await isSlotAvailable(env, startsAt, endsAt);
  if (!available) {
    return jsonResponse({ error: "That time is no longer available. Please pick another slot." }, 409);
  }

  const checkout = await createCheckoutSession(env, {
    productName: `Single Training Session — FitStrong Club`,
    amountCents: dropIn.price_cents,
    customerEmail: client.email,
    successUrl: `${origin}/app/dashboard.html?purchase=success`,
    cancelUrl: `${origin}/app/dashboard.html?purchase=cancelled`,
    metadata: {
      kind: "drop_in",
      client_id: String(client.id),
      package_id: String(dropIn.id),
    },
    expiresInMinutes: 30,
  });

  const purchase = await env.DB.prepare(
    `INSERT INTO purchases
      (client_id, package_id, kind, stripe_checkout_session_id, amount_cents, slot_starts_at, slot_duration_minutes)
     VALUES (?, ?, 'drop_in', ?, ?, ?, ?)`,
  )
    .bind(client.id, dropIn.id, checkout.id, dropIn.price_cents, startsAt, dropIn.session_duration_minutes)
    .run();

  await env.DB.prepare(
    `INSERT INTO slot_holds (client_id, starts_at, ends_at, expires_at, purchase_id)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(client.id, startsAt, endsAt, nowSeconds() + HOLD_MINUTES * 60, purchase.meta.last_row_id)
    .run();

  return jsonResponse({ url: checkout.url });
}

export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!isStripeConfigured(env)) return jsonResponse({ error: "Not configured." }, 503);

  const payload = await request.text();
  const event = await verifyWebhook(env, payload, request.headers.get("stripe-signature"));
  if (!event) return jsonResponse({ error: "Invalid signature." }, 400);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as { id: string };
    await fulfillPurchase(env, session.id);
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object as { id: string };
    await expirePurchase(env, session.id);
  }

  return jsonResponse({ received: true });
}

async function fulfillPurchase(env: Env, checkoutSessionId: string): Promise<void> {
  // Idempotent: webhooks can be delivered more than once.
  const purchase = await env.DB.prepare(
    "SELECT * FROM purchases WHERE stripe_checkout_session_id = ? AND status = 'pending'",
  )
    .bind(checkoutSessionId)
    .first<{
      id: number;
      client_id: number;
      package_id: number;
      kind: "package" | "drop_in";
      slot_starts_at: number | null;
      slot_duration_minutes: number | null;
    }>();
  if (!purchase) return;

  const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ?")
    .bind(purchase.package_id)
    .first<PackageRow>();
  if (!pkg) return;

  if (purchase.kind === "package") {
    const ledgerId = await grantCredits(env.DB, {
      clientId: purchase.client_id,
      packageId: pkg.id,
      sessionsGranted: pkg.session_count,
      expirationDays: pkg.expiration_days,
      source: "purchase",
      note: "Stripe purchase",
      createdBy: "stripe",
    });
    await env.DB.prepare(
      "UPDATE purchases SET status = 'completed', ledger_id = ?, completed_at = unixepoch() WHERE id = ?",
    )
      .bind(ledgerId, purchase.id)
      .run();
    return;
  }

  // Drop-in: create the session at the held slot. The hold guaranteed the
  // slot stayed free during checkout, so no re-check — the client paid.
  const startsAt = purchase.slot_starts_at!;
  const durationMinutes = purchase.slot_duration_minutes!;
  const endsAt = startsAt + durationMinutes * 60;

  const result = await env.DB.prepare(
    `INSERT INTO sessions (client_id, ledger_id, starts_at, ends_at, duration_minutes, status, created_by)
     VALUES (?, NULL, ?, ?, ?, 'booked', 'client')`,
  )
    .bind(purchase.client_id, startsAt, endsAt, durationMinutes)
    .run();
  const sessionId = result.meta.last_row_id as number;

  await env.DB.prepare(
    "UPDATE purchases SET status = 'completed', session_id = ?, completed_at = unixepoch() WHERE id = ?",
  )
    .bind(sessionId, purchase.id)
    .run();
  await env.DB.prepare("DELETE FROM slot_holds WHERE purchase_id = ?").bind(purchase.id).run();

  try {
    const clientRow = await env.DB.prepare("SELECT email, name FROM clients WHERE id = ?")
      .bind(purchase.client_id)
      .first<{ email: string; name: string | null }>();
    const eventId = await createCalendarEvent(env, {
      startsAt,
      endsAt,
      clientLabel: (clientRow?.name || clientRow?.email || "client") + " (drop-in)",
    });
    if (eventId) {
      await env.DB.prepare("UPDATE sessions SET google_event_id = ? WHERE id = ?")
        .bind(eventId, sessionId)
        .run();
    }
  } catch (err) {
    console.error("Google Calendar event create failed:", err);
  }
}

async function expirePurchase(env: Env, checkoutSessionId: string): Promise<void> {
  const purchase = await env.DB.prepare(
    "SELECT id FROM purchases WHERE stripe_checkout_session_id = ? AND status = 'pending'",
  )
    .bind(checkoutSessionId)
    .first<{ id: number }>();
  if (!purchase) return;

  await env.DB.prepare("UPDATE purchases SET status = 'expired' WHERE id = ?")
    .bind(purchase.id)
    .run();
  await env.DB.prepare("DELETE FROM slot_holds WHERE purchase_id = ?").bind(purchase.id).run();
}
