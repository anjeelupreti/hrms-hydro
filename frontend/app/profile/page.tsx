"use client";

import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import PageContainer from "@/components/shell/PageContainer";
import { useMe } from "@/hooks/useMe";
import { employeeHref } from "@/lib/employeeProfile";

/**
 * "My profile" is somebody's own employee profile, so it is the same page.
 *
 * This used to be a fourth view of a record that already had three, with its
 * own tabs, its own header and its own idea of which facts belong on a person.
 * Keeping two meant every change had to be made twice, and the two drifted:
 * an employee's own page grew a Personal tab the HR view never got, and the HR
 * view grew a Lifecycle tab the employee's own page never got — for no reason
 * either could state.
 *
 * The route stays because it is in the sidebar, in old links and in people's
 * habits.
 *
 * **It forwards to the record, because that is what "My profile" means.** This
 * used to land on My workspace on the argument that the employee record is the
 * HR view of a person. That reasoning does not survive contact with the menu it
 * sits in: somebody clicking their own face expects to see their own details —
 * their department, their contact numbers, their documents — and being put on a
 * dashboard instead reads as a broken link. My workspace has its own row in the
 * sidebar for people who want it.
 *
 * The workspace remains the destination for an account with **no employee
 * record** — an administrator who is not on the payroll has no profile to show,
 * and the honest answer is the page that does have something on it.
 */
export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <Skeleton variant="rounded" height={260} />
        </PageContainer>
      }
    >
      <ProfileRedirect />
    </Suspense>
  );
}

function ProfileRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: me, isLoading } = useMe();
  const employeeId = me?.employee_id ?? null;

  useEffect(() => {
    if (isLoading) return;
    if (employeeId != null) {
      // `?tab=payroll` and the portal's chips name a tab; the account menu's
      // bare link does not. Either way the destination is the record.
      const query = searchParams.toString();
      router.replace(`${employeeHref(employeeId)}${query ? `?${query}` : ""}`);
      return;
    }
    // Nothing to show, and the workspace does have something on it.
    router.replace("/portal");
  }, [employeeId, isLoading, router, searchParams]);

  if (isLoading || employeeId != null) {
    return (
      <PageContainer>
        <Skeleton variant="rounded" height={260} />
      </PageContainer>
    );
  }

  // Shown for the instant before the redirect above lands, and if it somehow
  // does not: an administrator who is not themselves on the payroll has no
  // record to open, which beats sending them to `/employees/null`.
  return (
    <PageContainer>
      <Alert severity="info">
        This account has no employee record, so there is no profile to show —
        taking you to My workspace.
      </Alert>
    </PageContainer>
  );
}
