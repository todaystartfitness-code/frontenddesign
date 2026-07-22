import type { Env } from "../types";
import {
  checkGoogleConnection,
  exchangeCodeForRefreshToken,
  googleAuthUrl,
  storeRefreshToken,
} from "../google";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function googleStatus(env: Env): Promise<Response> {
  const { connected, error } = await checkGoogleConnection(env);
  return jsonResponse({
    configured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    connected,
    error: error ?? null,
  });
}

export async function googleConnect(env: Env, origin: string): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return jsonResponse(
      { error: "Google client credentials are not configured yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets)." },
      500,
    );
  }
  return new Response(null, {
    status: 302,
    headers: { Location: googleAuthUrl(env, origin) },
  });
}

export async function googleCallback(env: Env, url: URL): Promise<Response> {
  const error = url.searchParams.get("error");
  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/admin/dashboard.html?google=denied` },
    });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return jsonResponse({ error: "Missing authorization code." }, 400);
  }

  const refreshToken = await exchangeCodeForRefreshToken(env, code, url.origin);
  await storeRefreshToken(env.DB, refreshToken);

  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/dashboard.html?google=connected` },
  });
}

export async function googleDisconnect(env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM settings WHERE key = 'google_refresh_token'").run();
  return jsonResponse({ ok: true });
}
