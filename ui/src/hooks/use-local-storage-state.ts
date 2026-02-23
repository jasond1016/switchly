import { useEffect, useState } from "react";

export function useLocalStorageState<T>(key: string, fallback: T, parse: (raw: string) => T | null = defaultParse) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return parse(raw) ?? fallback;
  });

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function defaultParse<T>(raw: string): T | null {
  return raw as T;
}
