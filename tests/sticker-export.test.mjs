import assert from "node:assert/strict";
import test from "node:test";
import {
  createStickerExportRows,
  getStickerExportItems,
} from "../public/sticker-export.js";

test("exports one row per requested sticker for each item", () => {
  const rows = createStickerExportRows([
    {
      code: "E-RO-UL-SP-02",
      name: "Box",
      serialNumber: "SN-2",
      stickerSize: "small",
      stickerCount: 3,
    },
    {
      code: "E-RO-UL-SP-01",
      name: "Tool",
      serialNumber: "SN-1",
      stickerSize: "big",
      stickerCount: 2,
    },
  ]);

  assert.deepEqual(rows, [
    ["Name", "IC", "SN"],
    ["Tool", "E-RO-UL-SP-01", "SN-1"],
    ["Tool", "E-RO-UL-SP-01", "SN-1"],
    ["Box", "E-RO-UL-SP-02", "SN-2"],
    ["Box", "E-RO-UL-SP-02", "SN-2"],
    ["Box", "E-RO-UL-SP-02", "SN-2"],
  ]);
});

test("excludes no-sticker items and defaults an unset legacy count to one", () => {
  const rows = createStickerExportRows([
    {
      code: "E-RO-UL-SP-01",
      name: "None",
      stickerSize: "none",
      stickerCount: 3,
    },
    {
      code: "E-RO-UL-SP-02",
      name: "Legacy",
      stickerSize: "big",
    },
    {
      code: "E-RO-UL-SP-03",
      name: "Zero",
      stickerSize: "small",
      stickerCount: 0,
    },
  ]);

  assert.deepEqual(rows, [
    ["Name", "IC", "SN"],
    ["Legacy", "E-RO-UL-SP-02", ""],
  ]);
});

test("rejects invalid sticker counts instead of silently exporting the wrong amount", () => {
  assert.throws(
    () => createStickerExportRows([{
      code: "E-RO-UL-SP-01",
      stickerSize: "big",
      stickerCount: 1.5,
    }]),
    /Érvénytelen matricadarabszám/,
  );
});

test("exports only the requested size and skips sticker-done items", () => {
  const items = [
    { code: "E-RO-UL-SP-01", name: "Small", stickerSize: "small", stickerCount: 1 },
    { code: "E-RO-UL-SP-02", name: "Done", stickerSize: "small", stickerCount: 2, tags: ["sticker done"] },
    { code: "E-RO-UL-SP-03", name: "Other size", stickerSize: "big", stickerCount: 1 },
    { code: "E-RO-UL-SP-04", name: "No labels", stickerSize: "small", stickerCount: 0 },
  ];

  assert.deepEqual(getStickerExportItems(items, "small").map((item) => item.code), [
    "E-RO-UL-SP-01",
  ]);
  assert.deepEqual(createStickerExportRows(items, "small"), [
    ["Name", "IC", "SN"],
    ["Small", "E-RO-UL-SP-01", ""],
  ]);
});
