export type ClientStatus = "active" | "inactive";

export type Client = {
  id: number;
  name: string;
  industry: string;
  website: string;
  address: string;
  notes: string;
  status: ClientStatus;
};

export type Contact = {
  id: number;
  client: number;
  client_name: string;
  name: string;
  title: string;
  email: string;
  phone: string;
};

export type DealStage = "lead" | "qualified" | "proposal" | "won" | "lost";

export type Deal = {
  id: number;
  client: number;
  client_name: string;
  title: string;
  stage: DealStage;
  value: string;
  expected_close_date: string | null;
  owner: number | null;
  owner_name: string | null;
};



// Projects, sprints and tasks live in `types/projects.ts` — they moved out of
// the `crm` app with the models. An invoice still points at one by id.
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export type InvoiceLineItem = {
  id?: number;
  description: string;
  quantity: string;
  unit_price: string;
  order?: number;
  amount?: string;
};

export type Invoice = {
  id: number;
  client: number;
  client_name: string;
  project: number | null;
  number: string;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  currency: string;
  notes: string;
  line_items: InvoiceLineItem[];
  total: string;
};

export type ActivityType = "call" | "email" | "meeting" | "note";

export type Activity = {
  id: number;
  activity_type: ActivityType;
  notes: string;
  occurred_at: string;
  related_type: "client" | "contact" | "deal";
  related_id: number;
  related_label: string | null;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
