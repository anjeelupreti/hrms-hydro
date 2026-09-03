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
 * **Where it forwards to depends on whether a tab was named.** "My profile" in
 * the account menu is a bare link and now lands on **My workspace** — that is
 * the page somebody signing in wants, and the employee record is the HR view of
 * a person, which is a different question wearing the same words. A link that
 * names a tab (`?tab=payroll`, the portal's "My payslips" chip) still goes to
 * the record, because it is asking for something the workspace does not hold.
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

  const tab = searchParams.get("tab");

  useEffect(() => {
    // No tab named: this is the account menu's "My profile", which belongs on
    // the workspace. It does not need an employee record to get there, so it
    // runs before the `employeeId` guard below.
    if (!tab) {
      router.replace("/portal");
      return;
    }
    if (employeeId == null) return;
    router.replace(`${employeeHref(employeeId)}?${searchParams.toString()}`);
  }, [employeeId, router, searchParams, tab]);

  if (isLoading || !tab || employeeId != null) {
    return (
      <PageContainer>
        <Skeleton variant="rounded" height={260} />
      </PageContainer>
    );
  }

  // An account with no employee record — an administrator who is not
  // themselves on the payroll. There is nothing to forward to, and saying so
  // beats redirecting to `/employees/null`.
  return (
    <PageContainer>
      <Alert severity="info">
        This account has no employee record, so there is no profile to show.
      </Alert>
    </PageContainer>
  );
}
