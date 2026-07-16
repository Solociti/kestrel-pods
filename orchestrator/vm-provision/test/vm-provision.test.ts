import { describe, expect, it } from "vitest";
import { provisionVm } from "../src/index.js";

describe("vm provision", () => {
  it("returns a status message", () => {
    expect(provisionVm("tenant-1")).toContain("tenant-1");
  });
});
