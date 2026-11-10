import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  INVENTORY_COUNTER_DOC_ID,
  INVENTORY_SCHEMA_VERSION,
  INVENTORY_SHARD_PREFIX,
  MAX_INVENTORY_SHARD_BYTES,
  estimateInventoryShardBytes,
  getInventoryShardId,
} from "../public/inventory-storage.js";
const args = new Set(process.argv.slice(2));
const projectArg = process.argv.find((argument) => argument.startsWith("--project="));
const projectId = projectArg?.slice("--project=".length) || process.env.GOOGLE_CLOUD_PROJECT;
const apply = args.has("--apply");
const deleteLegacy = args.has("--delete-legacy");

if (!projectId) {
  throw new Error("Provide --project=<project-id> or set GOOGLE_CLOUD_PROJECT.");
}
if (deleteLegacy && !apply) {
  throw new Error("--delete-legacy requires --apply.");
}

const appOptions = { projectId };
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  appOptions.credential = applicationDefault();
}
initializeApp(appOptions);
const db = getFirestore();

function getCounterPrefix(code) {
  const segments = String(code).split("-");
  if (segments.length < 4) {
    throw new Error(`Cannot determine the counter prefix for inventory code "${code}".`);
  }
  return `${segments[0]}-${segments[1]}-${segments[2].slice(0, 2)}`;
}

async function commitBatches(operations) {
  for (let index = 0; index < operations.length; index += 450) {
    const batch = db.batch();
    operations.slice(index, index + 450).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

const inventoryCollection = db.collection("eszkozok");
const countersCollection = db.collection("leltariSzamlalok");
const counterRef = countersCollection.doc(INVENTORY_COUNTER_DOC_ID);
const [legacyInventorySnapshot, legacyCountersSnapshot, existingCounterSnapshot] = await Promise.all([
  inventoryCollection.get(),
  countersCollection.get(),
  counterRef.get(),
]);

const migrationAlreadyComplete = existingCounterSnapshot.exists
  && existingCounterSnapshot.data().schemaVersion === INVENTORY_SCHEMA_VERSION
  && existingCounterSnapshot.data().migrationComplete === true;
if (existingCounterSnapshot.exists) {
  const existingCounter = existingCounterSnapshot.data();
  if (existingCounter.schemaVersion && existingCounter.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
    throw new Error("The reserved counter document has an unsupported schema version.");
  }
}

const existingReservedInventoryDocs = legacyInventorySnapshot.docs
  .filter((snapshot) => snapshot.id.startsWith(INVENTORY_SHARD_PREFIX));
const inventoryRecords = [];
const seenCodes = new Set();

legacyInventorySnapshot.docs.forEach((snapshot) => {
  if (snapshot.id.startsWith(INVENTORY_SHARD_PREFIX)) return;
  const legacyItems = snapshot.data().sorszamok || {};
  Object.entries(legacyItems).forEach(([counterKey, legacyItem]) => {
    const paddedCounter = String(counterKey).padStart(2, "0");
    const code = legacyItem.leltariSzam || `${snapshot.id}-${paddedCounter}`;
    if (!/-\d{2,3}$/.test(code)) {
      throw new Error(`Unexpected inventory code format in ${snapshot.id}: "${code}".`);
    }
    if (seenCodes.has(code)) throw new Error(`Duplicate inventory code found: "${code}".`);
    seenCodes.add(code);
    inventoryRecords.push({
      codePrefix: code.replace(/-\d{2,3}$/, ""),
      record: {
        ...legacyItem,
        counter: code.match(/-(\d{2,3})$/)[1],
        leltariSzam: code,
      },
    });
  });
});

inventoryRecords.sort((left, right) => (
  left.codePrefix.localeCompare(right.codePrefix)
  || left.record.leltariSzam.localeCompare(right.record.leltariSzam)
));

const shards = [];
const shardIdsByPrefix = {};
inventoryRecords.forEach(({ codePrefix, record }) => {
  let shard = shards.at(-1);
  const recordBytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  const existingGroup = shard?.groups[codePrefix];
  const additionBytes = existingGroup
    ? recordBytes + (existingGroup.length ? 1 : 0)
    : Buffer.byteLength(JSON.stringify(codePrefix), "utf8")
      + 3
      + recordBytes
      + (shard && Object.keys(shard.groups).length ? 1 : 0);

  if (!shard || shard.bytes + additionBytes > MAX_INVENTORY_SHARD_BYTES) {
    const groups = { [codePrefix]: [record] };
    const bytes = estimateInventoryShardBytes(groups);
    if (bytes > MAX_INVENTORY_SHARD_BYTES) {
      throw new Error(`Inventory item "${record.leltariSzam}" exceeds the safe Firestore document size.`);
    }
    shard = { id: getInventoryShardId(shards.length), groups, bytes };
    shards.push(shard);
  } else {
    shard.groups[codePrefix] ||= [];
    shard.groups[codePrefix].push(record);
    shard.bytes += additionBytes;
  }
  shardIdsByPrefix[codePrefix] ||= [];
  if (!shardIdsByPrefix[codePrefix].includes(shard.id)) shardIdsByPrefix[codePrefix].push(shard.id);
});

const nextByPrefix = {};
legacyCountersSnapshot.docs.forEach((snapshot) => {
  if (snapshot.id === INVENTORY_COUNTER_DOC_ID || snapshot.id.startsWith(INVENTORY_SHARD_PREFIX)) return;
  nextByPrefix[snapshot.id] = Math.max(Number(snapshot.data().kovetkezo) || 0, 0);
});
inventoryRecords.forEach(({ record }) => {
  const counterPrefix = getCounterPrefix(record.leltariSzam);
  const counter = Number(record.counter);
  nextByPrefix[counterPrefix] = Math.max(Number(nextByPrefix[counterPrefix]) || 0, counter + 1);
});

const counterData = {
  schemaVersion: INVENTORY_SCHEMA_VERSION,
  migrationComplete: true,
  nextByPrefix,
  shardIdsByPrefix,
  activeShardId: shards.at(-1)?.id || getInventoryShardId(0),
  nextShardNumber: shards.length,
  updatedAt: new Date(),
};

const estimatedBytes = shards.reduce((total, shard) => total + shard.bytes, 0);
console.info(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  projectId,
  legacyInventoryDocuments: legacyInventorySnapshot.size - existingReservedInventoryDocs.length,
  legacyCounterDocuments: legacyCountersSnapshot.size,
  inventoryRecords: inventoryRecords.length,
  inventoryShards: shards.length,
  largestShardBytes: Math.max(0, ...shards.map((shard) => shard.bytes)),
  estimatedInventoryBytes: estimatedBytes,
  deleteLegacy,
}, null, 2));

if (migrationAlreadyComplete) {
  if (!deleteLegacy) {
    throw new Error("The version 2 inventory is already active. Refusing to overwrite live data.");
  }
  const versionedSnapshot = await inventoryCollection
    .where("schemaVersion", "==", INVENTORY_SCHEMA_VERSION)
    .get();
  const versionedCodes = new Set();
  versionedSnapshot.docs.forEach((snapshot) => {
    Object.values(snapshot.data().groups || {}).forEach((items) => {
      items.forEach((item) => versionedCodes.add(item.leltariSzam));
    });
  });
  if (!existingCounterSnapshot.data().migrationComplete
    || [...versionedCodes].some((code) => !code)) {
    throw new Error("The active inventory failed verification. Legacy documents were not deleted.");
  }
  const legacyRefs = [
    ...legacyInventorySnapshot.docs
      .filter((snapshot) => !snapshot.id.startsWith(INVENTORY_SHARD_PREFIX))
      .map((snapshot) => snapshot.ref),
    ...legacyCountersSnapshot.docs
      .filter((snapshot) => snapshot.id !== INVENTORY_COUNTER_DOC_ID
        && !snapshot.id.startsWith(INVENTORY_SHARD_PREFIX))
      .map((snapshot) => snapshot.ref),
  ];
  await commitBatches(legacyRefs.map((ref) => (batch) => batch.delete(ref)));
  console.info(`Verified active inventory and deleted ${legacyRefs.length} legacy document(s).`);
  process.exit(0);
}

if (!apply) {
  console.info("Dry run only. Add --apply to write the versioned documents.");
  process.exit(0);
}

if (existingReservedInventoryDocs.length) {
  await commitBatches(existingReservedInventoryDocs.map((snapshot) => (batch) => batch.delete(snapshot.ref)));
}

await commitBatches(shards.map((shard) => (batch) => batch.set(inventoryCollection.doc(shard.id), {
  schemaVersion: INVENTORY_SCHEMA_VERSION,
  groups: shard.groups,
  updatedAt: new Date(),
})));
await counterRef.set(counterData);

const [writtenInventorySnapshot, writtenCounterSnapshot] = await Promise.all([
  inventoryCollection.where("schemaVersion", "==", INVENTORY_SCHEMA_VERSION).get(),
  counterRef.get(),
]);
const writtenCodes = new Set();
writtenInventorySnapshot.docs.forEach((snapshot) => {
  Object.values(snapshot.data().groups || {}).forEach((items) => {
    items.forEach((item) => writtenCodes.add(item.leltariSzam));
  });
});
if (!writtenCounterSnapshot.exists
  || writtenCounterSnapshot.data().migrationComplete !== true
  || writtenCodes.size !== inventoryRecords.length
  || inventoryRecords.some(({ record }) => !writtenCodes.has(record.leltariSzam))) {
  throw new Error("Migration verification failed. Legacy documents were preserved; inspect the version 2 documents.");
}

console.info(`Verified ${writtenCodes.size} inventory entries in ${writtenInventorySnapshot.size} shard(s).`);

if (deleteLegacy) {
  const legacyRefs = [
    ...legacyInventorySnapshot.docs
      .filter((snapshot) => !snapshot.id.startsWith(INVENTORY_SHARD_PREFIX))
      .map((snapshot) => snapshot.ref),
    ...legacyCountersSnapshot.docs
      .filter((snapshot) => snapshot.id !== INVENTORY_COUNTER_DOC_ID
        && !snapshot.id.startsWith(INVENTORY_SHARD_PREFIX))
      .map((snapshot) => snapshot.ref),
  ];
  await commitBatches(legacyRefs.map((ref) => (batch) => batch.delete(ref)));
  console.info(`Deleted ${legacyRefs.length} verified legacy document(s).`);
} else {
  console.info("Legacy documents are untouched. After verifying the app, rerun with --delete-legacy to remove them.");
}
