import { getCurrentStaff } from "@/lib/staff";
import { redirect } from "next/navigation";
import { Card, SectionHead } from "../ui";

/**
 * Staff Knowledge Base (2026-08-21) -- linked from the top bar's own
 * "Knowledge Base" button, which took over the spot the plain "Sign out"
 * pill used to occupy (profile-menu.tsx is where sign-out moved to,
 * under the avatar). Open to every staff role, not just BPLO/Mayor
 * (unlike Audit Trail/Stats) -- this is meant to teach every role how to
 * use their own part of the system.
 *
 * Content is the next task, not this one -- this page exists so the new
 * top-bar link has somewhere real to go rather than a dead route.
 */
export default async function KnowledgeBasePage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  return (
    <>
      <SectionHead title="Knowledge Base" sub="How to use MuniServe -- what's in each section, and what applicants are told and when." />
      <Card className="p-6">
        <p className="text-[13.5px] text-ink-soft">Content is on its way -- check back soon.</p>
      </Card>
    </>
  );
}
