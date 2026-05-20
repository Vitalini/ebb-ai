import { describe, expect, it } from "vitest";

import {
  FALLBACK_REGION,
  regionForTimezone,
  resolveRegion,
} from "../src/region.js";

describe("regionForTimezone", () => {
  it("maps known timezones to grid regions", () => {
    expect(regionForTimezone("Europe/London")).toBe("GB");
    expect(regionForTimezone("Europe/Paris")).toBe("FR");
    expect(regionForTimezone("Europe/Berlin")).toBe("DE");
    expect(regionForTimezone("America/Los_Angeles")).toBe("US-CAL-CISO");
    expect(regionForTimezone("America/New_York")).toBe("US-MIDA-PJM");
  });

  it("returns undefined for an unmapped timezone", () => {
    expect(regionForTimezone("Antarctica/Troll")).toBeUndefined();
    expect(regionForTimezone("not-a-timezone")).toBeUndefined();
  });
});

describe("resolveRegion", () => {
  it("an explicit request region wins over everything", () => {
    expect(resolveRegion("US-TEX-ERCO", "GB")).toEqual({
      region: "US-TEX-ERCO",
      source: "request",
    });
  });

  it("uses the configured default when no request region", () => {
    expect(resolveRegion(undefined, "FR")).toEqual({
      region: "FR",
      source: "config",
    });
  });

  it("falls back to a timezone guess or FALLBACK_REGION", () => {
    const r = resolveRegion(undefined, undefined);
    expect(r.region.length).toBeGreaterThan(0);
    expect(["timezone", "default"]).toContain(r.source);
    if (r.source === "default") {
      expect(r.region).toBe(FALLBACK_REGION);
    }
  });

  it("treats an empty-string request/default as absent", () => {
    expect(resolveRegion("", "DE")).toEqual({
      region: "DE",
      source: "config",
    });
  });
});
