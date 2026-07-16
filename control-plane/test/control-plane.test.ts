import { describe, expect, it } from "vitest";
import { health } from "control-plane";
import { exampleName } from "control-plane/example";

describe("control-plane", () => {
  it("reports healthy", () => {
    expect(health()).toEqual({ ok: true });
  });

  it("resolves component subpaths", () => {
    expect(exampleName()).toBe("control-plane example");
  });
});
