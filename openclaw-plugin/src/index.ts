/**
 * openviking-enhanced — OC ContextEngine Plugin Entry Point
 *
 * Uses definePluginEntry + registerContextEngine from OC Plugin SDK.
 * Registers the OpenVikingContextEngine as the active context engine.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { registerContextEngine } from "openclaw/plugin-sdk";
import { OpenVikingContextEngine } from "./context-engine.js";

export default definePluginEntry({
  id: "openviking-enhanced",
  name: "OpenViking Enhanced Context Engine",
  description: "Full-featured OV context engine with hybrid search, 5-scope system, content merge, record used, auto-linking, transcript maintenance",
  register(api) {
    const result = registerContextEngine("openviking-enhanced", () => {
      return new OpenVikingContextEngine(api.logger);
    });
    if (result.ok) {
      api.logger.info("openviking-enhanced: context engine registered");
    }
    // Re-registration failures are normal — OC re-inits plugins on agent heartbeats.
    // First registration wins, subsequent ones are correctly rejected. Not an error.
  },
});
