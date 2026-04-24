export function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
