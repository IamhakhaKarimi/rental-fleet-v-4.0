"use client";
/**
 * The annual license cap, as the UI needs it.
 *
 * The backend refuses to persist any date past 31 Dec of the licensed year
 * (`services/licensing_service.assert_allowed`). This module mirrors that cap
 * into the UI so a calendar never *offers* a day the API is going to reject:
 * `useLicenseMax()` returns the ISO day to hand every `DateField` as `max`.
 *
 * The mirror is a courtesy, not the gate — the server re-checks every write, and
 * `licenseMessage()` turns its 403 into a sentence when something slips through
 * (a stale tab, a hand-made request, a license that lapsed mid-session).
 *
 * One fetch per page load, shared by every caller: the value is cached at module
 * scope with subscribers, so mounting six pickers costs one request. Call
 * `refreshLicenseLimits()` after redeeming a key or setting the year so open
 * calendars widen immediately instead of after a reload.
 */
import { useEffect, useState } from "react";
import { apiGet, ApiError } from "./api";

export interface LicenseLimits {
  licensed_year: number;
  current_year: number;
  /** Last bookable/recordable day, ISO `YYYY-MM-DD`. */
  max_date: string;
  next_year: number;
  days_left: number;
  renewal_due: boolean;
}

let cache: LicenseLimits | null = null;
let inflight: Promise<LicenseLimits | null> | null = null;
const listeners = new Set<(l: LicenseLimits | null) => void>();

function publish(value: LicenseLimits | null) {
  cache = value;
  listeners.forEach((fn) => fn(value));
}

export function fetchLicenseLimits(force = false): Promise<LicenseLimits | null> {
  if (!force && cache) return Promise.resolve(cache);
  if (!force && inflight) return inflight;
  inflight = apiGet<LicenseLimits>("/api/license/limits")
    .then((d) => {
      publish(d);
      return d;
    })
    .catch(() => null) // not signed in yet, or offline — leave pickers uncapped
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Re-read the cap after it may have changed (key redeemed, year set). */
export function refreshLicenseLimits(): Promise<LicenseLimits | null> {
  return fetchLicenseLimits(true);
}

export function useLicenseLimits(): LicenseLimits | null {
  const [limits, setLimits] = useState<LicenseLimits | null>(cache);
  useEffect(() => {
    listeners.add(setLimits);
    fetchLicenseLimits();
    return () => {
      listeners.delete(setLimits);
    };
  }, []);
  return limits;
}

/**
 * The ISO day to pass as a `DateField`'s `max`.
 *
 * `undefined` while the cap is still unknown: capping at a guess would lock a
 * legitimately licensed year out of the calendar for the first few hundred
 * milliseconds, and the server is the real gate either way.
 */
export function useLicenseMax(): string | undefined {
  return useLicenseLimits()?.max_date || undefined;
}

/** True when an API error is the license cap refusing a date. */
export function isLicenseError(e: unknown): boolean {
  return e instanceof ApiError ? e.key === "license_year_locked" : (e as any)?.key === "license_year_locked";
}

/**
 * "That date is outside your licensed period. You are licensed through 2026."
 * `t` is `useI18n()`'s translator; the year is filled from the cap.
 */
export function licenseMessage(
  t: (k: string) => string,
  limits: LicenseLimits | null,
  fallback = "That date is outside your licensed period."
): string {
  const raw = t("license_year_locked");
  const text = raw === "license_year_locked" ? fallback : raw;
  return text.replace("{y}", String(limits?.licensed_year ?? ""));
}

/** "Licensed through 31 Dec 2026. A new license key is required for 2027." */
export function licenseCapNote(
  t: (k: string) => string,
  limits: LicenseLimits | null
): string {
  if (!limits) return "";
  const raw = t("license_cap_note");
  const text =
    raw === "license_cap_note"
      ? "Licensed through 31 Dec {y}. A new license key is required for {y2}."
      : raw;
  return text.replace("{y}", String(limits.licensed_year)).replace("{y2}", String(limits.next_year));
}
