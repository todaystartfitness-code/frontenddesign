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
  updatePackage,
} from "./routes/admin";
import { getMe, getMyCredits } from "./routes/client";

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

      if (pathname === "/api/me/credits" && method === "GET") {
        const client = await getSessionClient(env, request, "app");
        if (!client) return jsonResponse({ error: "Not authenticated." }, 401);
        return await getMyCredits(env, client);
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

        const grantMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)\/credits$/);
        if (grantMatch && method === "POST") {
          return await grantClientCredits(request, env, Number(grantMatch[1]));
        }

        const adjustMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)\/credits\/adjust$/);
        if (adjustMatch && method === "POST") {
          return await adjustClientCredits(request, env, Number(adjustMatch[1]));
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
};
