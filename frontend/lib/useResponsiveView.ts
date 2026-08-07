"use client";
import { useEffect, useState } from "react";
import { useLocalStorageState } from "./useLocalStorageState";
import type { ViewMode } from "@/components/ViewToggle";

/**
 * The card/table view choice, with table treated as desktop-only.
 *
 * Fleet, Reservations and Customers all offer both views and persist the pick
 * per page. Below 1024px the table is not a real option — seven or eight
 * columns on a 375px screen is a horizontal scroller that hides most of each
 * row — so the effective view is forced to "cards" there. The *stored*
 * preference is left untouched, so a user who chose the table on their desktop
 * still gets it when they go back to a wide screen.
 *
 * This forces the view rather than rendering both and hiding one with CSS on
 * purpose: the card decks mount `VehicleThumb`, which fetches a photo per
 * vehicle in an effect regardless of visibility. A CSS-hidden deck would fire
 * all of those requests on desktop for no visible benefit.
 *
 * `matchMedia` is read synchronously in the state initializer, matching the
 * client-only contract `useLocalStorageState` already relies on: everything
 * under app/(app)/layout.tsx renders a placeholder until auth resolves, so this
 * subtree never server-renders and there is no hydration mismatch to create.
 * Settling in an effect instead would flash the card deck for one frame on a
 * desktop whose stored preference is the table.
 */
const DESKTOP = "(min-width: 1024px)";

export function useResponsiveView(storageKey: string): [ViewMode, (v: ViewMode) => void] {
  const [stored, setStored] = useLocalStorageState<ViewMode>(storageKey, "cards");

  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP);
    const apply = () => setIsDesktop(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  return [isDesktop ? stored : "cards", setStored];
}
