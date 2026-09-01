"use client";

/**
 * The employment record: the legal name, the statutory numbers, the bank.
 *
 * **Nothing here decides who may look.** `EmployeeDetailSerializer` strips these
 * fields in `to_representation` for anyone who is neither HR nor the person
 * themselves, so an unauthorised reader receives a payload with the keys simply
 * absent. This renders what arrived. A second permission check in the browser
 * would be a second opinion about the same question, and the two would
 * eventually disagree — at which point one of them is showing something it
 * should not, or hiding something an owner is entitled to.
 *
 * That is also why the sections disappear rather than showing "—". A dash means
 * *nobody has filled this in*, which is a thing HR should act on. An empty
 * section for a viewer who was never sent the data would be a lie about the
 * state of the record.
 *
 * The bank account number arrives already masked, by the server, even for HR: a
 * full number is only needed to build a payment file, and that is a server-side
 * job. Nobody needs it rendered in a browser where it can be photographed.
 */

import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import BadgeIcon from "@mui/icons-material/Badge";
import DescriptionIcon from "@mui/icons-material/Description";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import DateText from "@/components/common/DateText";
import type { EmployeeDetail } from "@/types/employees";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
        {/* A dash is a real statement: the field exists, is permitted, and is
            empty — which is something for HR to chase. */}
        {value === "" || value === null || value === undefined ? (
          <Box component="span" sx={{ color: "text.disabled" }}>
            Not recorded
          </Box>
        ) : (
          value
        )}
      </Typography>
    </Box>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
          {icon}
          <Typography variant="overline" color="text.secondary">
            {title}
          </Typography>
        </Stack>
        <Grid container spacing={2}>
          {children}
        </Grid>
      </CardContent>
    </Card>
  );
}

const Cell = ({ children }: { children: ReactNode }) => (
  <Grid size={{ xs: 6, sm: 4, md: 3 }}>{children}</Grid>
);

export default function EmploymentRecordPanel({ employee }: { employee: EmployeeDetail }) {
  // Presence of the key, not truthiness of the value. An employee whose PAN is
  // genuinely blank still gets the section — they are allowed to see it, and it
  // is the blank that needs filling in. Only a viewer the server stripped the
  // fields from has no key at all.
  const maySeeStatutory = "pan_number" in employee;
  const maySeeBank = "bank_account_number" in employee;
  const maySeeIdentity = "legal_first_name" in employee;

  if (!maySeeStatutory && !maySeeBank && !maySeeIdentity) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
            The statutory and banking record is visible to HR and to the person it
            describes.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const legalName = [
    employee.legal_first_name,
    employee.legal_middle_name,
    employee.legal_last_name,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Box>
      <Section title="Employment" icon={<BadgeIcon fontSize="small" color="primary" />}>
        <Cell>
          <Field label="Employee code" value={employee.employee_code} />
        </Cell>
        <Cell>
          <Field label="Joined" value={<DateText value={employee.date_joined} />} />
        </Cell>
        <Cell>
          <Field
            label="Probation ends"
            value={
              employee.probation_end_date ? (
                <DateText value={employee.probation_end_date} />
              ) : (
                ""
              )
            }
          />
        </Cell>
        <Cell>
          <Field label="Status" value={employee.employment_status.replace("_", " ")} />
        </Cell>
        <Cell>
          <Field
            label="Date of birth"
            value={employee.date_of_birth ? <DateText value={employee.date_of_birth} /> : ""}
          />
        </Cell>
        <Cell>
          <Field label="Gender" value={employee.gender} />
        </Cell>
      </Section>

      {maySeeIdentity ? (
        <Section title="Identity" icon={<DescriptionIcon fontSize="small" color="primary" />}>
          <Cell>
            <Field label="Legal name" value={legalName} />
          </Cell>
          <Cell>
            <Field label="Marital status" value={employee.marital_status} />
          </Cell>
          <Cell>
            <Field label="Citizenship no." value={employee.citizenship_number} />
          </Cell>
          <Cell>
            <Field label="Passport no." value={employee.passport_number} />
          </Cell>
          <Cell>
            <Field
              label="Passport expiry"
              value={employee.passport_expiry ? <DateText value={employee.passport_expiry} /> : ""}
            />
          </Cell>
          <Cell>
            <Field
              label="Citizenship scans"
              value={
                employee.citizenship_front || employee.citizenship_back ? (
                  <Stack direction="row" spacing={1.5}>
                    {employee.citizenship_front ? (
                      <Link href={employee.citizenship_front} target="_blank" rel="noopener">
                        Front
                      </Link>
                    ) : null}
                    {employee.citizenship_back ? (
                      <Link href={employee.citizenship_back} target="_blank" rel="noopener">
                        Back
                      </Link>
                    ) : null}
                  </Stack>
                ) : (
                  ""
                )
              }
            />
          </Cell>
        </Section>
      ) : null}

      {maySeeStatutory ? (
        <Section title="Statutory" icon={<DescriptionIcon fontSize="small" color="primary" />}>
          <Cell>
            <Field label="PAN" value={employee.pan_number} />
          </Cell>
          <Cell>
            <Field label="SSF" value={employee.ssf_number} />
          </Cell>
          <Cell>
            <Field label="Provident fund" value={employee.pf_number} />
          </Cell>
          <Cell>
            <Field label="CIT" value={employee.cit_number} />
          </Cell>
        </Section>
      ) : null}

      {maySeeBank ? (
        <Section title="Bank" icon={<AccountBalanceIcon fontSize="small" color="primary" />}>
          <Cell>
            <Field label="Bank" value={employee.bank_name} />
          </Cell>
          <Cell>
            <Field label="Branch" value={employee.bank_branch} />
          </Cell>
          <Cell>
            <Field label="Account name" value={employee.bank_account_name} />
          </Cell>
          <Cell>
            {/* Already masked upstream — this renders exactly what was sent. */}
            <Field label="Account number" value={employee.bank_account_number} />
          </Cell>
          <Cell>
            <Field label="Account type" value={employee.bank_account_type} />
          </Cell>
        </Section>
      ) : null}
    </Box>
  );
}
