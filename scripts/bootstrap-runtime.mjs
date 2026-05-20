import {
  computeSourceState,
  ensureRuntimeInstalled,
  getRuntimePaths,
} from "./runtime-common.mjs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";

const SHARED = process.env.OPENVIKING_HOME || `${homedir()}/.openviking`;

async function loadScopeResolver() {
  try {
    const modUrl = pathToFileURL(`${SHARED}/scope-resolver.mjs`).href;
    const mod = await import(modUrl);
    return mod.resolveScopes;
  } catch {
    return () => ({ scopes: [], targetUris: [], projectSlug: null });
  }
}

async function checkProjectContent() {
  const resolveScopes = await loadScopeResolver();
  const cwd = process.cwd();
  const { projectSlug } = resolveScopes(cwd);
  if (!projectSlug) return; // not in a project

  const cfg = loadConfig();
  if (!cfg?.baseUrl) return;

  const projectUri = `viking://resources/projects/${projectSlug}/`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const headers = { "X-API-Key": cfg.apiKey || "" };
    if (cfg.account) headers["X-OpenViking-Account"] = cfg.account;
    if (cfg.user) headers["X-OpenViking-User"] = cfg.user;

    const res = await fetch(
      `${cfg.baseUrl}/api/v1/fs/stat?uri=${encodeURIComponent(projectUri)}`,
      { headers, signal: controller.signal }
    );
    clearTimeout(timer);

    if (res.ok) return; // project content exists, nothing to do

    // Project not in OV yet — trigger on-demand sync
    const { execFileSync } = await import("node:child_process");
    const syncScript = process.env.OPENVIKING_PROJECT_SYNC || `${SHARED}/scripts/ov-project-sync.sh`;
    const { existsSync } = await import("node:fs");
    if (!existsSync(syncScript)) return;
    execFileSync(syncScript, [projectSlug], {
      timeout: 30000,
      stdio: "ignore",
    });
  } catch { /* best effort — don't block session start */ }
}

async function main() {
  const paths = getRuntimePaths();
  const expectedState = await computeSourceState(paths);

  try {
    await ensureRuntimeInstalled(paths, expectedState);
  } catch (err) {
    process.stderr.write(
      `[openviking-memory] Failed to prepare MCP runtime dependencies: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  // Check if project content exists in OV, sync on-demand if missing
  await checkProjectContent();
}

main().catch(async (err) => {
  process.stderr.write(
    `[openviking-memory] Runtime bootstrap failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(0);
});
