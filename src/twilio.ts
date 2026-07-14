import type { Env } from "./types";

export function isTwilioConfigured(env: Env): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
}

export async function sendSms(env: Env, to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: env.TWILIO_PHONE_NUMBER,
      Body: body,
    }),
  });

  if (!res.ok) {
    throw new Error(`Twilio send failed (${res.status}): ${await res.text()}`);
  }
}

export async function sendMagicLinkSms(env: Env, phone: string, verifyUrl: string): Promise<void> {
  if (!isTwilioConfigured(env)) {
    // Local dev / not yet configured: log instead of sending.
    console.log(`[dev] Magic link SMS for ${phone}: ${verifyUrl}`);
    return;
  }
  await sendSms(
    env,
    phone,
    `FitStrong Club: tap to log in (expires in 15 min): ${verifyUrl}`,
  );
}
