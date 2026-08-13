import { getApplicantOwnerId } from "@/lib/applicant-session";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Finishes identity setup for a brand-new owner (see verify-otp, which sets
 * a placeholder full_name = phone). The real intake form (reference/
 * official-application-form/) splits First Name / Last Name and also
 * collects Email -- owners.email already existed as a column but nothing
 * ever wrote to it until now. full_name stays the single stored name field
 * (it's already read everywhere -- dashboards, masking, review cards) so
 * this joins the two inputs rather than splitting the schema.
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const firstName = String(body?.firstName ?? "").trim();
  const lastName = String(body?.lastName ?? "").trim();
  const email = String(body?.email ?? "").trim();
  const gender = body?.gender ? String(body.gender).trim() : null;

  if (firstName.length < 1 || lastName.length < 1) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("owners")
    .update({ full_name: `${firstName} ${lastName}`, email, gender })
    .eq("id", ownerId);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
