"use client";

import AddIcon from "@mui/icons-material/Add";
import BarChartIcon from "@mui/icons-material/BarChart";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PollIcon from "@mui/icons-material/Poll";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import EmptyState from "@/components/common/EmptyState";
import SurveyPulse from "@/components/surveys/SurveyPulse";
import PageContainer from "@/components/shell/PageContainer";
import ListControls from "@/components/common/ListControls";
import PageHeader from "@/components/shell/PageHeader";
import { ArchiveButton, ArchiveTabs } from "@/components/common/ArchiveControls";
import { useArchive } from "@/hooks/useCollaboration";
import ListPagination from "@/components/common/ListPagination";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import { useCan } from "@/hooks/useMe";
import {
  useDeleteSurvey,
  useRespondSurvey,
  useSaveSurvey,
  useSurveyResults,
  useSurveys,
  useSurveyStatus,
  type Survey,
  type SurveyQuestion,
} from "@/hooks/useSurveys";

const KINDS: { value: SurveyQuestion["kind"]; label: string }[] = [
  { value: "nps", label: "eNPS (0–10)" },
  { value: "scale5", label: "Rating (1–5)" },
  { value: "text", label: "Free text" },
  { value: "choice", label: "Single choice" },
];
const STATUS_COLOR = { draft: "default", active: "success", closed: "warning" } as const;

export default function SurveysPage() {
  const isHR = useCan("workplace.manage");
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query, 300);
  const { page, pageSize, setPage, setPageSize, reset } = usePagedList();
  const { data } = useSurveys(archived, { search: search || undefined, page, pageSize });

  useEffect(() => {
    reset();
  }, [archived, search, reset]);
  const archiveSurvey = useArchive("surveys", "surveys");
  const statusMut = useSurveyStatus();
  const del = useDeleteSurvey();
  const [editing, setEditing] = useState<Survey | null | undefined>(undefined);
  const [responding, setResponding] = useState<Survey | null>(null);
  const [resultsFor, setResultsFor] = useState<number | null>(null);

  const surveys = data?.results ?? [];
  // Searched on the server, so the match is over every survey rather than the
  // page in hand.
  const filtered = surveys;
  const isEmptyResult = Boolean(search) && surveys.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Surveys & eNPS"
        subtitle="Pulse surveys and employee net promoter score"
        icon={<PollIcon />}
        actions={
          <>
            
            {isHR && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>
                New survey
              </Button>
            )}
          </>
        }
      />

      <ListControls
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search surveys…"
        searchLabel="Search surveys by title, status or question"
      />
      {/* The reading, before the list — and only on the live tab. A pulse
          taken across archived surveys is a pulse on something that stopped. */}
      {archived ? null : <SurveyPulse surveys={surveys} />}
      <Stack spacing={1.5}>
        <ArchiveTabs archived={archived} onChange={setArchived} />
        {filtered.length === 0 ? (
          <EmptyState
            variant={isEmptyResult ? "noResults" : "empty"}
            title={isEmptyResult ? `No surveys match “${query}”` : "No surveys yet"}
            description={
              isEmptyResult
              ? "Try a different search, or clear it to see everything."
              : "Run pulse surveys and eNPS to find out how people are actually doing. Anonymous surveys record no respondent id at all."
            }
            surface
          />
        ) : (
          filtered.map((s) => (
            <Card key={s.id}>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {s.title}
                      {s.anonymous && <Chip size="small" label="Anonymous" sx={{ ml: 1 }} />}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {s.questions.length} question(s) · {s.response_count} response(s)
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Chip size="small" label={s.status} color={STATUS_COLOR[s.status]} />
                    {isHR && (
                      <ArchiveButton
                        archived={archived}
                        noun="survey"
                        onToggle={() => archiveSurvey.mutate({ id: s.id, archived })}
                      />
                    )}
                    {s.status === "active" && (
                      <Button size="small" variant="contained" onClick={() => setResponding(s)}>
                        Respond
                      </Button>
                    )}
                    {isHR && (
                      <>
                        {s.status === "draft" && (
                          <Button size="small" onClick={() => statusMut.mutate({ id: s.id, action: "publish" })}>
                            Publish
                          </Button>
                        )}
                        {s.status === "active" && (
                          <Button size="small" onClick={() => statusMut.mutate({ id: s.id, action: "close" })}>
                            Close
                          </Button>
                        )}
                        <IconButton size="small" title="Results" onClick={() => setResultsFor(s.id)}>
                          <BarChartIcon fontSize="small" />
                        </IconButton>
                        {s.status === "draft" && (
                          <IconButton size="small" title="Edit" onClick={() => setEditing(s)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        )}
                        <IconButton size="small" color="error" onClick={() => del.mutate(s.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))
        )}
      </Stack>

      <ListPagination
        page={page}
        pageSize={pageSize}
        count={data?.count ?? 0}
        noun="surveys"
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {editing !== undefined && <SurveyDialog survey={editing} onClose={() => setEditing(undefined)} />}
      {responding && <RespondDialog survey={responding} onClose={() => setResponding(null)} />}
      {resultsFor != null && <ResultsDialog surveyId={resultsFor} onClose={() => setResultsFor(null)} />}
    </PageContainer>
  );
}

function SurveyDialog({ survey, onClose }: { survey: Survey | null; onClose: () => void }) {
  const save = useSaveSurvey();
  const [title, setTitle] = useState(survey?.title ?? "");
  const [anonymous, setAnonymous] = useState(survey?.anonymous ?? false);
  const [questions, setQuestions] = useState<SurveyQuestion[]>(
    survey?.questions?.length ? survey.questions : [{ text: "", kind: "nps", choices: [] }]
  );
  const [error, setError] = useState<string | null>(null);

  function setQ(i: number, patch: Partial<SurveyQuestion>) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  async function submit() {
    setError(null);
    const clean = questions
      .filter((q) => q.text.trim())
      .map((q, i) => ({ ...q, order: i, choices: q.kind === "choice" ? q.choices.filter(Boolean) : [] }));
    if (!title.trim() || clean.length === 0) {
      setError("A title and at least one question are required.");
      return;
    }
    try {
      await save.mutateAsync({ id: survey?.id, values: { title, anonymous, questions: clean } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{survey ? "Edit survey" : "New survey"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
          <TextField select label="Anonymous" value={anonymous ? "1" : "0"} onChange={(e) => setAnonymous(e.target.value === "1")} sx={{ maxWidth: 200 }}>
            <MenuItem value="0">Named responses</MenuItem>
            <MenuItem value="1">Anonymous</MenuItem>
          </TextField>
          <Typography variant="overline" color="text.secondary">Questions</Typography>
          {questions.map((q, i) => (
            <Stack key={i} spacing={1} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
              <Stack direction="row" spacing={1}>
                <TextField label={`Question ${i + 1}`} value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} size="small" sx={{ flex: 1 }} />
                <TextField select label="Type" value={q.kind} onChange={(e) => setQ(i, { kind: e.target.value as SurveyQuestion["kind"] })} size="small" sx={{ width: 150 }}>
                  {KINDS.map((k) => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
                </TextField>
                <IconButton size="small" color="error" onClick={() => setQuestions((p) => p.filter((_, idx) => idx !== i))} disabled={questions.length === 1}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
              {q.kind === "choice" && (
                <TextField
                  size="small"
                  label="Choices (comma-separated)"
                  value={q.choices.join(", ")}
                  onChange={(e) => setQ(i, { choices: e.target.value.split(",").map((c) => c.trim()) })}
                />
              )}
            </Stack>
          ))}
          <Button size="small" startIcon={<AddIcon />} onClick={() => setQuestions((p) => [...p, { text: "", kind: "scale5", choices: [] }])} sx={{ alignSelf: "flex-start" }}>
            Add question
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function RespondDialog({ survey, onClose }: { survey: Survey; onClose: () => void }) {
  const respond = useRespondSurvey();
  const [values, setValues] = useState<Record<number, { numeric_value?: number; text_value?: string }>>({});
  const [error, setError] = useState<string | null>(null);

  function setAnswer(qid: number, patch: { numeric_value?: number; text_value?: string }) {
    setValues((prev) => ({ ...prev, [qid]: { ...prev[qid], ...patch } }));
  }

  async function submit() {
    setError(null);
    const answers = survey.questions
      .filter((q) => q.id != null && values[q.id!] != null)
      .map((q) => ({ question: q.id!, ...values[q.id!] }));
    try {
      await respond.mutateAsync({ id: survey.id, answers });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit.");
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{survey.title}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {survey.anonymous && <Alert severity="info" sx={{ mb: 2 }}>Your response is anonymous.</Alert>}
        <Stack spacing={3}>
          {survey.questions.map((q) => (
            <Box key={q.id}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{q.text}</Typography>
              {q.kind === "nps" && (
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                  {Array.from({ length: 11 }, (_, n) => (
                    <Button key={n} size="small" variant={values[q.id!]?.numeric_value === n ? "contained" : "outlined"} onClick={() => setAnswer(q.id!, { numeric_value: n })} sx={{ minWidth: 40 }}>
                      {n}
                    </Button>
                  ))}
                </Stack>
              )}
              {q.kind === "scale5" && (
                <Stack direction="row" spacing={0.5}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Button key={n} size="small" variant={values[q.id!]?.numeric_value === n ? "contained" : "outlined"} onClick={() => setAnswer(q.id!, { numeric_value: n })} sx={{ minWidth: 44 }}>
                      {n}
                    </Button>
                  ))}
                </Stack>
              )}
              {q.kind === "choice" && (
                <Stack spacing={0.5}>
                  {q.choices.map((c, idx) => (
                    <Button key={idx} size="small" variant={values[q.id!]?.numeric_value === idx ? "contained" : "outlined"} onClick={() => setAnswer(q.id!, { numeric_value: idx })} sx={{ justifyContent: "flex-start" }}>
                      {c}
                    </Button>
                  ))}
                </Stack>
              )}
              {q.kind === "text" && (
                <TextField fullWidth multiline minRows={2} size="small" value={values[q.id!]?.text_value ?? ""} onChange={(e) => setAnswer(q.id!, { text_value: e.target.value })} />
              )}
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={respond.isPending}>Submit</Button>
      </DialogActions>
    </Dialog>
  );
}

function ResultsDialog({ surveyId, onClose }: { surveyId: number; onClose: () => void }) {
  const { data } = useSurveyResults(surveyId);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Results</DialogTitle>
      <DialogContent dividers>
        {!data ? (
          <Typography variant="body2" color="text.secondary">Loading…</Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {data.response_count} response(s)
            </Typography>
            <Stack spacing={2.5}>
              {data.questions.map((q) => (
                <Box key={q.id}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{q.text}</Typography>
                  {q.kind === "nps" && (
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                      <Chip label={`eNPS ${q.nps}`} color={(q.nps ?? 0) >= 0 ? "success" : "error"} />
                      <Typography variant="caption" color="text.secondary">
                        {q.promoters} promoters · {q.passives} passives · {q.detractors} detractors
                      </Typography>
                    </Stack>
                  )}
                  {q.kind === "scale5" && (
                    <Typography variant="body2" color="text.secondary">Average: {q.average} / 5 ({q.count} responses)</Typography>
                  )}
                  {q.kind === "choice" && q.counts && (
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                      {Object.entries(q.counts).map(([label, n]) => (
                        <Chip key={label} size="small" label={`${label}: ${n}`} />
                      ))}
                    </Stack>
                  )}
                  {q.kind === "text" && (
                    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                      {(q.answers ?? []).length === 0 ? (
                        <Typography variant="caption" color="text.secondary">No answers.</Typography>
                      ) : (
                        q.answers!.map((a, i) => (
                          <Typography key={i} variant="body2" sx={{ p: 1, bgcolor: "action.hover", borderRadius: 1 }}>
                            {a}
                          </Typography>
                        ))
                      )}
                    </Stack>
                  )}
                </Box>
              ))}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
