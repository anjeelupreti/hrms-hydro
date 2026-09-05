export type Announcement = {
  id: number;
  title: string;
  body: string;
  department: number | null;
  department_name: string | null;
  /** Named people, alongside or instead of a department. The audience is
   *  the union; neither set means the whole company. */
  recipients: number[];
  recipient_names: { id: number; name: string; employee_code: string }[];
  require_acknowledgement: boolean;
  author_name: string | null;
  /** Whether the reader wrote it — answered by the server, because two
   *  people share a name often enough and the receipts are gated on it. */
  is_mine: boolean;
  /** Counted against everybody it was addressed to — counting only those who
   *  opened it would make every announcement look fully read. */
  metrics: { audience: number; seen: number; acknowledged: number };
  /** The reader's own receipt, so the page knows whether to show the button. */
  my_receipt: { seen_at: string | null; acknowledged_at: string | null } | null;
  pinned: boolean;
  expires_at: string | null;
  posted_by: string | null;
  created_at: string;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
