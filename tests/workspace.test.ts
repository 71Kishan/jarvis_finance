import { describe, expect, test } from "bun:test";
import { WORKSPACE_LABELS } from "../src/platform/workspace";

describe("workspace model", () => {
  test("keeps a dedicated practice lab separate from the primary terminal", () => {
    expect(WORKSPACE_LABELS.TERMINAL).toBe("Terminal");
    expect(WORKSPACE_LABELS.PRACTICE).toBe("Practice Lab");
    expect(WORKSPACE_LABELS.TERMINAL).not.toBe(WORKSPACE_LABELS.PRACTICE);
  });
});
