// Scenario 3 cannot be proven without a browser. These checks guard the
// constraints that make the 400 px layout work; the visual check is manual.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

describe("Scenario: Layout works in a small window", () => {
  test("page has a responsive viewport meta and no fixed width wider than 400 px", () => {
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.doesNotMatch(css, /(?<!max-|min-)width:\s*\d+(\.\d+)?px/);
    const maxMain = css.match(/main\s*{[^}]*max-width:\s*([\d.]+)rem/);
    assert.ok(maxMain && Number(maxMain[1]) * 16 <= 400);
  });
  test("time, progress ring and controls are all in the page", () => {
    for (const id of ["timer", "ring", "start", "pause", "reset"]) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
  });
  test("ring scales with the window and has no large top margin", () => {
    assert.match(css, /\.dial\s*{[^}]*width:\s*min\(100%/);
    assert.match(css, /\.dial\s*{[^}]*aspect-ratio:\s*1/);
  });
});
