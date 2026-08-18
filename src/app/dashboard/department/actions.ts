"use server";

import { requireUnpausedStaff } from "@/lib/staff";
import { submitDepartmentDecision } from "@/lib/review-workflow";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

type Decision = "approved" | "approved_with_condition" | "request_more_info" | "rejected";

/** A department reviewer acting on their own queue. */
export async function submitOwnDepartmentDecision(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "department") throw new Error("Not authorized");

  const assessedAmountRaw = String(formData.get("assessedAmount") ?? "").trim();
  await submitDepartmentDecision({
    departmentReviewId: String(formData.get("departmentReviewId")),
    decision: String(formData.get("decision")) as Decision,
    notes: String(formData.get("notes") ?? "").trim() || null,
    assessedAmount: assessedAmountRaw ? Number(assessedAmountRaw) : null,
    staff,
    actedOnBehalf: false,
  });

  revalidatePath("/dashboard/department");
}

// Exposed for the department dashboard to look up documents for a given application.
export async function getApplicationDocuments(applicationId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("documents")
    .select("id, document_type, file_url, uploaded_at")
    .eq("application_id", applicationId)
    .order("uploaded_at", { ascending: false });
  return data ?? [];
}
