import { redirect } from "next/navigation";

/**
 * No public homepage yet -- the applicant-facing flow is build order
 * step 5, not built. For now the only front door is staff login;
 * middleware.ts sends already-authenticated staff straight to /dashboard.
 */
export default function RootPage() {
  redirect("/login");
}
