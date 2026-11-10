export const INVENTORY_SCHEMA_VERSION = 2;
export const INVENTORY_SHARD_PREFIX = "__v2_inventory_";
export const INVENTORY_COUNTER_DOC_ID = "__v2_counters";
export const MAX_INVENTORY_SHARD_BYTES = 700 * 1024;

const inventoryTextEncoder = new TextEncoder();

export function getInventoryShardId(sequence) {
  return `${INVENTORY_SHARD_PREFIX}${String(sequence).padStart(4, "0")}`;
}

export function estimateInventoryShardBytes(groups) {
  return inventoryTextEncoder.encode(JSON.stringify({ schemaVersion: INVENTORY_SCHEMA_VERSION, groups })).length;
}

function estimateInventoryAdditionBytes(groups, codePrefix, recordBytes) {
  const entries = groups[codePrefix];
  if (entries) return recordBytes + (entries.length ? 1 : 0);
  return inventoryTextEncoder.encode(JSON.stringify(codePrefix)).length
    + 3
    + recordBytes
    + (Object.keys(groups).length ? 1 : 0);
}

function cloneInventoryGroups(groups) {
  return Object.fromEntries(
    Object.entries(groups).map(([prefix, items]) => [prefix, [...items]]),
  );
}

export async function mutateInventoryStorage(transaction, counterSnapshot, {
  additions = [],
  removals = [],
  nextValues = {},
  rejectDuplicateCodes = false,
  getShardRef,
  counterRef,
  serverTimestamp,
}) {
  const existingCounterData = counterSnapshot.exists() ? counterSnapshot.data() : {};
  if (!counterSnapshot.exists()
    || existingCounterData.schemaVersion !== INVENTORY_SCHEMA_VERSION
    || existingCounterData.migrationComplete !== true) {
    throw new Error("A leltár adattára még nincs átállítva. Futtasd előbb az adatköltöztetést.");
  }

  const nextByPrefix = { ...(existingCounterData.nextByPrefix || {}) };
  const shardIdsByPrefix = Object.fromEntries(
    Object.entries(existingCounterData.shardIdsByPrefix || {})
      .map(([prefix, shardIds]) => [prefix, [...shardIds]]),
  );
  let nextShardNumber = Number(existingCounterData.nextShardNumber) || 0;
  let activeShardId = existingCounterData.activeShardId || getInventoryShardId(nextShardNumber);
  const shards = new Map();

  const readShard = async (shardId) => {
    if (shards.has(shardId)) return shards.get(shardId);
    const ref = getShardRef(shardId);
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists() ? snapshot.data() : {};
    if (snapshot.exists() && data.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
      throw new Error(`A leltár adattárának dokumentumazonosítója ütközik: ${shardId}.`);
    }
    const shard = {
      ref,
      exists: snapshot.exists(),
      groups: cloneInventoryGroups(data.groups || {}),
      bytes: estimateInventoryShardBytes(data.groups || {}),
      dirty: false,
    };
    shards.set(shardId, shard);
    return shard;
  };

  const candidateIds = new Set(removals.map((item) => item.shardId));
  additions.forEach((item) => {
    (shardIdsByPrefix[item.codePrefix] || []).forEach((shardId) => candidateIds.add(shardId));
  });
  candidateIds.add(activeShardId);
  for (const shardId of candidateIds) {
    if (shardId) await readShard(shardId);
  }

  if (rejectDuplicateCodes) {
    const movingCodesByPrefix = new Map();
    removals.forEach((item) => {
      if (!movingCodesByPrefix.has(item.codePrefix)) movingCodesByPrefix.set(item.codePrefix, new Set());
      movingCodesByPrefix.get(item.codePrefix).add(item.code);
    });
    additions.forEach((item) => {
      const duplicate = (shardIdsByPrefix[item.codePrefix] || [])
        .some((shardId) => (shards.get(shardId)?.groups[item.codePrefix] || [])
          .some((entry) => entry.leltariSzam === item.record.leltariSzam
            && !movingCodesByPrefix.get(item.codePrefix)?.has(entry.leltariSzam)));
      if (duplicate) {
        throw new Error("A módosított kódhoz már tartozik egy másik leltári tétel ugyanazzal a sorszámmal.");
      }
    });
  }

  const removalsByShard = new Map();
  removals.forEach((item) => {
    if (!removalsByShard.has(item.shardId)) removalsByShard.set(item.shardId, new Map());
    const byPrefix = removalsByShard.get(item.shardId);
    if (!byPrefix.has(item.codePrefix)) byPrefix.set(item.codePrefix, new Set());
    byPrefix.get(item.codePrefix).add(item.code);
  });
  removalsByShard.forEach((byPrefix, shardId) => {
    const shard = shards.get(shardId);
    if (!shard) throw new Error("A leltári tétel adattára nem található.");
    byPrefix.forEach((codes, codePrefix) => {
      const entries = shard.groups[codePrefix];
      if (!entries) throw new Error(`A leltári tétel nem található: ${[...codes][0]}.`);
      const remainingEntries = entries.filter((entry) => !codes.has(entry.leltariSzam));
      if (remainingEntries.length !== entries.length - codes.size) {
        const foundCodes = new Set(entries.map((entry) => entry.leltariSzam));
        const missingCode = [...codes].find((code) => !foundCodes.has(code));
        throw new Error(`A leltári tétel nem található: ${missingCode || [...codes][0]}.`);
      }
      shard.dirty = true;
      if (remainingEntries.length) {
        shard.groups[codePrefix] = remainingEntries;
      } else {
        delete shard.groups[codePrefix];
        shardIdsByPrefix[codePrefix] = (shardIdsByPrefix[codePrefix] || [])
          .filter((id) => id !== shardId);
        if (!shardIdsByPrefix[codePrefix].length) delete shardIdsByPrefix[codePrefix];
      }
    });
  });

  const replacementCodesByPrefix = new Map();
  additions.forEach((item) => {
    if (!replacementCodesByPrefix.has(item.codePrefix)) replacementCodesByPrefix.set(item.codePrefix, new Set());
    replacementCodesByPrefix.get(item.codePrefix).add(item.record.leltariSzam);
  });
  replacementCodesByPrefix.forEach((codes, codePrefix) => {
    (shardIdsByPrefix[codePrefix] || []).forEach((shardId) => {
      const shard = shards.get(shardId);
      const entries = shard?.groups[codePrefix];
      if (!entries) return;
      const remainingEntries = entries.filter((entry) => !codes.has(entry.leltariSzam));
      if (remainingEntries.length === entries.length) return;
      shard.dirty = true;
      if (remainingEntries.length) {
        shard.groups[codePrefix] = remainingEntries;
      } else {
        delete shard.groups[codePrefix];
        shardIdsByPrefix[codePrefix] = shardIdsByPrefix[codePrefix].filter((id) => id !== shardId);
        if (!shardIdsByPrefix[codePrefix].length) delete shardIdsByPrefix[codePrefix];
      }
    });
  });

  shards.forEach((shard) => {
    if (shard.dirty) shard.bytes = estimateInventoryShardBytes(shard.groups);
  });

  for (const item of additions) {
    const recordBytes = inventoryTextEncoder.encode(JSON.stringify(item.record)).length;
    const candidates = [...new Set([
      ...(shardIdsByPrefix[item.codePrefix] || []),
      activeShardId,
    ])];
    let stored = false;
    for (const shardId of candidates) {
      const shard = await readShard(shardId);
      const additionBytes = estimateInventoryAdditionBytes(shard.groups, item.codePrefix, recordBytes);
      if (shard.bytes + additionBytes <= MAX_INVENTORY_SHARD_BYTES) {
        shard.groups[item.codePrefix] ||= [];
        shard.groups[item.codePrefix].push(item.record);
        shard.bytes += additionBytes;
        shard.dirty = true;
        shardIdsByPrefix[item.codePrefix] = [...new Set([
          ...(shardIdsByPrefix[item.codePrefix] || []),
          shardId,
        ])];
        stored = true;
        break;
      }
    }

    while (!stored) {
      const shardId = getInventoryShardId(nextShardNumber);
      nextShardNumber += 1;
      const shard = await readShard(shardId);
      if (shard.exists) continue;
      const groups = { [item.codePrefix]: [item.record] };
      const bytes = estimateInventoryShardBytes(groups);
      if (bytes > MAX_INVENTORY_SHARD_BYTES) {
        throw new Error(`A leltári tétel túl nagy egy Firestore dokumentumhoz: ${item.record.leltariSzam}.`);
      }
      shard.groups = groups;
      shard.bytes = bytes;
      shard.dirty = true;
      shardIdsByPrefix[item.codePrefix] = [...new Set([
        ...(shardIdsByPrefix[item.codePrefix] || []),
        shardId,
      ])];
      activeShardId = shardId;
      stored = true;
    }
  }

  Object.entries(nextValues).forEach(([prefix, value]) => {
    nextByPrefix[prefix] = Math.max(Number(nextByPrefix[prefix]) || 0, Number(value) || 0);
  });

  shards.forEach((shard, shardId) => {
    if (!shard.dirty) return;
    const isActive = shardId === activeShardId;
    if (!Object.keys(shard.groups).length && !isActive) {
      if (shard.exists) transaction.delete(shard.ref);
      return;
    }
    transaction.set(shard.ref, {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: shard.groups,
      updatedAt: serverTimestamp(),
    });
  });
  transaction.set(counterRef, {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    migrationComplete: true,
    nextByPrefix,
    shardIdsByPrefix,
    activeShardId,
    nextShardNumber,
    updatedAt: serverTimestamp(),
  });
}
