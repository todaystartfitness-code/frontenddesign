import type { Env } from "./types";

const FROM_ADDRESS = "FitStrong Club <login@fitstrongclub.com>";

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Local dev without a Resend key configured: log instead of sending.
    console.log(`[dev] Email to ${to} (${subject}): ${html}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

export async function sendMagicLinkEmail(
  env: Env,
  email: string,
  verifyUrl: string,
): Promise<void> {
  await sendEmail(
    env,
    email,
    "Your FitStrong Club login link",
    `<p>Click the link below to log in. This link expires in 15 minutes and can only be used once.</p><p><a href="${verifyUrl}">Log in to FitStrong Club</a></p>`,
  );
}
