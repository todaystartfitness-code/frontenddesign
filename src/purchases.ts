import type { Env } from "./types";

// Releases a pending purchase's slot hold immediately — used both when
// Stripe reports a checkout expired, and (more importantly) when the client
// themselves cancels/backs out of checkout. Without this, an abandoned
// drop-in or public-booking checkout leaves its slot invisibly locked for
// up to HOLD_MINUTES (in payments.ts/public.ts) even though nothing was
// ever booked — no Google Calendar event exists for a hold, only for a
// completed booking, so the lock has no visible explanation anywhere.
export async function expirePendingPurchase(env: Env, checkoutSessionId: string): Promise<void> {
  const purchase = await env.DB.prepare(
    "SELECT id FROM purchases WHERE stripe_checkout_session_id = ? AND status = 'pending'",
  )
    .bind(checkoutSessionId)
    .first<{ id: number }>();
  if (!purchase) return;

  await env.DB.prepare("UPDATE purchases SET status = 'expired' WHERE id = ?").bind(purchase.id).run();
  await env.DB.prepare("DELETE FROM slot_holds WHERE purchase_id = ?").bind(purchase.id).run();
}
