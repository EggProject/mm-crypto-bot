export function stringifyUnknownError(error: unknown): string {
  const diagnostic = String(error);
  return diagnostic;
}
