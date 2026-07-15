import type { ClientRow, Env, PackageRow, QuizQuestionRow } from "../types";
import { adjustLedgerCredits, grantCredits, nowSeconds } from "../db";
import { computeAvailableSlots, isSlotAvailable } from "../availability";
import { createCalendarEvent } from "../google";
import { createCheckoutSession, isStripeConfigured } from "../stripe";
import { normalizePhoneE164 } from "../phone";
import { notifyAdmin, notifyClient } from "../notify";
import { formatPhoenixDateTime } from "../format";
import { createMagicLinkToken } from "../auth";
import { expirePendingPurchase } from "../purchases";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOLD_MINUTES = 35; // just past Stripe's 30-minute checkout expiry

export async function listPublicQuiz(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM quiz_questions ORDER BY position ASC",
  ).all<QuizQuestionRow>();
  const questions = (results ?? []).map((q) => ({
    id: q.id,
    question_type: q.question_type,
    prompt: q.prompt,
    options: q.options ? (JSON.parse(q.options) as string[]) : null,
  }));
  return jsonResponse({ questions });
}

export async function listPublicPackages(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, session_count, price_cents, expiration_days, session_duration_minutes, requires_payment, requires_quiz, description
     FROM packages WHERE is_public = 1 AND archived = 0
     ORDER BY price_cents ASC`,
  ).all<PackageRow>();
  return jsonResponse({ packages: results ?? [], payments_enabled: isStripeConfigured(env) });
}

export async function getPublicAvailability(
  env: Env,
  packageIdStr: string | null,
  dateStr: string | null,
): Promise<Response> {
  if (!dateStr || !DATE_RE.test(dateStr)) {
    return jsonResponse({ error: "date (YYYY-MM-DD) is required." }, 400);
  }
  const packageId = Number(packageIdStr);
  if (!packageId) return jsonResponse({ error: "package_id is required." }, 400);

  const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ? AND is_public = 1 AND archived = 0")
    .bind(packageId)
    .first<PackageRow>();
  if (!pkg) return jsonResponse({ error: "Package not found." }, 404);

  const slots = await computeAvailableSlots(env, dateStr, pkg.session_duration_minutes, nowSeconds());
  return jsonResponse({ slots, duration_minutes: pkg.session_duration_minutes });
}

// Called by the client-side redirect when a prospect backs out of a paid
// public-booking checkout, so the slot they were holding frees up
// immediately instead of staying locked for up to HOLD_MINUTES. No auth —
// the Stripe checkout session id itself is the unguessable secret here,
// same trust model as the magic-link tokens used elsewhere in this flow.
export async function cancelPublicCheckout(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ session_id?: string }>().catch(() => ({}) as { session_id?: string });
  if (!body.session_id) return jsonResponse({ error: "session_id is required." }, 400);
  await expirePendingPurchase(env, body.session_id);
  return jsonResponse({ ok: true });
}

export async function sendPublicBookingConfirmation(
  env: Env,
  client: ClientRow,
  pkg: PackageRow,
  startsAt: number,
  origin: string,
): Promise<void> {
  const when = formatPhoenixDateTime(startsAt);
  const token = await createMagicLinkToken(env.DB, client.email, "app", "email");
  const loginUrl = `${origin}/api/auth/app/verify?token=${token}`;
  await notifyClient(env, client, {
    smsBody: `FitStrong Club: you're booked for ${pkg.name} on ${when}. Manage your account: ${loginUrl}`,
    emailSubject: "You're booked! — FitStrong Club",
    emailBody: `<p>You're booked for ${pkg.name} on ${when}.</p><p><a href="${loginUrl}">Log in to manage your sessions</a> (this link expires in 15 minutes — you can always request a new one from the login page).</p>`,
  });
}

// The single public booking submission endpoint. Handles both paths:
// requires_payment packages kick off Stripe Checkout (slot held meanwhile,
// booked by the webhook on payment); free packages book immediately.
export async function submitPublicBooking(request: Request, env: Env, origin: string): Promise<Response> {
  const body = await request
    .json<{
      package_id?: number;
      starts_at?: number;
      name?: string;
      email?: string;
      phone?: string;
      quiz_answers?: { question_id?: number; answer?: string }[];
    }>()
    .catch(
      () =>
        ({}) as {
          package_id?: number;
          starts_at?: number;
          name?: string;
          email?: string;
          phone?: string;
          quiz_answers?: { question_id?: number; answer?: string }[];
        },
    );

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return jsonResponse({ error: "A valid email is required." }, 400);
  }
  if (typeof body.package_id !== "number" || typeof body.starts_at !== "number") {
    return jsonResponse({ error: "package_id and starts_at are required." }, 400);
  }

  const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ? AND is_public = 1 AND archived = 0")
    .bind(body.package_id)
    .first<PackageRow>();
  if (!pkg) return jsonResponse({ error: "Package not found." }, 404);

  const startsAt = body.starts_at;
  if (startsAt < nowSeconds()) {
    return jsonResponse({ error: "That time has already passed." }, 400);
  }
  const endsAt = startsAt + pkg.session_duration_minutes * 60;

  const available = await isSlotAvailable(env, startsAt, endsAt);
  if (!available) {
    return jsonResponse({ error: "That time is no longer available. Please pick another slot." }, 409);
  }

  let phone: string | null = null;
  if (body.phone) {
    phone = normalizePhoneE164(body.phone);
    if (!phone) return jsonResponse({ error: "Enter a valid phone number, or leave it blank." }, 400);
  }

  let client = await env.DB.prepare("SELECT * FROM clients WHERE email = ?")
    .bind(email)
    .first<ClientRow>();
  if (!client) {
    await env.DB.prepare("INSERT INTO clients (email, name, phone, role) VALUES (?, ?, ?, 'client')")
      .bind(email, body.name?.trim() || null, phone)
      .run();
    client = await env.DB.prepare("SELECT * FROM clients WHERE email = ?").bind(email).first<ClientRow>();
  } else if (!client.name || !client.phone) {
    // Fill in missing name/phone; never clobber what's already on file.
    const nextName = client.name ?? body.name?.trim() ?? null;
    const nextPhone = client.phone ?? phone;
    await env.DB.prepare("UPDATE clients SET name = ?, phone = ? WHERE id = ?")
      .bind(nextName, nextPhone, client.id)
      .run();
    client = { ...client, name: nextName, phone: nextPhone };
  }
  if (!client) return jsonResponse({ error: "Could not create your account. Please try again." }, 500);

  if (Array.isArray(body.quiz_answers) && body.quiz_answers.length > 0) {
    const { results: validQuestions } = await env.DB.prepare("SELECT id FROM quiz_questions").all<{
      id: number;
    }>();
    const validIds = new Set((validQuestions ?? []).map((q) => q.id));
    for (const qa of body.quiz_answers) {
      if (!qa.question_id || !validIds.has(qa.question_id)) continue;
      const answer = (qa.answer ?? "").trim().slice(0, 2000);
      if (!answer) continue;
      await env.DB.prepare("INSERT INTO quiz_responses (client_id, question_id, answer) VALUES (?, ?, ?)")
        .bind(client.id, qa.question_id, answer)
        .run();
    }
  }

  if (pkg.requires_payment) {
    if (!isStripeConfigured(env)) {
      return jsonResponse(
        { error: "Online payments aren't set up yet. Please contact us directly to book." },
        503,
      );
    }

    const checkout = await createCheckoutSession(env, {
      productName: `${pkg.name} — FitStrong Club`,
      amountCents: pkg.price_cents,
      customerEmail: email,
      successUrl: `${origin}/book/?booked=1`,
      // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect — lets the
      // prospect immediately release this slot's hold on cancel instead of
      // waiting out the full HOLD_MINUTES window.
      cancelUrl: `${origin}/book/?cancelled=1&session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        kind: "package",
        client_id: String(client.id),
        package_id: String(pkg.id),
      },
      expiresInMinutes: 30,
    });

    const purchase = await env.DB.prepare(
      `INSERT INTO purchases
        (client_id, package_id, kind, stripe_checkout_session_id, amount_cents, slot_starts_at, slot_duration_minutes)
       VALUES (?, ?, 'package', ?, ?, ?, ?)`,
    )
      .bind(client.id, pkg.id, checkout.id, pkg.price_cents, startsAt, pkg.session_duration_minutes)
      .run();

    await env.DB.prepare(
      `INSERT INTO slot_holds (client_id, starts_at, ends_at, expires_at, purchase_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(client.id, startsAt, endsAt, nowSeconds() + HOLD_MINUTES * 60, purchase.meta.last_row_id)
      .run();

    return jsonResponse({ url: checkout.url });
  }

  // Free package: grant credits and book the slot immediately, no payment step.
  const ledgerId = await grantCredits(env.DB, {
    clientId: client.id,
    packageId: pkg.id,
    sessionsGranted: pkg.session_count,
    expirationDays: pkg.expiration_days,
    source: "purchase",
    note: "Free public booking",
    createdBy: "public",
  });

  const result = await env.DB.prepare(
    `INSERT INTO sessions (client_id, ledger_id, starts_at, ends_at, duration_minutes, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'booked', 'client')`,
  )
    .bind(client.id, ledgerId, startsAt, endsAt, pkg.session_duration_minutes)
    .run();
  const sessionId = result.meta.last_row_id as number;

  await adjustLedgerCredits(env.DB, {
    ledgerId,
    clientId: client.id,
    delta: -1,
    reason: "session_booked_public",
    createdBy: "public",
  });

  try {
    const eventId = await createCalendarEvent(env, {
      startsAt,
      endsAt,
      clientLabel: `${client.name || client.email} (public booking)`,
    });
    if (eventId) {
      await env.DB.prepare("UPDATE sessions SET google_event_id = ? WHERE id = ?").bind(eventId, sessionId).run();
    }
  } catch (err) {
    console.error("Google Calendar event create failed:", err);
  }

  await sendPublicBookingConfirmation(env, client, pkg, startsAt, origin);
  await notifyAdmin(
    env,
    `New public booking: ${client.name || client.email} booked ${pkg.name} for ${formatPhoenixDateTime(startsAt)}.`,
  );

  return jsonResponse({
    ok: true,
    message: "You're booked! Check your email or phone for a link to manage your session.",
  });
}
