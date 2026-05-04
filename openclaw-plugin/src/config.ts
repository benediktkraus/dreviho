/**
 * Config loader for openviking-enhanced OC plugin.
 * Reads env vars for OV connection. No file-based config — OC manages plugin config.
 */

export interface OVConfig {
  baseUrl: string;
  apiKey: string;
  agentPrefix: string;
  account: string;
  user: string;
  recallLimit: number;
  scoreThreshold: number;
  timeoutMs: number;
  captureTimeoutMs: number;
  bootstrapTimeoutMs: number;
  minQueryLength: number;
  captureMaxLength: number;
  debug: boolean;
}

export function loadConfig(): OVConfig {
  return {
    baseUrl: process.env.OPENVIKING_URL || "http://localhost:1933",
    apiKey: process.env.OPENVIKING_API_KEY || "",
    agentPrefix: process.env.OPENVIKING_AGENT_PREFIX || "openclaw-main",
    account: process.env.OPENVIKING_ACCOUNT || "ralph",
    user: process.env.OPENVIKING_USER || "benedikt",
    recallLimit: parseInt(process.env.OPENVIKING_RECALL_LIMIT || "10", 10),
    scoreThreshold: parseFloat(process.env.OPENVIKING_SCORE_THRESHOLD || "0.1"),
    timeoutMs: parseInt(process.env.OPENVIKING_TIMEOUT_MS || "5000", 10),
    captureTimeoutMs: parseInt(process.env.OPENVIKING_CAPTURE_TIMEOUT_MS || "10000", 10),
    bootstrapTimeoutMs: parseInt(process.env.OPENVIKING_BOOTSTRAP_TIMEOUT_MS || "30000", 10),
    minQueryLength: parseInt(process.env.OPENVIKING_MIN_QUERY_LENGTH || "3", 10),
    captureMaxLength: parseInt(process.env.OPENVIKING_CAPTURE_MAX_LENGTH || "50000", 10),
    debug: process.env.OPENVIKING_DEBUG === "1",
  };
}
