import { getApplicantOwnerId } from "@/lib/applicant-session";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/** Replaces the placeholder name set for a brand-new owner (see verify-otp) with their real one. */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (name.length < 2) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("owners").update({ full_name: name }).eq("id", ownerId);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
