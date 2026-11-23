import assert from "node:assert/strict";
import test from "node:test";
import {
  addChildSerialNumber,
  INVENTORY_COUNTER_DOC_ID,
  INVENTORY_SCHEMA_VERSION,
  MAX_INVENTORY_SHARD_BYTES,
  estimateInventoryShardBytes,
  getInventoryShardId,
  mutateInventoryStorage,
  omitUndefinedFields,
  removeChildSerialNumber,
  updateInventoryRecordTags,
  updateInventorySerialNumber,
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

test("adds a child serial number transactionally and preserves the inventory record", async () => {
  const prefix = "E-RO-UL-SP";
  const code = `${prefix}-01`;
  const shardId = getInventoryShardId(0);
  const original = inventoryRecord(code, {
    serialNumber: "PARENT-SN",
    childSerialNumbers: [{ serialNumber: "OLD-CHILD", name: "Korábbi" }],
    stickerCount: 3,
  });
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: [original] },
    },
  });

  const children = await addChildSerialNumber(harness.transaction, {
    shardRef: harness.getShardRef(shardId),
    codePrefix: prefix,
    code,
    serialNumber: " NEW-CHILD ",
    nickname: "Tartalék",
  }, { serverTimestamp: () => timestamp });
  harness.writes.forEach((write) => harness.documents.set(write.ref.id, write.data));

  assert.deepEqual(children, [
    { serialNumber: "OLD-CHILD", name: "Korábbi" },
    { serialNumber: "NEW-CHILD", nickname: "Tartalék" },
  ]);
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.documents.get(shardId).groups[prefix][0], {
    ...original,
    childSerialNumbers: children,
  });
  assert.equal(harness.documents.get(shardId).updatedAt, timestamp);
});

test("rejects child serial numbers for missing items without writing", async () => {
  const prefix = "E-RO-UL-SP";
  const shardId = getInventoryShardId(0);
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: [] },
    },
  });

  await assert.rejects(
    addChildSerialNumber(harness.transaction, {
      shardRef: harness.getShardRef(shardId),
      codePrefix: prefix,
      code: `${prefix}-missing`,
      serialNumber: "CHILD-SN",
    }, { serverTimestamp: () => timestamp }),
    /A leltári tétel nem található/,
  );
  assert.equal(harness.writes.length, 0);
});

test("updates a parent serial number transactionally and preserves other fields", async () => {
  const prefix = "E-RO-UL-SP";
  const code = `${prefix}-01`;
  const shardId = getInventoryShardId(0);
  const original = inventoryRecord(code, {
    serialNumber: "OLD-PARENT",
    childSerialNumbers: [{ serialNumber: "CHILD-1", name: "Motor" }],
    stickerCount: 3,
  });
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: [original] },
    },
  });

  const updated = await updateInventorySerialNumber(harness.transaction, {
    shardRef: harness.getShardRef(shardId),
    codePrefix: prefix,
    code,
    serialNumber: " NEW-PARENT ",
    nickname: "Szerszámosláda",
  }, { serverTimestamp: () => timestamp });
  harness.writes.forEach((write) => harness.documents.set(write.ref.id, write.data));

  assert.equal(updated.serialNumber, "NEW-PARENT");
  assert.deepEqual(harness.documents.get(shardId).groups[prefix][0], {
    ...original,
    serialNumber: "NEW-PARENT",
    serialNumberNickname: "Szerszámosláda",
  });
  assert.equal(harness.documents.get(shardId).groups[prefix][0].name, "Teszt");
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.documents.get(shardId).updatedAt, timestamp);
});

test("updates a child serial nickname without changing sibling children", async () => {
  const prefix = "E-RO-UL-SP";
  const code = `${prefix}-01`;
  const shardId = getInventoryShardId(0);
  const original = inventoryRecord(code, {
    childSerialNumbers: [
      { serialNumber: "CHILD-1", name: "Motor" },
      { serialNumber: "CHILD-2", name: "Adapter" },
    ],
  });

  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: [original] },
    },
  });

  const updated = await updateInventorySerialNumber(harness.transaction, {
    shardRef: harness.getShardRef(shardId),
    codePrefix: prefix,
    code,
    childIndex: 1,
    serialNumber: " CHILD-2-UPDATED ",
    nickname: "Power adapter",
  }, { serverTimestamp: () => timestamp });

  assert.deepEqual(updated.childSerialNumbers, [
    { serialNumber: "CHILD-1", name: "Motor" },
    { serialNumber: "CHILD-2-UPDATED", nickname: "Power adapter" },
  ]);
  assert.deepEqual(harness.writes[0].data.groups[prefix][0], {
    ...original,
    childSerialNumbers: updated.childSerialNumbers,
  });
});

test("deletes only the requested child serial number", async () => {
  const prefix = "E-RO-UL-SP";
  const code = `${prefix}-01`;
  const shardId = getInventoryShardId(0);
  const original = inventoryRecord(code, {
    childSerialNumbers: [
      { serialNumber: "CHILD-1", name: "Motor" },
      { serialNumber: "CHILD-2", name: "Adapter" },
    ],
  });
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: [original] },
    },
  });

  const updated = await removeChildSerialNumber(harness.transaction, {
    shardRef: harness.getShardRef(shardId),
    codePrefix: prefix,
    code,
    childIndex: 0,
  }, { serverTimestamp: () => timestamp });
  harness.writes.forEach((write) => harness.documents.set(write.ref.id, write.data));

  assert.deepEqual(updated.childSerialNumbers, [
    { serialNumber: "CHILD-2", name: "Adapter" },
  ]);
  assert.deepEqual(harness.documents.get(shardId).groups[prefix][0], {
    ...original,
    childSerialNumbers: [{ serialNumber: "CHILD-2", name: "Adapter" }],
  });
  assert.equal(harness.writes.length, 1);
});

test("rejects child deletion when the requested index no longer exists", async () => {
  const prefix = "E-RO-UL-SP";
  const shardId = getInventoryShardId(0);
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: {
        [prefix]: [inventoryRecord(`${prefix}-01`, {
          childSerialNumbers: [{ serialNumber: "CHILD-1", name: "Motor" }],
        })],
      },
    },
  });

  await assert.rejects(
    removeChildSerialNumber(harness.transaction, {
      shardRef: harness.getShardRef(shardId),
      codePrefix: prefix,
      code: `${prefix}-01`,
      childIndex: 3,
    }, { serverTimestamp: () => timestamp }),
    /A gyermek sorozatszám nem található/,
  );
  assert.equal(harness.writes.length, 0);
});

test("omits undefined optional fields before writing inventory records", async () => {
  const prefix = "E-RO-UL-SP";
  const shardId = getInventoryShardId(0);
  const record = inventoryRecord(`${prefix}-01`, {
    stickerSize: "small",
    stickerCount: undefined,
  });
  const harness = createHarness();

  await harness.mutate(counterData(), {
    additions: [{ codePrefix: prefix, record }],
  });

  assert.deepEqual(harness.documents.get(shardId).groups[prefix], [
    omitUndefinedFields(record),
  ]);
  assert.equal(
    Object.hasOwn(harness.documents.get(shardId).groups[prefix][0], "stickerCount"),
    false,
  );
});

test("refuses to mutate before migration is complete", async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.mutate(undefined),
    /nincs átállítva/,
  );
  assert.equal(harness.writes.length, 0);
});

test("updates tags for multiple records in one shard and preserves the rest of each record", async () => {
  const shardId = getInventoryShardId(0);
  const codePrefix = "E-RO-UL-SP";
  const firstCode = `${codePrefix}-01`;
  const secondCode = `${codePrefix}-02`;
  const documents = new Map([[shardId, {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    groups: {
      [codePrefix]: [
        inventoryRecord(firstCode, { recordId: "one", name: "One", tags: ["existing"] }),
        inventoryRecord(secondCode, { recordId: "two", name: "Two" }),
      ],
    },
  }]]);
  const writes = [];
  let writeStarted = false;
  const transaction = {
    async get(ref) {
      assert.equal(writeStarted, false);
      const data = documents.get(ref.id);
      return { exists: () => data !== undefined, data: () => data };
    },
    set(ref, data) {
      writeStarted = true;
      writes.push({ ref, data });
    },
  };

  const changed = await updateInventoryRecordTags(transaction, [
    {
      shardId,
      codePrefix,
      code: firstCode,
      getNextTags: (tags) => [...tags, "sticker done"],
    },
    {
      shardId,
      codePrefix,
      code: secondCode,
      recordId: "two",
      getNextTags: (tags) => [...tags, "sticker done"],
    },
  ], {
    getShardRef: (id) => ({ id }),
    serverTimestamp: () => timestamp,
  });

  assert.equal(writes.length, 1);
  assert.deepEqual(changed.map((item) => item.beforeTags), [["existing"], []]);
  assert.deepEqual(changed.map((item) => item.afterTags), [
    ["existing", "sticker done"],
    ["sticker done"],
  ]);
  assert.equal(writes[0].data.groups[codePrefix][0].name, "One");
  assert.equal(writes[0].data.groups[codePrefix][1].recordId, "two");
});

test("rejects restoring tags when the current tag state differs from the log", async () => {
  const shardId = getInventoryShardId(0);
  const codePrefix = "E-RO-UL-SP";
  const code = `${codePrefix}-01`;
  const documents = new Map([[shardId, {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    groups: { [codePrefix]: [inventoryRecord(code, { tags: ["sticker done"] })] },
  }]]);
  let writes = 0;
  const transaction = {
    async get(ref) {
      const data = documents.get(ref.id);
      return { exists: () => data !== undefined, data: () => data };
    },
    set() {
      writes += 1;
    },
  };

  await assert.rejects(
    updateInventoryRecordTags(transaction, [{
      shardId,
      codePrefix,
      code,
      expectedTags: ["other"],
      getNextTags: () => [],
    }], {
      getShardRef: (id) => ({ id }),
      serverTimestamp: () => timestamp,
    }),
    /címkéi időközben megváltoztak/,
  );
  assert.equal(writes, 0);
});

test("adds records and updates the counter atomically", async () => {
  const harness = createHarness();
  const code = "E-RO-UL-SP-01";
  const createdAt = new Date("2026-11-10T20:00:00.000Z");
  await harness.mutate(counterData(), {
    additions: [{
      codePrefix: "E-RO-UL-SP",
      record: inventoryRecord(code, { letrehozva: createdAt }),
    }],
    nextValues: { "E-RO-UL": 2 },
  });

  const shard = harness.documents.get(getInventoryShardId(0));
  const counters = harness.documents.get(INVENTORY_COUNTER_DOC_ID);
  assert.deepEqual(shard.groups["E-RO-UL-SP"], [inventoryRecord(code, { letrehozva: createdAt })]);
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

test("updates sticker size for multiple selected records without changing other fields", async () => {
  const prefix = "E-RO-UL-SP";
  const shardId = getInventoryShardId(0);
  const records = [
    inventoryRecord(`${prefix}-01`, { stickerSize: "small", serialNumber: "SN-1" }),
    inventoryRecord(`${prefix}-02`, { stickerSize: "small", serialNumber: "SN-2" }),
  ];
  const harness = createHarness({
    [shardId]: {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      groups: { [prefix]: records },
    },
  });

  await harness.mutate(counterData({
    shardIdsByPrefix: { [prefix]: [shardId] },
  }), {
    removals: records.map((record) => ({
      shardId,
      codePrefix: prefix,
      code: record.leltariSzam,
    })),
    additions: records.map((record) => ({
      codePrefix: prefix,
      record: { ...record, stickerSize: "none" },
    })),
  });

  assert.deepEqual(
    harness.documents.get(shardId).groups[prefix],
    records.map((record) => ({ ...record, stickerSize: "none" })),
  );
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
