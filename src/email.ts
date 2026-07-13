import type { Env } from "./types";

const FROM_ADDRESS = "FitStrong Club <login@fitstrongclub.com>";

export async function sendMagicLinkEmail(
  env: Env,
  email: string,
  verifyUrl: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Local dev without a Resend key configured: log instead of sending.
    console.log(`[dev] Magic link for ${email}: ${verifyUrl}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: email,
      subject: "Your FitStrong Club login link",
      html: `<p>Click the link below to log in. This link expires in 15 minutes and can only be used once.</p><p><a href="${verifyUrl}">Log in to FitStrong Club</a></p>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}
