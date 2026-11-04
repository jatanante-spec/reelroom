// Optional password gate for ReelRoom on Netlify.
// Set REELROOM_PASSWORD in Netlify environment variables to require a login.
import crypto from "node:crypto";

const COOKIE = "reelroom_auth";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function tokenFor(password) {
  return crypto.createHmac("sha256", "reelroom-auth-v1").update(password).digest("hex");
}

export function passwordRequired() {
  return Boolean(process.env.REELROOM_PASSWORD);
}

export function checkPassword(input) {
  const expected = process.env.REELROOM_PASSWORD || "";
  if (!expected) return true;
  const a = Buffer.from(String(input ?? ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function makeCookie(password, secure) {
  const parts = [
    `${COOKIE}=${tokenFor(password)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(secure) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function isSecureRequest(req) {
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function isAuthenticated(req) {
  if (!passwordRequired()) return true;
  const header = req.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const expected = tokenFor(process.env.REELROOM_PASSWORD);
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
