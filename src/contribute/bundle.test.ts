import { describe, expect, test } from "bun:test";
import { buildBundle, bundleFilename, subjectLine, type BundleSessionInput } from "./bundle";

const REAL_ID = "71e2f22c-58dd-46ee-9500-1aff9383d056";

function sessionWith(lines: string[], overrides: Partial<BundleSessionInput> = {}): BundleSessionInput {
  return {
    sessionId: REAL_ID,
    projectName: "-Users-alice-work-acme-migration",
    rawJsonl: lines.join("\n"),
    turnCount: 2,
    models: ["claude-opus-5"],
    inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40,
    costUsd: 1.5,
    firstTimestamp: "2026-08-01T00:00:00.000Z",
    lastTimestamp: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

const opts = { handle: "alice", version: "0.6.0", projectMap: { "-Users-alice-work-acme-migration": "project-a" } };

describe("buildBundle redaction", () => {
  // TP: every identifier class the hand audit caught must be gone.
  test("replaces session uuids under ANY key spelling, camel or snake", () => {
    const built = buildBundle(
      [sessionWith([
        JSON.stringify({ type: "user", sessionId: REAL_ID }),
        JSON.stringify({ type: "x", session_id: REAL_ID }),
      ])],
      opts
    );
    expect(built.json).not.toContain(REAL_ID);
    expect(built.json).toContain("session-001");
    expect(built.selfCheck.residualIdentifiers).toBe(0);
  });

  test("aliases git branch names, which routinely name clients", () => {
    const built = buildBundle(
      [sessionWith([JSON.stringify({ type: "user", gitBranch: "feature/acme-corp-migration" })])],
      opts
    );
    expect(built.json).not.toContain("acme-corp");
    expect(built.json).toContain("branch-a");
  });

  test("aliases the MCP server half of a tool name and keeps the tool half", () => {
    const built = buildBundle(
      [sessionWith([JSON.stringify({ type: "assistant", tool: "mcp__InternalVendorDB__run_sql" })])],
      opts
    );
    expect(built.json).not.toContain("InternalVendorDB");
    expect(built.json).toContain("mcp__server-a__run_sql");
  });

  test("project directory names are replaced with the pseudonym by default", () => {
    const built = buildBundle([sessionWith([JSON.stringify({ type: "user" })])], opts);
    expect(built.json).not.toContain("acme-migration");
    expect((built.bundle.sessions as any[])[0].project).toBe("project-a");
    expect(built.bundle.projectNamesIncluded).toBe(false);
  });

  test("--include-project-names is the only way a real project name appears", () => {
    const built = buildBundle([sessionWith([JSON.stringify({ type: "user" })])], { ...opts, includeProjectNames: true });
    expect((built.bundle.sessions as any[])[0].project).toBe("-Users-alice-work-acme-migration");
    expect(built.bundle.projectNamesIncluded).toBe(true);
  });

  // TN: content that is supposed to survive must survive, or the corpus is useless.
  test("keeps the fields the rules and cost math need", () => {
    const built = buildBundle([sessionWith([JSON.stringify({ type: "user" })])], opts);
    const s = (built.bundle.sessions as any[])[0];
    expect(s.models).toEqual(["claude-opus-5"]);
    expect(s.usage.cacheReadTokens).toBe(30);
    expect(s.costUsdApiEquivalent).toBe(1.5);
    expect(s.turnCount).toBe(2);
  });

  test("generatedAt is date-only — a clock time is a behavioural fingerprint", () => {
    const built = buildBundle([sessionWith([JSON.stringify({ type: "user" })])], {
      ...opts, generatedAt: new Date("2026-08-19T13:45:12.000Z"),
    });
    expect(built.bundle.generatedAt).toBe("2026-08-19");
  });

  test("an API key in the transcript never reaches the bundle", () => {
    // Defence in depth: the sanitizer strips it, and the self-check is the backstop
    // that would catch it if the sanitizer ever stopped. Asserting the OUTPUT is
    // clean tests the property that matters; asserting the backstop fires would
    // require breaking the first layer on purpose.
    const secret = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA";
    const built = buildBundle([sessionWith([JSON.stringify({ type: "user", token: secret })])], opts);
    expect(built.json).not.toContain(secret);
    expect(built.json).not.toContain("sk-ant");
    expect(built.selfCheck.residualSecrets).toBe(0);
    expect(built.selfCheck.clean).toBe(true);
  });

  test("an absolute home path never reaches the bundle", () => {
    const built = buildBundle(
      [sessionWith([JSON.stringify({ type: "user", cwd: "/Users/alice/work/acme" })])],
      opts
    );
    expect(built.json).not.toContain("/Users/alice");
    expect(built.selfCheck.residualPaths).toBe(0);
  });

  test("the self-check reports every category it guards, all zero on clean input", () => {
    const built = buildBundle([sessionWith([JSON.stringify({ type: "user" })])], opts);
    expect(built.selfCheck).toMatchObject({
      residualSecrets: 0, residualEmails: 0, residualPaths: 0,
      residualUrls: 0, residualIdentifiers: 0, clean: true,
    });
  });

  test("cross-session references are aliased, not left raw", () => {
    const other = "8e374aae-cd1f-4116-a42b-222c760bf3ba";
    const built = buildBundle(
      [
        sessionWith([JSON.stringify({ type: "user", sessionId: REAL_ID, ref: other })]),
        sessionWith([JSON.stringify({ type: "user", sessionId: other })], { sessionId: other }),
      ],
      opts
    );
    expect(built.json).not.toContain(other);
    expect(built.json).toContain("session-002");
  });
});

describe("naming", () => {
  test("bundle filename is slugged and dated", () => {
    expect(bundleFilename("Alice B", new Date("2026-08-19T00:00:00Z"))).toBe("sessionlint-contrib-alice-b-2026-08-19.json");
  });
  test("a handle with no usable characters still yields a filename", () => {
    expect(bundleFilename("!!!", new Date("2026-08-19T00:00:00Z"))).toBe("sessionlint-contrib-anon-2026-08-19.json");
  });
  test("subject line matches the agreed format", () => {
    expect(subjectLine("alice", 7, "0.6.0", new Date("2026-08-19T00:00:00Z")))
      .toBe("[sessionlint] alice · 2026-08-19 · 7 sessions · v0.6.0");
  });
});
