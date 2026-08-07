"use client";
import { useEffect, useState } from "react";

/**
 * SSR-safe media query hook.
 *
 * Returns `false` on the server and on the very first client render, then
 * settles to the real value in an effect. That ordering is deliberate: the
 * server has no viewport, so any other initial guess would mismatch the markup
 * React hydrates and throw a hydration error. Components that use this must
 * therefore treat `false` as "not known yet", not as "definitely narrow" —
 * i.e. use it to *upgrade* a layout, never to hide something the phone needs.
 *
 * Prefer plain Tailwind breakpoint classes wherever the layout can be expressed
 * in CSS. This exists only for the handful of places where a pixel value feeds
 * an inline style or a JS constant (Timeline's label gutter, DateField's
 * popover width) and CSS cannot reach it.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const apply = () => setMatches(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [query]);

  return matches;
}

/** The app's three layout tiers. Mirrors Tailwind's stock breakpoints so the
 *  JS and the CSS can never drift: phone < 768 ≤ tablet < 1024 ≤ desktop. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
export const useIsTabletUp = () => useMediaQuery("(min-width: 768px)");
