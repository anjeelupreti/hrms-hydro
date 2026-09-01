"use client";

import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/crm/clients", label: "Clients" },
  { href: "/crm/deals", label: "Deals" },
  // The client desk sits beside deals rather than under a separate
  // "support" heading: the requester is a client the CRM already tracks,
  // and one place shows their deals and their open concerns together.
  { href: "/crm/tickets", label: "Client desk" },
  { href: "/crm/invoices", label: "Invoices" },
];

export default function CrmSubNav() {
  const pathname = usePathname();
  const value = TABS.findIndex((tab) => pathname.startsWith(tab.href));

  return (
    <Stack sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
      <Tabs value={value === -1 ? 0 : value}>
        {TABS.map((tab) => (
          <Tab key={tab.href} label={tab.label} component={Link} href={tab.href} />
        ))}
      </Tabs>
    </Stack>
  );
}
