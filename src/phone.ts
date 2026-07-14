// Normalizes a user-entered phone number to E.164, assuming US/+1 for
// 10-digit numbers (the business operates only in Arizona). Returns null
// if the input can't be reasonably parsed as a phone number.
export function normalizePhoneE164(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(input: string): boolean {
  return EMAIL_RE.test(input.trim());
}
