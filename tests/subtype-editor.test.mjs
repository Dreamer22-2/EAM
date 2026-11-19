import assert from "node:assert/strict";
import test from "node:test";
import { findSubtypePair } from "../public/subtype-editor.js";

test("matches stored cable subtype digits directly when they predate normalization", () => {
  const splitRules = {
    first: [["0", "Other"], ["1", "USB-A"], ["2", "USB-B"]],
    second: [["0", "Other"], ["1", "USB-A"], ["2", "USB-B"]],
  };
  const normalizeCableSubtype = (first, second) => [first, second]
    .sort((left, right) => Number(right) - Number(left))
    .join("");

  assert.deepEqual(findSubtypePair(splitRules, "02", normalizeCableSubtype), ["0", "2"]);
});

test("prefers the normalized cable subtype match when available", () => {
  const splitRules = {
    first: [["0", "Other"], ["1", "USB-A"], ["2", "USB-B"]],
    second: [["0", "Other"], ["1", "USB-A"], ["2", "USB-B"]],
  };
  const normalizeCableSubtype = (first, second) => [first, second]
    .sort((left, right) => Number(right) - Number(left))
    .join("");

  assert.deepEqual(findSubtypePair(splitRules, "20", normalizeCableSubtype), ["0", "2"]);
});

test("matches stored drill subtype when the second digit was left unspecified", () => {
  const splitRules = {
    first: [["0", "unknown"], ["1", "drill"], ["2", "driver"]],
    second: [["0", "not specified"], ["1", "standalone"], ["2", "set"]],
  };
  const normalizeDrillSubtype = (first, second) => `${first}${second}`;

  assert.deepEqual(
    findSubtypePair(splitRules, "20", normalizeDrillSubtype),
    ["2", "0"],
  );
});
