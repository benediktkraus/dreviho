export type OVLogger = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type LogLevel = "debug" | "info" | "warn" | "error";

const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const SECRET_KEY_RE = /^(api[_-]?key|authorization|bearer|client[_-]?secret|password|secret|token|access[_-]?token|refresh[_-]?token)$/i;

export function logEvent(
  logger: OVLogger | undefined,
  event: string,
  payload: Record<string, unknown> = {},
  level: LogLevel = "info",
): void {
  if (!logger) return;
  const write = logger[level] ?? logger.info ?? logger.warn ?? logger.error ?? logger.debug;
  if (!write) return;
  try {
    write(`[openviking-enhanced] ${event} ${JSON.stringify(sanitizeForLog(payload))}`);
  } catch {
    // Logging must never break context assembly or capture.
  }
}

export function limitString(value: string, max = MAX_STRING_LENGTH): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export function summarizeUris(uris: string[], max = 10): { count: number; samples: string[] } {
  return {
    count: uris.length,
    samples: uris.slice(0, max).map((uri) => limitString(uri, 180)),
  };
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return limitString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return `[array:${value.length}]`;
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 4) return "[object]";
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      out[key] = SECRET_KEY_RE.test(key) ? "***" : sanitizeForLog(item, depth + 1);
    }
    return out;
  }
  return String(value);
}
