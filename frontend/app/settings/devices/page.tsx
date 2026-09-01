"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";

import DeviceManager from "@/components/attendance/DeviceManager";
import DeviceEventLog from "@/components/attendance/DeviceEventLog";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useCan } from "@/hooks/useMe";
import FingerprintIcon from "@mui/icons-material/Fingerprint";

export default function DevicesSettingsPage() {
  const canManage = useCan("attendance.manage");

  return (
    <PageContainer>
      <PageHeader
        title="Attendance devices"
        subtitle="Biometric terminals allowed to push punches into this system"
        icon={<FingerprintIcon />}
      />

      {canManage ? (
        <Box sx={{ mt: 3 }}>
          <DeviceManager />
          {/* Directly under the terminals, because it is the question the
              terminal list cannot answer: not "is the device registered" but
              "is anything it sends actually landing". */}
          <DeviceEventLog />
        </Box>
      ) : (
        <Alert severity="info" sx={{ mt: 3 }}>
          Only HR admins can manage attendance devices — issuing a token is
          effectively minting a credential that can write attendance.
        </Alert>
      )}
    </PageContainer>
  );
}
