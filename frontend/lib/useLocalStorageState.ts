import { useState } from "react";

// SSR-safe localStorage-backed state. Reads lazily on first render (client only)
// and mirrors every update back to localStorage.
export function useLocalStorageState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    return (window.localStorage.getItem(key) as T) || initial;
  });

  const set = (v: T) => {
    setValue(v);
    if (typeof window !== "undefined") window.localStorage.setItem(key, v);
  };

  return [value, set];
}
