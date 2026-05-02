# OpenViking Hooks Fork — KNOWN-ISSUES

## Active Issues

### KI-1: content/write Busy Locks During Rapid Writes
**Severity:** Medium | **Affects:** auto-capture.mjs, ov-project-sync.sh
OV's `content/write` endpoint returns busy/lock errors when multiple writes hit the same URI within a short window. The project sync script has retry logic, but auto-capture's Content Merge (append mode, score >0.85) can hit this during rapid Stop hook firings. No client-side lock coordination exists between hooks.
**Workaround:** ov-project-sync.sh retries on busy. Auto-capture treats merge failure as non-fatal and falls back to new session extraction.

### KI-2: WebDAV Auth Requires Custom Headers (davfs2 Incompatible)
**Severity:** Low | **Affects:** External access
OV requires `X-API-Key`, `X-OpenViking-Account`, and `X-OpenViking-User` custom headers for authentication. Standard WebDAV clients like davfs2 cannot inject these headers, making direct WebDAV mounting impossible without a proxy.
**Workaround:** Use the REST API directly or a custom HTTP proxy that injects the required headers.

### KI-3: OV Grep Search Requires URI Scope Parameter
**Severity:** Low | **Affects:** auto-recall.mjs (hybrid search), memory-server.js (memory_search tool)
The `/api/v1/search/grep` endpoint requires a `uri` parameter to scope the search. Without it, the search fails silently or returns empty results. The auto-recall hook hardcodes `viking://user/` as the grep scope, which misses agent-scope and resource-scope content.
**Impact:** Grep component of hybrid search only covers user memories, not agent memories or resources.

### KI-4: abstract/overview Fields Can Be Non-String From Grep Results
**Severity:** Low | **Affects:** auto-recall.mjs (ranking, dedup)
Grep search results sometimes return non-string values for `abstract` and `overview` fields (e.g., numbers, objects). Code in auto-recall.mjs was patched with `String()` coercion at three points: `getRankingBreakdown`, `dedupeByAbstract`, and `postProcess`. The debug-recall.mjs script does NOT have this patch and will fail on such results.
**Locations patched:**
- `auto-recall.mjs` line 99: `const abstract = (typeof rawAbstract === "string" ? rawAbstract : String(rawAbstract)).trim();`
- `auto-recall.mjs` line 129: `const rawKey = item.abstract || item.overview || ""; const key = (typeof rawKey === "string" ? rawKey : String(rawKey)).trim()...`
- `auto-recall.mjs` line 162: same pattern in `postProcess`

### KI-5: TypeScript Source Diverged From Compiled JS
**Severity:** Medium | **Affects:** Development workflow
`src/memory-server.ts` defines 4 MCP tools (memory_recall, memory_store, memory_forget, memory_health). The compiled `servers/memory-server.js` has 6 tools — the additional `memory_search` (glob/grep) and `convert_to_markdown` (markitdown) were added directly to the JS without updating the TypeScript source. Running `tsc` will overwrite the JS and lose these tools.
The TS source also lacks `account` and `user` fields in the OpenVikingClient constructor (JS version has them).
**Workaround:** Do not run `npm run build` without first porting the JS additions back to the TS source.

### KI-6: Debug Scripts Duplicate Ranking Logic
**Severity:** Low | **Affects:** debug-recall.mjs, debug-capture.mjs
Both debug scripts copy-paste core logic (ranking, postProcess, shouldCapture, transcript parsing) from the production hooks instead of importing shared modules. Changes to ranking logic in auto-recall.mjs must be manually mirrored to debug-recall.mjs. The debug scripts also lack the String coercion patch (KI-4) and source-authority multiplier.

### KI-7: Hardcoded Absolute Paths to Shared Modules
**Severity:** Low | **Affects:** Portability | **Status:** Accepted
`auto-recall.mjs` and `bootstrap-runtime.mjs` use ESM static imports from `/root/.openviking/`. ESM static imports cannot use variables — this is a language constraint. For multi-user deployments, set `OPENVIKING_HOME` and use dynamic `import()`. For our single-VPS deployment this is fine. The shared modules (`scope-resolver.mjs`, `compaction.mjs`, `scope-config.json`) are the Single Source of Truth for all 4 CLIs and must live at a fixed path.

## Resolved Issues (Historical)

### KI-H1: OC Hook execSync Hack (Resolved: replaced with native OC plugin)
Original OpenClaw hook used `echo | node` via execSync, which crashed on quotes in JSON, long inputs, and timeouts.

### KI-H2: Ingestion Network Errors (Resolved: Docker container networking fixed)
temp_upload endpoint returned network errors from within the OV container.

### KI-H3: Tests Never Run (Resolved: config tests pass as of v0.1.5)
The 5 config.test.mjs tests are functional and verify local/remote mode, env var expansion, and validation.

## Technical Debt

- **No test coverage for hooks:** auto-recall.mjs and auto-capture.mjs have zero tests. Only config.mjs is tested.
- **No test coverage for MCP server:** memory-server.js/ts has no tests.
- **Ranking logic triplication:** Same ranking algorithms exist in auto-recall.mjs, debug-recall.mjs, and memory-server.js with minor divergences.
- **Config loader duplication:** config.mjs (hooks) and memory-server.ts (MCP server) have independent config loading implementations that must be kept in sync. The MCP server uses `OPENVIKING_CC_CONFIG_FILE` env var while hooks use `OPENVIKING_HOOK_CONFIG_FILE`.
- **CJK-specific regexes from Castor6 upstream:** Memory triggers, stopwords, and query token extraction include Chinese/CJK patterns from the original Castor6 codebase. These are harmless but unused in the current deployment.
- **Scope migration incomplete:** 1 flat OV resource remains unmigrated per PROGRESS.md.
