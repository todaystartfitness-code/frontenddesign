import type { Env } from "./types";
import { getSessionClient } from "./auth";
import { handleLogout, handleRequestLink, handleVerify } from "./routes/auth";
import {
  adjustClientCredits,
  createClient,
  createPackage,
  getClientDetail,
  grantClientCredits,
  listClients,
  listPackages,
  sendClientLoginLink,
  updateClient,
  updatePackage,
  voidClientCredit,
} from "./routes/admin";
import {
  adminBookSession,
  adminCancelSession,
  adminRescheduleSession,
  deleteBusinessHoursOverride,
  getSettingsRoute,
  listBusinessHours,
  listBusinessHoursOverrides,
  listSessions,
  restoreSessionCredit,
  updateBusinessHours,
  updateSettings,
  upsertBusinessHoursOverride,
} from "./routes/admin-booking";
import {
  googleCallback,
  googleConnect,
  googleDisconnect,
  googleStatus,
} from "./routes/google-auth";
import {
  checkoutDropIn,
  checkoutPackage,
  listBuyablePackages,
  stripeWebhook,
} from "./routes/payments";
import {
  bookSession,
  cancelMySession,
  getAvailability,
  getMe,
  getMonthOpenDays,
  getMyCredits,
  getMySessions,
  rescheduleMySession,
  updateMyPhone,
} from "./routes/client";
import { sendUpcomingReminders } from "./reminders";

function isStaticAssetPath(pathname: string): boolean {
  return /\.(js|css|png|jpg|jpeg|svg|gif|ico|webp|json|map|woff2?|ttf)$/i.test(pathname);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      // --- Auth: /api/auth/{app,admin}/{request-link,verify,logout} -----
      const authMatch = pathname.match(/^\/api\/auth\/(app|admin)\/(request-link|verify|logout)$/);
      if (authMatch) {
        const [, audience, action] = authMatch as [string, "app" | "admin", string];
        if (action === "request-link" && method === "POST") {
          return await handleRequestLink(request, env, audience);
        }
        if (action === "verify" && method === "GET") {
          return await handleVerify(request, env, audience);
        }
        if (action === "logout" && method === "POST") {
          return await handleLogout(audience);
        }
        return jsonResponse({ error: "Not found." }, 404);
      }

      // --- Client-facing API: /api/me, /api/me/credits -------------------
      if (pathname === "/api/me" && method === "GET") {
        const client = await getSessionClient(env, request, "app");
        if (!client) return jsonResponse({ error: "Not authenticated." }, 401);
        return await getMe(client);
      }

      if (pathname === "/api/me" && method === "PATCH") {
        const client = await getSessionClient(env, request, "app");
        if (!client) return jsonResponse({ error: "Not authenticated." }, 401);
        return await updateMyPhone(request, env, client);
      }

      if (pathname === "/api/me/credits" && method === "GET") {
        const client = await getSessionClient(env, request, "app");
        if (!client) return jsonResponse({ error: "Not authenticated." }, 401);
        return await getMyCredits(env, client);
      }

      // --- Stripe webhook (signature-verified, no session cookie) ---------
      if (pathname === "/api/stripe/webhook" && method === "POST") {
        return await stripeWebhook(request, env);
      }

      // --- Client booking API: /api/app/* ---------------------------------
      if (pathname.startsWith("/api/app/")) {
        const client = await getSessionClient(env, request, "app");
        if (!client) return jsonResponse({ error: "Not authenticated." }, 401);

        if (pathname === "/api/app/month" && method === "GET") {
          return await getMonthOpenDays(env, url.searchParams.get("month"));
        }

        if (pathname === "/api/app/packages" && method === "GET") {
          return await listBuyablePackages(env);
        }

        if (pathname === "/api/app/checkout/package" && method === "POST") {
          return await checkoutPackage(request, env, client, url.origin);
        }

        if (pathname === "/api/app/checkout/drop-in" && method === "POST") {
          return await checkoutDropIn(request, env, client, url.origin);
        }

        if (pathname === "/api/app/availability" && method === "GET") {
          return await getAvailability(
            env,
            client,
            url.searchParams.get("date"),
            url.searchParams.get("reschedule_session_id"),
            url.searchParams.get("mode"),
          );
        }

        if (pathname === "/api/app/sessions") {
          if (method === "GET") return await getMySessions(env, client);
          if (method === "POST") return await bookSession(request, env, client);
        }

        const rescheduleMatch = pathname.match(/^\/api\/app\/sessions\/(\d+)\/reschedule$/);
        if (rescheduleMatch && method === "POST") {
          return await rescheduleMySession(request, env, client, Number(rescheduleMatch[1]));
        }

        const cancelMatch = pathname.match(/^\/api\/app\/sessions\/(\d+)\/cancel$/);
        if (cancelMatch && method === "POST") {
          return await cancelMySession(env, client, Number(cancelMatch[1]));
        }

        return jsonResponse({ error: "Not found." }, 404);
      }

      // --- Admin API: /api/admin/* ---------------------------------------
      if (pathname.startsWith("/api/admin/")) {
        const admin = await getSessionClient(env, request, "admin");
        if (!admin) return jsonResponse({ error: "Not authenticated." }, 401);

        if (pathname === "/api/admin/packages") {
          if (method === "GET") return await listPackages(env);
          if (method === "POST") return await createPackage(request, env);
        }

        const packageMatch = pathname.match(/^\/api\/admin\/packages\/(\d+)$/);
        if (packageMatch && method === "PATCH") {
          return await updatePackage(request, env, Number(packageMatch[1]));
        }

        if (pathname === "/api/admin/clients") {
          if (method === "GET") return await listClients(env);
          if (method === "POST") return await createClient(request, env);
        }

        const clientMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)$/);
        if (clientMatch && method === "GET") {
          return await getClientDetail(env, Number(clientMatch[1]));
        }
        if (clientMatch && method === "PATCH") {
          return await updateClient(request, env, Number(clientMatch[1]));
        }

        const grantMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)\/credits$/);
        if (grantMatch && method === "POST") {
          return await grantClientCredits(request, env, Number(grantMatch[1]));
        }

        const adjustMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)\/credits\/adjust$/);
        if (adjustMatch && method === "POST") {
          return await adjustClientCredits(request, env, Number(adjustMatch[1]));
        }

        const voidMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)\/credits\/(\d+)\/void$/);
        if (voidMatch && method === "POST") {
          return await voidClientCredit(env, Number(voidMatch[1]), Number(voidMatch[2]));
        }

        const loginLinkMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)\/send-login-link$/);
        if (loginLinkMatch && method === "POST") {
          return await sendClientLoginLink(env, Number(loginLinkMatch[1]), url.origin);
        }

        if (pathname === "/api/admin/business-hours") {
          if (method === "GET") return await listBusinessHours(env);
          if (method === "PUT") return await updateBusinessHours(request, env);
        }

        if (pathname === "/api/admin/business-hours/overrides") {
          if (method === "GET") return await listBusinessHoursOverrides(env);
          if (method === "POST") return await upsertBusinessHoursOverride(request, env);
        }

        const overrideMatch = pathname.match(/^\/api\/admin\/business-hours\/overrides\/(\d{4}-\d{2}-\d{2})$/);
        if (overrideMatch && method === "DELETE") {
          return await deleteBusinessHoursOverride(env, overrideMatch[1]);
        }

        if (pathname === "/api/admin/settings") {
          if (method === "GET") return await getSettingsRoute(env);
          if (method === "PUT") return await updateSettings(request, env);
        }

        if (pathname === "/api/admin/sessions") {
          if (method === "GET") return await listSessions(env, url);
          if (method === "POST") return await adminBookSession(request, env);
        }

        const adminRescheduleMatch = pathname.match(/^\/api\/admin\/sessions\/(\d+)\/reschedule$/);
        if (adminRescheduleMatch && method === "POST") {
          return await adminRescheduleSession(request, env, Number(adminRescheduleMatch[1]));
        }

        const adminCancelMatch = pathname.match(/^\/api\/admin\/sessions\/(\d+)\/cancel$/);
        if (adminCancelMatch && method === "POST") {
          return await adminCancelSession(request, env, Number(adminCancelMatch[1]));
        }

        const restoreMatch = pathname.match(/^\/api\/admin\/sessions\/(\d+)\/restore-credit$/);
        if (restoreMatch && method === "POST") {
          return await restoreSessionCredit(env, Number(restoreMatch[1]));
        }

        if (pathname === "/api/admin/google/status" && method === "GET") {
          return await googleStatus(env);
        }
        if (pathname === "/api/admin/google/connect" && method === "GET") {
          return await googleConnect(env, url.origin);
        }
        if (pathname === "/api/admin/google/callback" && method === "GET") {
          return await googleCallback(env, url);
        }
        if (pathname === "/api/admin/google/disconnect" && method === "POST") {
          return await googleDisconnect(env);
        }

        return jsonResponse({ error: "Not found." }, 404);
      }

      // --- /app/* and /admin/* static shells, gated by session -----------
      // Static assets (scripts, styles, etc.) are always public — only the
      // actual HTML pages get gated. Otherwise the login page's own <script>
      // request gets redirected before it can run, breaking the login form.
      if (pathname.startsWith("/app/") || pathname === "/app") {
        const isPublic =
          isStaticAssetPath(pathname) ||
          pathname === "/app" ||
          pathname === "/app/" ||
          pathname === "/app/index.html";
        if (!isPublic) {
          const client = await getSessionClient(env, request, "app");
          if (!client) {
            return new Response(null, { status: 302, headers: { Location: "/app/" } });
          }
        }
        return await env.ASSETS.fetch(request);
      }

      if (pathname.startsWith("/admin/") || pathname === "/admin") {
        const isPublic =
          isStaticAssetPath(pathname) ||
          pathname === "/admin" ||
          pathname === "/admin/" ||
          pathname === "/admin/index.html";
        if (!isPublic) {
          const admin = await getSessionClient(env, request, "admin");
          if (!admin) {
            return new Response(null, { status: 302, headers: { Location: "/admin/" } });
          }
        }
        return await env.ASSETS.fetch(request);
      }

      // Everything else (marketing site) is served as a plain static asset.
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return jsonResponse({ error: "Internal server error." }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await sendUpcomingReminders(env);
  },
};
