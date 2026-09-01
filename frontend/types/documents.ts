export type DocCategory = "policy" | "contract" | "form" | "handbook" | "personal" | "other";
export type DocVisibility = "company" | "personal";

export type RepositoryDocument = {
  id: number;
  title: string;
  category: DocCategory;
  visibility: DocVisibility;
  employee: number | null;
  employee_name: string | null;
  description: string;
  original_filename: string;
  uploaded_by_name: string | null;
  created_at: string;
};

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type SignatureStatus = "pending" | "signed" | "declined";

export type DocumentSignature = {
  id: number;
  signer: number;
  signer_name: string | null;
  status: SignatureStatus;
  signed_name: string;
  signed_at: string | null;
  decline_reason: string;
  order: number;
};

export type SignatureRequest = {
  id: number;
  document: number;
  document_title: string;
  message: string;
  status: "pending" | "completed" | "cancelled";
  requested_by_name: string | null;
  signatures: DocumentSignature[];
  created_at: string;
  completed_at: string | null;
};

export type MySignature = {
  id: number;
  request_id: number;
  document_id: number;
  document_title: string;
  message: string;
  status: SignatureStatus;
  signed_at: string | null;
  requested_by_name: string | null;
  created_at: string;
};
