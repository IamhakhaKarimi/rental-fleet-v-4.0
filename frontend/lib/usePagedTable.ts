"use client";
import { useEffect, useRef, useState } from "react";
import { apiGetPaged } from "./api";

/**
 * Server-side pagination for a table view (M5). Deliberately separate from
 * whatever full-list state a page already keeps for its card/carousel view,
 * quick-find dropdown, or counts — those need every row and stay on the old
 * unbounded fetch untouched. This hook drives ONLY a `<table>` body: pass a
 * `basePath` that already includes any filter query params (e.g. `?q=...`);
 * `page`/`page_size` are appended here.
 *
 * Resets to page 1 whenever `basePath` changes (a new search term), and again
 * whenever `active` goes false→true (switching into table view) so stale
 * card-view state from an old search doesn't leak in as a wrong page number.
 */
export function usePagedTable<T = any>(
  basePath: string,
  pageSize: number,
  active: boolean,
  // Bump this (e.g. a counter incremented alongside a sibling full-list
  // reload) to force a refetch of the current page after a mutation —
  // otherwise an add/edit/delete leaves the table showing stale rows until
  // the user changes page.
  refreshToken: number = 0
) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const prevBase = useRef(basePath);

  useEffect(() => {
    if (prevBase.current !== basePath) {
      prevBase.current = basePath;
      setPage(1);
    }
  }, [basePath]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    const sep = basePath.includes("?") ? "&" : "?";
    apiGetPaged<T>(`${basePath}${sep}page=${page}&page_size=${pageSize}`)
      .then(({ items, total: t }) => {
        if (cancelled) return;
        setRows(items);
        setTotal(t);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [basePath, page, pageSize, active, refreshToken]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return { rows, total, page, setPage, pageCount, loading };
}
