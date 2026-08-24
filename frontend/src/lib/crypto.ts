/**
 * Client-Side Cryptographic Utilities for DropPay
 * Guarantees that secrets are generated with high entropy and isolated in URL hash fragments.
 */

export function generateDropSecret(): string {
  const randomBytes = new Uint8Array(32); // 256 bits of entropy
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeHashLock(secret: string): Promise<{
  hashHex: string;
  hashBytes: Uint8Array;
}> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const digestBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashBytes = new Uint8Array(digestBuffer);
  const hashHex = Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { hashHex, hashBytes };
}

export function parseSecretFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.substring(1); // strip leading #
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get("secret");
}

export function buildClaimUrl(dropId: string | number, secret: string): string {
  if (typeof window === "undefined") {
    return `http://localhost:3000/claim/${dropId}#secret=${secret}`;
  }
  const origin = window.location.origin;
  return `${origin}/claim/${dropId}#secret=${secret}`;
}
