import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";

const COOKIE_NAME = "muniserve_applicant_session";
const SESSION_TTL_DAYS = 30;

/**
 * Creates an applicant_sessions row and returns the opaque token to set as
 * an httpOnly cookie. See migration 0007's comment for why this exists
 * instead of a JWT.
 */
export async function createApplicantSession(ownerId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const supabase = createServiceClient();
  const { error } = await supabase.from("applicant_sessions").insert({
    owner_id: ownerId,
    session_token: token,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw error;

  return token;
}

export function applicantSessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

/**
 * Resolves the current request's applicant session cookie to an owner_id,
 * or null if there's no cookie, no matching row, or it's expired.
 */
export async function getApplicantOwnerId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("applicant_sessions")
    .select("owner_id, expires_at")
    .eq("session_token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  return data.owner_id;
}

export { COOKIE_NAME as APPLICANT_SESSION_COOKIE_NAME };
