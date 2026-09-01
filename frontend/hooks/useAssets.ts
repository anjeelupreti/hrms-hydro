"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

/** Named so callers (filter chips, forms) can refer to it without retyping. */
export type AssetStatus = "available" | "assigned" | "maintenance" | "retired";

export type Asset = {
  id: number;
  name: string;
  asset_tag: string;
  category: string;
  serial_number: string;
  status: AssetStatus;
  purchase_date: string | null;
  notes: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_at: string;
  photo_count: number;
  cover_url: string | null;
};

export type AssetPhoto = {
  id: number;
  asset: number;
  image_url: string;
  caption: string;
  uploaded_by_name: string | null;
  created_at: string;
};

/** What kinds of thing an asset's history records. `assigned` and `returned`
 *  are written by the assign and return actions; the rest are recorded by
 *  hand. */
export type AssetEventKind =
  | "acquired"
  | "assigned"
  | "returned"
  | "maintenance"
  | "repaired"
  | "status"
  | "note"
  | "retired"
  | "lost";

export type AssetEvent = {
  id: number;
  asset: number;
  kind: AssetEventKind;
  kind_display: string;
  /** Who was holding it when this happened. Written on the entry rather than
   *  read back from the asset, which by the time of a return is empty. */
  custodian: number | null;
  custodian_name: string | null;
  from_value: string;
  to_value: string;
  note: string;
  occurred_on: string;
  actor_name: string;
  created_at: string;
};

export type AssetAssignment = {
  id: number;
  employee: number;
  employee_name: string | null;
  assigned_at: string;
  returned_at: string | null;
  note: string;
};

type Paginated<T> = { count: number; results: T[] };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const B = "/api/proxy/assets/assets";

export function useAssets(filters: { status?: string; category?: string } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.status) params.set("status", filters.status);
  if (filters.category) params.set("category", filters.category);
  return useQuery({
    queryKey: ["assets", filters],
    queryFn: () => fetchJson<Paginated<Asset>>(`${B}/?${params.toString()}`),
  });
}

export function useMyAssets() {
  return useQuery({ queryKey: ["assets", "mine"], queryFn: () => fetchJson<Asset[]>(`${B}/mine/`) });
}

export function useAssetAssignments(assetId: number | null) {
  return useQuery({
    queryKey: ["assets", "assignments", assetId],
    queryFn: () => fetchJson<AssetAssignment[]>(`${B}/${assetId}/assignments/`),
    enabled: assetId != null,
  });
}

/**
 * Everything that has happened to one asset.
 *
 * Distinct from `useAssetAssignments`, which only answers "who held it and
 * between which dates". Repairs, write-offs and the condition something came
 * back in are not assignments and had nowhere to live.
 */
export function useAssetHistory(assetId: number | null) {
  return useQuery({
    queryKey: ["assets", "history", assetId],
    queryFn: () => fetchJson<AssetEvent[]>(`${B}/${assetId}/history/`),
    enabled: assetId != null,
  });
}

export function useAddAssetEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assetId,
      ...body
    }: {
      assetId: number;
      kind: AssetEventKind;
      note?: string;
      occurred_on?: string;
    }) =>
      fetchJson<AssetEvent>(`${B}/${assetId}/history/`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    meta: { successMessage: "Recorded" },
    // The asset itself may have moved with it — maintenance and retirement
    // both change its status — so the list is invalidated alongside.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useSaveAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Asset> }) =>
      fetchJson<Asset>(id ? `${B}/${id}/` : `${B}/`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    meta: { successMessage: "Asset saved" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${B}/${id}/`, { method: "DELETE" }),
    meta: { successMessage: "Asset deleted" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useAssignAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, employee, note }: { id: number; employee: number; note?: string }) =>
      fetchJson<Asset>(`${B}/${id}/assign/`, { method: "POST", body: JSON.stringify({ employee, note }) }),
    meta: { successMessage: "Asset assigned" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useReturnAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<Asset>(`${B}/${id}/return/`, { method: "POST", body: "{}" }),
    meta: { successMessage: "Asset returned" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export type AssetStatusCounts = {
  total: number;
  available: number;
  assigned: number;
  maintenance: number;
  retired: number;
};

/**
 * Assets per status, counted in SQL.
 *
 * The list is capped at 100 rows, so anything derived from it undercounts on a
 * company with a real inventory — see `core.counts.StatusCountsMixin`.
 */
export function useAssetStatusCounts() {
  return useQuery({
    queryKey: ["assets", "status-counts"],
    queryFn: () => fetchJson<AssetStatusCounts>(`${B}/status-counts`),
    placeholderData: (previous) => previous,
  });
}

// ── Photographs ──────────────────────────────────────────────────────────
//
// Uploads go as `FormData`, so these deliberately do **not** use `fetchJson`:
// it sets `Content-Type: application/json` on every request, and setting that
// header by hand on a multipart body omits the boundary, which makes the
// server read an empty form and answer "no file was submitted".

const P = "/api/proxy/assets/photos";

export function useAssetPhotos(assetId: number | null) {
  return useQuery({
    queryKey: ["assets", "photos", assetId],
    queryFn: () => fetchJson<Paginated<AssetPhoto>>(`${P}/?asset=${assetId}&page_size=100`),
    enabled: assetId != null,
  });
}

export function useUploadAssetPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ asset, file, caption }: { asset: number; file: File; caption?: string }) => {
      const body = new FormData();
      body.append("asset", String(asset));
      body.append("image", file);
      if (caption) body.append("caption", caption);
      // No trailing slash: `${P}/` makes Next answer 308 to the slashless
      // path and the browser replays the whole upload. It arrives intact, so
      // this is a wasted round trip rather than a bug — but it is a wasted
      // round trip carrying a file, and every other upload here posts without
      // the slash.
      const res = await fetch(P, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, res.status));
      }
      return (await res.json()) as AssetPhoto;
    },
    meta: { successMessage: "Photo added" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDeleteAssetPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson<void>(`${P}/${id}/`, { method: "DELETE" }),
    meta: { successMessage: "Photo removed" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}
