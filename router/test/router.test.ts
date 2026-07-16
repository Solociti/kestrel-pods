import { describe, expect, it } from "vitest";
import { routeRequest } from "../src/index.js";

describe("router", () => {
  it("returns a route message", () => {
    expect(routeRequest("/v1/health")).toContain("/v1/health");
  });
});
