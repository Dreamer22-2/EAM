const STICKER_DONE_TAG = "sticker done";

function getStickerCount(item) {
  const stickerCount = item.stickerCount == null ? 1 : Number(item.stickerCount);
  if (!Number.isInteger(stickerCount) || stickerCount < 0) {
    throw new Error(`Érvénytelen matricadarabszám: ${item.code}.`);
  }
  return stickerCount;
}

export function getStickerExportItems(items, stickerSize = null) {
  return items
    .filter((item) => {
      const currentStickerSize = item.stickerSize || "big";
      const tags = Array.isArray(item.tags) ? item.tags : [];
      return currentStickerSize !== "none"
        && (stickerSize == null || currentStickerSize === stickerSize)
        && !tags.includes(STICKER_DONE_TAG)
        && getStickerCount(item) > 0;
    })
    .slice()
    .sort((left, right) => left.code.localeCompare(right.code, "hu"));
}

export function createStickerExportRows(items, stickerSize = null) {
  const rows = [["Name", "IC", "SN"]];
  getStickerExportItems(items, stickerSize).forEach((item) => {
    const stickerCount = getStickerCount(item);
    for (let index = 0; index < stickerCount; index += 1) {
      rows.push([item.name || "", item.code || "", item.serialNumber || ""]);
    }
  });
  return rows;
}
