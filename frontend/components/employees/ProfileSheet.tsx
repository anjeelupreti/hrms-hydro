"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import DateText from "@/components/common/DateText";
import { useCompanyProfile } from "@/hooks/useOrganization";
import { withCode } from "@/lib/people";
import type { EmployeeProfile } from "@/hooks/useEmployeeProfile";
import type { EmployeeDetail } from "@/types/employees";

/**
 * The employee record as a printed document.
 *
 * 🔴 **Printing this page printed one tab.** The profile renders only the open
 * tab — `{active === "overview" ? … : null}` — so `window.print()` produced the
 * header, whichever tab happened to be showing, and nothing else. Somebody
 * printing an employee record for a file expects the record, not a screenshot
 * of the tab they were last looking at.
 *
 * So this is a separate sheet: hidden on screen, the only thing shown on paper.
 * It draws from the same two objects the page already holds, which means it
 * inherits their permissions exactly — `EmployeeDetailSerializer` strips the
 * statutory and banking fields for anybody who is neither HR nor the person
 * themselves, so those sections simply do not render for a colleague. A print
 * view that fetched its own data would be a second place for that rule to be
 * got wrong.
 *
 * **A section with nothing in it is not printed.** A form with fifteen empty
 * labelled boxes reads as a record nobody has filled in; the absence of a
 * heading says the same thing more quietly and leaves the page shorter.
 */

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <Box sx={{ breakInside: "avoid", mb: 1 }}>
      <Typography
        sx={{ fontSize: 9, letterSpacing: 0.4, textTransform: "uppercase", color: "#666" }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: 12 }}>{value}</Typography>
    </Box>
  );
}

/** A heading plus its fields, rendered only when at least one field survives. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const kept = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(kept) && kept.every((c) => c === null)) return null;
  return (
    <Box sx={{ mt: 2, breakInside: "avoid" }}>
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          borderBottom: "1px solid #000",
          pb: 0.4,
          mb: 1,
        }}
      >
        {title}
      </Typography>
      {/* Two columns on paper: an A4 page is wide enough for two and a single
          column of short values wastes half the sheet. */}
      <Box sx={{ columnCount: 2, columnGap: "14mm" }}>{children}</Box>
    </Box>
  );
}

export default function ProfileSheet({
  profile,
  record,
}: {
  /** The public half — always present. */
  profile: EmployeeProfile;
  /** The HR record. Absent for a colleague, and its statutory half is
   *  stripped by the server even when the rest is sent. */
  record?: EmployeeDetail;
}) {
  const { data: company } = useCompanyProfile();

  const supervisors = [...(record?.supervisors ?? [])].sort((a, b) => a.order - b.order);

  return (
    <Box
      className="print-only"
      sx={{
        display: "none",
        "@media print": { display: "block" },
        color: "#000",
        fontFamily: "inherit",
      }}
    >
      {/* Letterhead. A printed record leaves the building; whose record it is
          has to be on it. */}
      <Stack
        direction="row"
        sx={{ alignItems: "flex-start", borderBottom: "2px solid #000", pb: 1, mb: 2 }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 800 }}>
            {company?.name ?? "Employee record"}
          </Typography>
          <Typography sx={{ fontSize: 10, color: "#444" }}>
            Employee record · printed <DateText value={new Date().toISOString()} />
          </Typography>
        </Box>
        {profile.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.photo}
            alt=""
            style={{ width: 68, height: 68, objectFit: "cover", border: "1px solid #999" }}
          />
        ) : null}
      </Stack>

      <Typography sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>
        {profile.full_name}
      </Typography>
      <Typography sx={{ fontSize: 11, color: "#444", mb: 0.5 }}>
        {[profile.designation_title, profile.department_name].filter(Boolean).join(" · ") || "—"}
      </Typography>
      <Typography sx={{ fontSize: 11 }}>
        {profile.employee_code} · {profile.employment_status.replace("_", " ")}
      </Typography>

      <Section title="Employment">
        <Field label="Employed by" value={record?.primary_company_name} />
        <Field
          label="Also works for"
          value={(record?.secondary_company_names ?? []).join(", ") || null}
        />
        <Field label="Job title" value={profile.designation_title} />
        <Field label="Department" value={profile.department_name} />
        <Field label="Corporate post" value={record?.corporate_post_name} />
        <Field label="Corporate role" value={record?.corporate_role_name} />
        <Field label="Reports to" value={profile.manager_name} />
        <Field
          label="Supervisors"
          value={
            supervisors.length
              ? supervisors.map((s) => withCode(s.name, s.employee_code)).join(", ")
              : null
          }
        />
        <Field
          label="Joined"
          value={profile.date_joined ? <DateText value={profile.date_joined} /> : null}
        />
      </Section>

      <Section title="Contact">
        <Field label="Email" value={profile.email} />
        <Field label="Phone" value={profile.phone} />
        <Field label="Office phone" value={record?.office_phone} />
        <Field label="Office email" value={record?.office_email} />
        <Field label="Personal phone" value={record?.personal_phone} />
        <Field label="Personal email" value={record?.personal_email} />
        <Field
          label="Permanent address"
          value={
            record?.permanent_address ||
            [profile.address, profile.city, profile.country].filter(Boolean).join(", ") ||
            null
          }
        />
        {/* Only when it differs — "temporary: same as permanent" answers
            nothing and costs a line on paper. */}
        <Field
          label="Current address"
          value={
            record?.temporary_address && record.temporary_address !== record.permanent_address
              ? record.temporary_address
              : null
          }
        />
        <Field label="Blood group" value={record?.blood_group || null} />
      </Section>

      {/* Stripped by the server for anybody who is neither HR nor the person
          themselves, so this whole block disappears for a colleague without
          this component having to know the rule. */}
      <Section title="Statutory and banking">
        <Field
          label="Legal name"
          value={
            [record?.legal_first_name, record?.legal_middle_name, record?.legal_last_name]
              .filter(Boolean)
              .join(" ") || null
          }
        />
        <Field label="Date of birth" value={record?.date_of_birth ? <DateText value={record.date_of_birth} /> : null} />
        <Field label="Gender" value={record?.gender || null} />
        <Field label="Marital status" value={record?.marital_status || null} />
        <Field label="Citizenship number" value={record?.citizenship_number || null} />
        <Field label="PAN" value={record?.pan_number || null} />
        <Field label="Bank" value={record?.bank_name || null} />
        <Field label="Account number" value={record?.bank_account_number || null} />
        <Field label="Provident fund" value={record?.pf_number || null} />
        <Field label="SSF number" value={record?.ssf_number || null} />
      </Section>

      {(profile.skills ?? []).length > 0 ? (
        <Section title="Skills">
          <Field label="On file" value={(profile.skills ?? []).join(", ")} />
        </Section>
      ) : null}

      {(profile.experiences ?? []).length > 0 ? (
        <Box sx={{ mt: 2, breakInside: "avoid" }}>
          <Typography
            sx={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              borderBottom: "1px solid #000",
              pb: 0.4,
              mb: 1,
            }}
          >
            Experience
          </Typography>
          {(profile.experiences ?? []).map((role, index) => (
            <Box key={index} sx={{ mb: 0.75, breakInside: "avoid" }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                {role.title}
                {role.company ? ` — ${role.company}` : ""}
              </Typography>
              {/* Years, which is how the record holds them — a month and a
                  day on a previous employer is precision nobody supplied. */}
              {role.start_year ? (
                <Typography sx={{ fontSize: 10, color: "#555" }}>
                  {role.start_year} – {role.end_year ?? "present"}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      ) : null}

      <Typography sx={{ fontSize: 9, color: "#666", mt: 3, borderTop: "1px solid #ccc", pt: 0.5 }}>
        {company?.name ?? ""} · This record is confidential and is issued for internal use.
      </Typography>
    </Box>
  );
}
