import assert from "node:assert/strict";
import test from "node:test";
import {
  INVENTORY_COUNTER_DOC_ID,
  INVENTORY_SCHEMA_VERSION,
  MAX_INVENTORY_SHARD_BYTES,
  estimateInventoryShardBytes,
  getInventoryShardId,
  mutateInventoryStorage,
} from "../public/inventory-storage.js";

const counterRef = { collection: "leltariSzamlalok", id: INVENTORY_COUNTER_DOC_ID };
const timestamp = "test-timestamp";

function createHarness(initialDocuments = {}) {
  const documents = new Map(Object.entries(initialDocuments));
  const writes = [];
  let writeStarted = false;
  const transaction = {
    async get(ref) {
      assert.equal(writeStarted, false, "all transaction reads must happen before writes");
      const data = documents.get(ref.id);
      return {
        exists: () => data !== undefined,
        data: () => data,
      };
    },
    set(ref, data) {
      writeStarted = true;
      writes.push({ type: "set", ref, data });
    },
    delete(ref) {
      writeStarted = true;
      writes.push({ type: "delete", ref });
    },
  };
  const getShardRef = (id) => ({ collection: "eszkozok", id });
  return {
    documents,
    writes,
    transaction,
    getShardRef,
    async mutate(counterData, options = {}) {
      const counterSnapshot = {
        exists: () => counterData !== undefined,
        data: () => counterData,
      };
      await mutateInventoryStorage(transaction, counterSnapshot, {
        ...options,
        getShardRef,
        counterRef,
        serverTimestamp: () => timestamp,
      });
      writes.forEach((write) => {
        if (write.type === "delete") documents.delete(write.ref.id);
        else documents.set(write.ref.id, write.data);
      });
    },
  };
}

function counterData(overrides = {}) {
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    migrationComplete: true,
    nextByPrefix: {},
    shardIdsByPrefix: {},
    activeShardId: getInventoryShardId(0),
    nextShardNumber: 1,
    ...overrides,
  };
}

function inventoryRecord(code, extra = {}) {
  return { leltariSzam: code, name: "Teszt", ...extra };
}

test("refuses to mutate before migration is complete", async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.mutate(undefined),
    /nincs átállítva/,
  );
  assert.equal(harness.writes.length, 0);
});

test("adds records and updates the counter atomically", async () => {
  const harness = createHarness();
  const code = "E-RO-UL-SP-01";
  await harness.mutate(counterData(), {
    additions: [{ codePrefix: "E-RO-UL-SP", record: inventoryRecord(code) }],
    nextValues: { "E-RO-UL": 2 },
  });

  const shard = harness.documents.get(getInventoryShardId(0));
  const counters = harness.documents.get(INVENTORY_COUNTER_DOC_ID);
  assert.deepEqual(shard.groups["E-RO-UL-SP"], [inventoryRecord(code)]);
  assert.deepEqual(counters.nextByPrefix, { "E-RO-UL": 2 });
  assert.deepEqual(counters.shardIdsByPrefix["E-RO-UL-SP"], [getInventoryShardId(0)]);
  assert.equal(counters.updatedAt, timestamp);
});

test("partitions additions when the active shard is near its size limit", async () => {
  const prefix = "E-RO-UL-SP";
  const firstCode = `${prefix}-01`;
  const secondCode = `${prefix}-02`;
  const initialGroups = { [prefix]: [inventoryRecord(firstCode, { comment: "x".repeat(630_000) })] };
  const firstShardId = getInventoryShardId(0);
  const harness = createHarness({
    [firstShardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: initialGroups,
    },
  });
  assert.ok(estimateInventoryShardBytes(initialGroups) < MAX_INVENTORY_SHARD_BYTES);

  await harness.mutate(counterData({
    shardIdsByPrefix: { [prefix]: [firstShardId] },
  }), {
    additions: [{ codePrefix: prefix, record: inventoryRecord(secondCode, { comment: "y".repeat(100_000) }) }],
  });

  const newShardId = getInventoryShardId(1);
  assert.ok(harness.documents.has(newShardId));
  assert.deepEqual(harness.documents.get(newShardId).groups[prefix], [
    inventoryRecord(secondCode, { comment: "y".repeat(100_000) }),
  ]);
  assert.deepEqual(
    harness.documents.get(INVENTORY_COUNTER_DOC_ID).shardIdsByPrefix[prefix],
    [firstShardId, newShardId],
  );
});

test("replaces imported duplicate codes while preserving unrelated records", async () => {
  const prefix = "E-RO-UL-SP";
  const shardId = getInventoryShardId(0);
  const oldRecord = inventoryRecord(`${prefix}-01`, { name: "Régi név" });
  const unrelatedRecord = inventoryRecord(`${prefix}-02`);
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: [oldRecord, unrelatedRecord] },
    },
  });

  await harness.mutate(counterData({
    shardIdsByPrefix: { [prefix]: [shardId] },
  }), {
    additions: [{ codePrefix: prefix, record: inventoryRecord(`${prefix}-01`) }],
  });

  assert.deepEqual(harness.documents.get(shardId).groups[prefix], [
    inventoryRecord(`${prefix}-02`),
    inventoryRecord(`${prefix}-01`),
  ]);
});

test("rejects a conflicting edit without changing stored data", async () => {
  const prefix = "E-RO-UL-SP";
  const shardId = getInventoryShardId(0);
  const existing = inventoryRecord(`${prefix}-01`);
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: [existing] },
    },
  });
  const originalCounter = counterData({
    shardIdsByPrefix: { [prefix]: [shardId] },
  });

  await assert.rejects(
    harness.mutate(originalCounter, {
      additions: [{ codePrefix: prefix, record: existing }],
      rejectDuplicateCodes: true,
    }),
    /ugyanazzal a sorszámmal/,
  );
  assert.equal(harness.writes.length, 0);
});

test("deletes an emptied non-active shard and removes its mapping", async () => {
  const prefix = "E-RO-UL-SP";
  const shardId = getInventoryShardId(0);
  const record = inventoryRecord(`${prefix}-01`);
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: [record] },
    },
  });

  await harness.mutate(counterData({
    activeShardId: getInventoryShardId(1),
    nextShardNumber: 2,
    shardIdsByPrefix: { [prefix]: [shardId] },
  }), {
    removals: [{ shardId, codePrefix: prefix, code: record.leltariSzam }],
  });

  assert.equal(harness.documents.has(shardId), false);
  assert.equal(harness.documents.get(INVENTORY_COUNTER_DOC_ID).shardIdsByPrefix[prefix], undefined);
  assert.ok(harness.writes.some((write) => write.type === "delete" && write.ref.id === shardId));
});
