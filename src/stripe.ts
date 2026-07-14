import type { Env } from "./types";

// Stripe integration via plain fetch (no SDK — Workers-friendly).
// Payments use Stripe Checkout (hosted page): we never touch card data.

const STRIPE_API = "https://api.stripe.com/v1";

export function isStripeConfigured(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export async function createCheckoutSession(
  env: Env,
  params: {
    productName: string;
    amountCents: number;
    customerEmail: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    expiresInMinutes?: number;
  },
): Promise<{ id: string; url: string }> {
  const body: Record<string, string> = {
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": params.productName,
    "line_items[0][price_data][unit_amount]": String(params.amountCents),
    "line_items[0][quantity]": "1",
    customer_email: params.customerEmail,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  };
  for (const [k, v] of Object.entries(params.metadata)) {
    body[`metadata[${k}]`] = v;
  }
  if (params.expiresInMinutes) {
    // Stripe minimum is 30 minutes.
    body.expires_at = String(Math.floor(Date.now() / 1000) + params.expiresInMinutes * 60);
  }

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode(body),
  });

  if (!res.ok) {
    throw new Error(`Stripe checkout create failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json<{ id: string; url: string }>();
  return { id: data.id, url: data.url };
}

// Verifies a Stripe webhook signature (v1 scheme: HMAC-SHA256 of
// "<timestamp>.<payload>" with the endpoint secret). Returns the parsed
// event on success, null on any verification failure.
export async function verifyWebhook(
  env: Env,
  payload: string,
  signatureHeader: string | null,
): Promise<{ type: string; data: { object: Record<string, unknown> } } | null> {
  if (!signatureHeader) return null;

  const parts = new Map(
    signatureHeader.split(",").map((p) => {
      const idx = p.indexOf("=");
      return [p.slice(0, idx), p.slice(idx + 1)] as [string, string];
    }),
  );
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return null;

  // Reject stale events (replay protection).
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signature.length) return null;
  // Constant-time comparison.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
