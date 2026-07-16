import { describe, expect, it } from "vitest";
import { toKebabCase } from "shared-src/utils";

describe("shared-src", () => {
  it("has a hello world test", () => {
    expect("hello world").toContain("hello world");
  });

  it("converts to kebab case", () => {
    expect(toKebabCase("Hello World")).toBe("hello-world");
  });
});
