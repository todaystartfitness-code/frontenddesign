import type { Env, ClientRow } from "../types";
import {
  createMagicLinkToken,
  createSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  verifyMagicLinkToken,
} from "../auth";
import { sendMagicLinkEmail } from "../email";
import { sendMagicLinkSms } from "../twilio";
import { looksLikeEmail, normalizePhoneE164 } from "../phone";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleRequestLink(
  request: Request,
  env: Env,
  audience: "app" | "admin",
): Promise<Response> {
  const body = await request
    .json<{ identifier?: string; email?: string }>()
    .catch(() => ({}) as { identifier?: string; email?: string });
  // Accept either field name — `email` for back-compat with the admin form,
  // which is always email-only.
  const raw = (body.identifier ?? body.email ?? "").trim();

  if (!raw) {
    return jsonResponse({ error: "An email or phone number is required." }, 400);
  }

  const genericMessage = { ok: true, message: "If that account is eligible, a login link is on its way." };

  // Admin login is always email-only (a fixed, single admin account).
  if (audience === "admin") {
    if (!looksLikeEmail(raw)) {
      return jsonResponse({ error: "A valid email is required." }, 400);
    }
    const email = raw.toLowerCase();
    const client = await env.DB.prepare("SELECT * FROM clients WHERE email = ?")
      .bind(email)
      .first<ClientRow>();
    if (client && client.role === "admin") {
      const token = await createMagicLinkToken(env.DB, email, "admin", "email");
      const url = new URL(request.url);
      const verifyUrl = `${url.origin}/api/auth/admin/verify?token=${token}`;
      await sendMagicLinkEmail(env, email, verifyUrl);
    }
    return jsonResponse(genericMessage);
  }

  // Client login: email or phone.
  if (looksLikeEmail(raw)) {
    const email = raw.toLowerCase();
    let client = await env.DB.prepare("SELECT * FROM clients WHERE email = ?")
      .bind(email)
      .first<ClientRow>();

    if (!client) {
      // Self-signup: creating a client account on first login attempt.
      await env.DB.prepare("INSERT INTO clients (email, role) VALUES (?, 'client')")
        .bind(email)
        .run();
      client = await env.DB.prepare("SELECT * FROM clients WHERE email = ?")
        .bind(email)
        .first<ClientRow>();
    }

    if (client) {
      const token = await createMagicLinkToken(env.DB, email, "app", "email");
      const url = new URL(request.url);
      const verifyUrl = `${url.origin}/api/auth/app/verify?token=${token}`;
      await sendMagicLinkEmail(env, email, verifyUrl);
    }
    return jsonResponse(genericMessage);
  }

  // Phone: only existing clients with a matching phone on file — phone
  // alone can't create a new account (email is required at signup).
  const phone = normalizePhoneE164(raw);
  if (!phone) {
    return jsonResponse({ error: "Enter a valid email or phone number." }, 400);
  }

  const client = await env.DB.prepare("SELECT * FROM clients WHERE phone = ? AND role = 'client'")
    .bind(phone)
    .first<ClientRow>();

  if (client) {
    const token = await createMagicLinkToken(env.DB, phone, "app", "phone");
    const url = new URL(request.url);
    const verifyUrl = `${url.origin}/api/auth/app/verify?token=${token}`;
    await sendMagicLinkSms(env, phone, verifyUrl);
  }
  return jsonResponse(genericMessage);
}

export async function handleVerify(
  request: Request,
  env: Env,
  audience: "app" | "admin",
): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return jsonResponse({ error: "Missing token." }, 400);
  }

  const result = await verifyMagicLinkToken(env.DB, token, audience);
  if (!result) {
    return jsonResponse({ error: "This login link is invalid or has expired." }, 400);
  }

  const column = result.channel === "phone" ? "phone" : "email";
  const client = await env.DB.prepare(`SELECT * FROM clients WHERE ${column} = ?`)
    .bind(result.identifier)
    .first<ClientRow>();

  if (!client || (audience === "admin" && client.role !== "admin")) {
    return jsonResponse({ error: "Account not eligible for this login." }, 403);
  }

  const sessionToken = await createSession(env.DB, client.id);
  const dashboardPath = audience === "admin" ? "/admin/dashboard.html" : "/app/dashboard.html";

  return new Response(null, {
    status: 302,
    headers: {
      Location: dashboardPath,
      "Set-Cookie": sessionCookieHeader(audience, sessionToken),
    },
  });
}

export async function handleLogout(
  audience: "app" | "admin",
): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/${audience}/`,
      "Set-Cookie": clearSessionCookieHeader(audience),
    },
  });
}
