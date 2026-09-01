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
 * habits. It now forwards, carrying `?tab=` through so the portal's "My
 * payslips" chip still lands on the payslips.
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
    if (employeeId == null) return;
    const query = searchParams.toString();
    router.replace(employeeHref(employeeId) + (query ? `?${query}` : ""));
  }, [employeeId, router, searchParams]);

  if (isLoading || employeeId != null) {
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
