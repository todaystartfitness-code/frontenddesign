import type { Env, ClientRow } from "../types";
import {
  createMagicLinkToken,
  createSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  verifyMagicLinkToken,
} from "../auth";
import { sendMagicLinkEmail } from "../email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    .json<{ email?: string }>()
    .catch(() => ({}) as { email?: string });
  const email = body.email?.trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return jsonResponse({ error: "A valid email is required." }, 400);
  }

  let client = await env.DB.prepare("SELECT * FROM clients WHERE email = ?")
    .bind(email)
    .first<ClientRow>();

  if (audience === "app" && !client) {
    // Self-signup: creating a client account on first login attempt.
    await env.DB.prepare("INSERT INTO clients (email, role) VALUES (?, 'client')")
      .bind(email)
      .run();
    client = await env.DB.prepare("SELECT * FROM clients WHERE email = ?")
      .bind(email)
      .first<ClientRow>();
  }

  // Don't reveal account existence either way; only actually send mail
  // when the account is eligible for this audience.
  const eligible = client && (audience === "app" || client.role === "admin");

  if (eligible && client) {
    const token = await createMagicLinkToken(env.DB, email, audience);
    const url = new URL(request.url);
    const verifyUrl = `${url.origin}/api/auth/${audience}/verify?token=${token}`;
    await sendMagicLinkEmail(env, email, verifyUrl);
  }

  return jsonResponse({ ok: true, message: "If that email is eligible, a login link is on its way." });
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

  const email = await verifyMagicLinkToken(env.DB, token, audience);
  if (!email) {
    return jsonResponse({ error: "This login link is invalid or has expired." }, 400);
  }

  const client = await env.DB.prepare("SELECT * FROM clients WHERE email = ?")
    .bind(email)
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
