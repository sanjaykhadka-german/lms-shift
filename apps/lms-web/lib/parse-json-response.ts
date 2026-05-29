// Resilient JSON-response reader for client-side fetch handlers.
//
// Reads the body as text first, then attempts JSON parse. On a non-OK
// response, surfaces the most informative message available — a JSON `error`
// field, or the raw text body, or a status-code fallback. Avoids the cryptic
// "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
// that Response.json() throws on empty / non-JSON bodies.
//
// Pure — safe to import from server or client code, no DOM or Node deps.

export async function parseJsonResponse<T>(
  res: Response,
  fallbackMessage: string,
): Promise<T> {
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Body wasn't JSON — error pages, plain-text 401s, etc.
    }
  }
  if (!res.ok) {
    const fromBody =
      parsed &&
      typeof parsed === "object" &&
      "error" in (parsed as Record<string, unknown>)
        ? String((parsed as { error: unknown }).error)
        : null;
    const fromText = text && !parsed ? text.slice(0, 200) : null;
    throw new Error(
      fromBody ?? fromText ?? `${fallbackMessage} (HTTP ${res.status})`,
    );
  }
  return parsed as T;
}
