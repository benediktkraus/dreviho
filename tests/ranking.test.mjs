import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";

const SHARED = process.env.OPENVIKING_HOME || `${homedir()}/.openviking`;
const { mmrFilter, formatCitation, clampScore, buildQueryProfile, getRankingBreakdown, dedupeByAbstract, pickMemories, loadRankingConfig } = await import(`${SHARED}/ranking.mjs`);
const { temporalDecayFactor, isEvergreen, recordSeen, getAgeDays } = await import(`${SHARED}/decay-cache.mjs`);

describe("mmrFilter", () => {
  it("returns all items when diverse", () => {
    const items = [
      { uri: "a", score: 0.9, abstract: "authentication oauth login" },
      { uri: "b", score: 0.8, abstract: "database postgres migration" },
      { uri: "c", score: 0.7, abstract: "deployment docker kubernetes" },
    ];
    const result = mmrFilter(items, 0.7);
    assert.equal(result.length, 3);
  });
  it("penalizes near-duplicates", () => {
    const items = [
      { uri: "a", score: 0.9, abstract: "oauth authentication login flow" },
      { uri: "b", score: 0.85, abstract: "oauth authentication login setup" },
      { uri: "c", score: 0.7, abstract: "database postgres migration schema" },
    ];
    const result = mmrFilter(items, 0.7);
    assert.equal(result[0].uri, "a");
    // c should rank before b due to diversity
    const bIdx = result.findIndex(r => r.uri === "b");
    const cIdx = result.findIndex(r => r.uri === "c");
    assert.ok(cIdx < bIdx, "diverse item should rank before near-duplicate");
  });
  it("returns single item unchanged", () => {
    const items = [{ uri: "a", score: 0.9, abstract: "test" }];
    assert.deepEqual(mmrFilter(items, 0.7), items);
  });
  it("handles empty array", () => {
    assert.deepEqual(mmrFilter([], 0.7), []);
  });
});

describe("formatCitation", () => {
  it("formats with all fields", () => {
    const item = { uri: "viking://user/memories/test", context_type: "memory", score: 0.87 };
    const result = formatCitation(item);
    assert.equal(result, "[Source: viking://user/memories/test | memory | score:0.87]");
  });
  it("handles missing fields", () => {
    const result = formatCitation({ uri: "viking://x", score: 0.5 });
    assert.match(result, /\[Source: viking:\/\/x \| memory \| score:0\.50\]/);
  });
  it("handles no uri", () => {
    const result = formatCitation({});
    assert.match(result, /unknown/);
  });
});

describe("temporalDecayFactor", () => {
  it("returns 1.0 for unknown URIs", () => {
    const factor = temporalDecayFactor("viking://unknown/never-seen", 30);
    assert.equal(factor, 1.0);
  });
  it("returns 1.0 for age 0", () => {
    // Record a URI, then immediately check — age ≈ 0
    recordSeen("viking://test/fresh");
    const factor = temporalDecayFactor("viking://test/fresh", 30);
    assert.ok(factor > 0.99, `Expected ~1.0, got ${factor}`);
  });
});

describe("isEvergreen", () => {
  it("matches prefix pattern with /", () => {
    assert.ok(isEvergreen("viking://resources/system/docs/foo.md", ["viking://resources/"]));
  });
  it("matches prefix pattern with *", () => {
    assert.ok(isEvergreen("viking://resources/knowledge/api.md", ["viking://resources/*"]));
  });
  it("does not match non-matching URI", () => {
    assert.ok(!isEvergreen("viking://user/memories/foo", ["viking://resources/"]));
  });
  it("matches exact URI", () => {
    assert.ok(isEvergreen("viking://special", ["viking://special"]));
  });
  it("handles empty patterns", () => {
    assert.ok(!isEvergreen("viking://anything", []));
  });
});

describe("clampScore", () => {
  it("clamps to 0-1", () => {
    assert.equal(clampScore(1.5), 1);
    assert.equal(clampScore(-0.5), 0);
    assert.equal(clampScore(0.5), 0.5);
    assert.equal(clampScore(NaN), 0);
    assert.equal(clampScore("foo"), 0);
  });
});
