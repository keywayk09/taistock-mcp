export const AUTOMATION_TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export function automationTransportMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/**
 * Transport-only classifier for the read-only Automation Research bridge.
 *
 * Research/data semantic failures must never be retried as transport. This
 * deliberately requires either a recognizable transient network failure or a
 * transient HTTP status in a transport-shaped error message.
 */
export function isRetryableAutomationTransportError(value: unknown) {
  const message = automationTransportMessage(value);
  if (/fetch failed|network|timeout|timed out|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|IncompleteRead|ConnectionReset/i.test(message)) {
    return true;
  }

  const hasTransientStatus = /(?:^|[^0-9])(429|500|502|503|504)(?:[^0-9]|$)/.test(message);
  if (!hasTransientStatus) return false;
  return /http|github|canonical|fetch|bridge|upstream|reader|contents|blob|resolve|request/i.test(message);
}

export function retryableAutomationTransportBody(error: string, detail: unknown, extra: Record<string, unknown> = {}) {
  return {
    ok: false,
    blocked: true,
    error,
    retryable_transport_error: true,
    transport_error_class: "TRANSIENT_TRANSPORT",
    detail: automationTransportMessage(detail),
    ...extra,
  };
}
