import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsHostGrant } from "../src/lib/browser.js";

describe("needsHostGrant", () => {
  it("is false in Chrome and Edge, which grant 127.0.0.1 at install", () => {
    assert.equal(needsHostGrant("chrome-extension://abc/"), false);
  });

  it("is true in Firefox and Safari, which grant it only from the options Save", () => {
    assert.equal(needsHostGrant("moz-extension://abc/"), true);
    assert.equal(needsHostGrant("safari-web-extension://abc/"), true);
  });

  it("is false outside an extension", () => {
    assert.equal(needsHostGrant(), false);
  });
});
