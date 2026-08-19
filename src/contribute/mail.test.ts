import { describe, expect, test } from "bun:test";
import { buildBody, buildMailto } from "./mail";

describe("mail draft", () => {
  test("mailto encodes subject and body, and targets the recipient", () => {
    const url = buildMailto({ to: "a@b.com", subject: "[sessionlint] x · 2 sessions", body: "line1\nline2" });
    expect(url.startsWith("mailto:a%40b.com?")).toBe(true);
    expect(url).toContain("subject=%5Bsessionlint%5D");
    expect(url).toContain("line1%0Aline2");
    // A mailto: URL is a draft request to the local mail app — never a transmission.
    expect(url).not.toContain("smtp");
  });

  test("body leads with the attach instruction and the absolute path", () => {
    const body = buildBody({
      handle: "alice", version: "0.6.0", sessionCount: 3,
      dateRange: { from: "2026-08-01", to: "2026-08-19" }, filePath: "/tmp/bundle.json",
    });
    expect(body.split("\n")[0]).toContain("attach");
    expect(body).toContain("/tmp/bundle.json");
    expect(body).toContain("3 (2026-08-01 to 2026-08-19)");
  });

  test("a missing date range degrades instead of printing undefined", () => {
    const body = buildBody({ handle: "a", version: "0", sessionCount: 0, dateRange: null, filePath: "/tmp/x" });
    expect(body).toContain("n/a");
    expect(body).not.toContain("undefined");
  });
});
