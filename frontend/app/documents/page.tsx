"use client";

import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import FolderIcon from "@mui/icons-material/Folder";
import HistoryEduIcon from "@mui/icons-material/HistoryEdu";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import DateText from "@/components/common/DateText";
import EmptyState from "@/components/common/EmptyState";
import { EmployeePicker } from "@/components/common/pickers";
import SearchField from "@/components/common/SearchField";
import PageContainer from "@/components/shell/PageContainer";
import PageHeader from "@/components/shell/PageHeader";
import { useTextFilter } from "@/hooks/useTextFilter";
import {
  useDeclineSignature,
  useDeleteDocument,
  useMySignatures,
  useRepositoryDocuments,
  useRequestSignatures,
  useSignDocument,
  useUploadDocument,
} from "@/hooks/useDocuments";
import { useCan, useMe } from "@/hooks/useMe";
import type { DocCategory, DocVisibility, MySignature } from "@/types/documents";

const CATEGORIES: { value: DocCategory; label: string }[] = [
  { value: "policy", label: "Policy" },
  { value: "contract", label: "Contract" },
  { value: "form", label: "Form" },
  { value: "handbook", label: "Handbook" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other" },
];

export default function DocumentsPage() {
  const { data: me } = useMe();
  const isHR = useCan("people.manage");
  const { data, isLoading } = useRepositoryDocuments();
  const { data: mySigs } = useMySignatures();
  const deleteDoc = useDeleteDocument();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [requestFor, setRequestFor] = useState<{ id: number; title: string } | null>(null);
  const [signItem, setSignItem] = useState<MySignature | null>(null);

  const docs = data?.results ?? [];
  const pendingToSign = (mySigs?.results ?? []).filter((s) => s.status === "pending");

  const { query, setQuery, filtered, isEmptyResult } = useTextFilter(docs, (d) => [
    d.title,
    d.description,
    d.category,
    d.visibility === "company" ? "company" : d.employee_name,
    d.uploaded_by_name,
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Documents"
        subtitle="Company policies, forms and your personal documents"
        icon={<FolderIcon />}
        actions={
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search documents…"
              label="Search documents by title, category, scope or uploader"
            />
            <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => setUploadOpen(true)}>
              Upload
            </Button>
          </>
        }
      />

      {pendingToSign.length > 0 && (
        <Card sx={{ mb: 3, borderColor: "warning.main" }}>
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
              <HistoryEduIcon color="warning" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Waiting for your signature ({pendingToSign.length})
              </Typography>
            </Stack>
            <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
              {pendingToSign.map((s) => (
                <Stack
                  key={s.id}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ py: 1, alignItems: { sm: "center" }, justifyContent: "space-between" }}
                >
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {s.document_title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Requested by {s.requested_by_name ?? "—"}
                      {s.message ? ` · ${s.message}` : ""}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      component={Link}
                      href={`/api/proxy/documents/repository/${s.document_id}/download`}
                      target="_blank"
                      rel="noopener"
                      startIcon={<DownloadIcon />}
                    >
                      Review
                    </Button>
                    <Button size="small" variant="contained" startIcon={<HistoryEduIcon />} onClick={() => setSignItem(s)}>
                      Sign
                    </Button>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <TableContainer component={Box} sx={{ bgcolor: "background.paper", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Scope</TableCell>
              <TableCell>Uploaded by</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((d) => (
              <TableRow key={d.id} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {d.title}
                  </Typography>
                  {d.description && (
                    <Typography variant="caption" color="text.secondary">
                      {d.description}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ textTransform: "capitalize" }}>{d.category}</TableCell>
                <TableCell>
                  {d.visibility === "company" ? (
                    <Chip size="small" label="Company" color="primary" variant="outlined" />
                  ) : (
                    <Chip size="small" label={d.employee_name ?? "Personal"} variant="outlined" />
                  )}
                </TableCell>
                <TableCell>{d.uploaded_by_name ?? "—"}</TableCell>
                <TableCell><DateText value={d.created_at} /></TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    title="Download"
                    component={Link}
                    href={`/api/proxy/documents/repository/${d.id}/download`}
                    target="_blank"
                    rel="noopener"
                  >
                    <DownloadIcon fontSize="small" />
                  </IconButton>
                  {isHR && (
                    <Tooltip title="Request signatures">
                      <IconButton size="small" onClick={() => setRequestFor({ id: d.id, title: d.title })}>
                        <HistoryEduIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {(isHR || d.employee === me?.employee_id) && (
                    <IconButton size="small" color="error" title="Delete" onClick={() => deleteDoc.mutate(d.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    variant={isEmptyResult ? "noResults" : "empty"}
                    title={isEmptyResult ? `No documents match “${query}”` : "No documents yet"}
                    description={
                      isEmptyResult
                      ? "Try a different search, or clear it to see everything."
                      : "Policies, contracts and forms, with signatures tracked against them. Company-wide files are visible to everyone; personal ones only to the employee and HR."
                    }
                    compact
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {uploadOpen && (
        <UploadDialog
          isHR={Boolean(isHR)}
          selfEmployeeId={me?.employee_id ?? null}
          onClose={() => setUploadOpen(false)}
        />
      )}
      {requestFor && <RequestSignatureDialog document={requestFor} onClose={() => setRequestFor(null)} />}
      {signItem && <SignDialog item={signItem} onClose={() => setSignItem(null)} />}
    </PageContainer>
  );
}

function RequestSignatureDialog({
  document,
  onClose,
}: {
  document: { id: number; title: string };
  onClose: () => void;
}) {
  const request = useRequestSignatures();
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);


  async function submit() {
    setError(null);
    try {
      await request.mutateAsync({ documentId: document.id, signer_ids: selected, message });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Request signatures</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Ask people to e-sign <strong>{document.title}</strong>.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="Message (optional)"
          fullWidth
          multiline
          minRows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          sx={{ mb: 1 }}
        />
        {/* Was a scrolling checkbox list of whatever the first page held, so
            on a large company most people could not be asked to sign at all. */}
        <EmployeePicker
          multiple
          label="Signers"
          value={selected}
          onChange={setSelected}
          helperText="Search by name, employee code, role or department."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={request.isPending || selected.length === 0}>
          {request.isPending ? "Sending…" : `Request (${selected.length})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SignDialog({ item, onClose }: { item: MySignature; onClose: () => void }) {
  const sign = useSignDocument();
  const decline = useDeclineSignature();
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSign() {
    setError(null);
    try {
      await sign.mutateAsync({ id: item.id, signed_name: name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign.");
    }
  }

  async function doDecline() {
    setError(null);
    try {
      await decline.mutateAsync({ id: item.id });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decline.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Sign “{item.document_title}”</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Type your full name to adopt it as your electronic signature. Your name, the time, and
          your IP address are recorded as proof of signing.
        </Typography>
        <TextField label="Type your full name" fullWidth value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 1 }} />
        <FormControlLabel
          control={<Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} />}
          label="I agree this is my legally binding electronic signature."
        />
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={doDecline} disabled={decline.isPending}>
          Decline
        </Button>
        <Button variant="contained" onClick={doSign} disabled={sign.isPending || !name.trim() || !agree}>
          {sign.isPending ? "Signing…" : "Adopt & sign"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function UploadDialog({
  isHR,
  selfEmployeeId,
  onClose,
}: {
  isHR: boolean;
  selfEmployeeId: number | null;
  onClose: () => void;
}) {
  const upload = useUploadDocument();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocCategory>("policy");
  const [visibility, setVisibility] = useState<DocVisibility>(isHR ? "company" : "personal");
  const [employeeId, setEmployeeId] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!title.trim() || !file) {
      setError("Title and a file are required.");
      return;
    }
    if (visibility === "personal" && !employeeId && isHR) {
      setError("Select the employee for this personal document.");
      return;
    }
    const form = new FormData();
    form.append("title", title);
    form.append("category", category);
    form.append("visibility", visibility);
    form.append("description", description);
    // HR picks the employee; a non-HR employee uploads for themselves.
    const personalEmployee = isHR ? employeeId : selfEmployeeId;
    if (visibility === "personal" && personalEmployee) form.append("employee", String(personalEmployee));
    form.append("file", file);
    try {
      await upload.mutateAsync(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Upload document</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextField select label="Category" fullWidth value={category} onChange={(e) => setCategory(e.target.value as DocCategory)}>
            {CATEGORIES.map((c) => (
              <MenuItem key={c.value} value={c.value}>
                {c.label}
              </MenuItem>
            ))}
          </TextField>
          {isHR && (
            <TextField select label="Scope" fullWidth value={visibility} onChange={(e) => setVisibility(e.target.value as DocVisibility)}>
              <MenuItem value="company">Company-wide</MenuItem>
              <MenuItem value="personal">Personal (one employee)</MenuItem>
            </TextField>
          )}
          {isHR && visibility === "personal" && (
            <EmployeePicker
              value={employeeId === "" ? null : employeeId}
              onChange={(id) => setEmployeeId(id ?? "")}
              required
            />
          )}
          <TextField label="Description" fullWidth multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
            {file ? file.name : "Choose file"}
            <input hidden type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={upload.isPending}>
          Upload
        </Button>
      </DialogActions>
    </Dialog>
  );
}
