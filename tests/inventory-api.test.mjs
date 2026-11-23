import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFirestoreDocument,
  groupInventoryRecords,
  handleInventoryRequest,
  toDetailGroup,
  toListGroup,
} from "../workers/mnb-rates.js";
import worker from "../workers/mnb-rates.js";

test("inventory CORS preflight allows authorization requests from Firebase Hosting", async () => {
  const response = await worker.fetch(new Request(
    "https://worker.example/inventory/list",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://e5muhely.web.app",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    },
  ), { FIREBASE_PROJECT_ID: "e5muhely" });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://e5muhely.web.app");
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /authorization/i);
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /GET/i);
});

test("inventory API rejects unauthenticated requests before reading Firestore", async () => {
  const response = await handleInventoryRequest(
    new Request("https://worker.example/inventory/list"),
    { FIREBASE_PROJECT_ID: "e5muhely" },
    new Headers({ "Cache-Control": "no-store" }),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required" });
});

test("list endpoint forwards the user's token and returns grouped summaries", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), authorization: init.headers.Authorization });
    if (String(input).endsWith("/leltariSzamlalok/__v2_counters")) {
      return Response.json({
        fields: {
          schemaVersion: { integerValue: "2" },
          migrationComplete: { booleanValue: true },
        },
      });
    }
    return Response.json({
      documents: [{
        name: "projects/e5muhely/databases/(default)/documents/eszkozok/__v2_inventory_0000",
        fields: {
          schemaVersion: { integerValue: "2" },
          groups: {
            mapValue: {
              fields: {
                "E-RO-UL-SP": {
                  arrayValue: {
                    values: [{
                      mapValue: {
                        fields: {
                          counter: { stringValue: "01" },
                          leltariSzam: { stringValue: "E-RO-UL-SP-01" },
                          name: { stringValue: "Teszt" },
                          price: { integerValue: "1200" },
                          serialNumber: { stringValue: "SN-1" },
                          stickerCount: { integerValue: "2" },
                          stickerSize: { stringValue: "small" },
                          recordId: { stringValue: "record-1" },
                        },
                      },
                    }],
                  },
                },
              },
            },
          },
        },
      }],
    });
  };

  try {
    const response = await handleInventoryRequest(
      new Request("https://worker.example/inventory/list", {
        headers: { Authorization: "Bearer firebase-user-token" },
      }),
      { FIREBASE_PROJECT_ID: "e5muhely" },
      new Headers({ "Cache-Control": "no-store" }),
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(({ authorization }) => (
      authorization === "Bearer firebase-user-token"
    )));
    assert.deepEqual(result.groups[0].items, [{
      code: "E-RO-UL-SP-01",
      counter: "01",
      recordId: "record-1",
      serialNumber: "SN-1",
      stickerSize: "small",
    }]);
    assert.equal(Object.hasOwn(result.groups[0].items[0], "stickerCount"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("decodes Firestore REST values into plain JavaScript data", () => {
  assert.deepEqual(decodeFirestoreDocument({
    fields: {
      count: { integerValue: "3" },
      active: { booleanValue: true },
      nested: {
        mapValue: {
          fields: {
            tags: {
              arrayValue: {
                values: [{ stringValue: "one" }, { stringValue: "two" }],
              },
            },
          },
        },
      },
    },
  }), {
    count: 3,
    active: true,
    nested: { tags: ["one", "two"] },
  });
});

test("groups matching records across shards without changing their source records", () => {
  const firstRecord = {
    counter: "01",
    leltariSzam: "E-RO-UL-SP-01",
    name: "Teszt",
    price: 1200,
    currency: "HUF",
    serialNumber: "SN-1",
    alTipus: "A",
    stickerSize: "small",
  };
  const groups = groupInventoryRecords([
    {
      id: "__v2_inventory_0000",
      schemaVersion: 2,
      groups: { "E-RO-UL-SP": [firstRecord] },
    },
    {
      id: "__v2_inventory_0001",
      schemaVersion: 2,
      groups: {
        "E-RO-UL-SP": [{
          ...firstRecord,
          counter: "02",
          leltariSzam: "E-RO-UL-SP-02",
          serialNumber: "SN-2",
        }],
      },
    },
    {
      id: "legacy-prefix-document",
      schemaVersion: 1,
      groups: { "E-RO-UL-SP": [firstRecord] },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((item) => item.code), [
    "E-RO-UL-SP-01",
    "E-RO-UL-SP-02",
  ]);
  assert.equal(firstRecord.shardId, undefined);
});

test("list payload contains only table and action summary fields", () => {
  const [group] = groupInventoryRecords([{
    id: "__v2_inventory_0000",
    schemaVersion: 2,
    groups: {
      "E-RO-UL-SP": [{
        counter: "01",
        leltariSzam: "E-RO-UL-SP-01",
        name: "Teszt",
        price: 1200,
        currency: "HUF",
        serialNumber: "SN-1",
        placement: "Polc",
        comment: "Megjegyzés",
        stickerCount: 2,
        stickerSize: "small",
        recordId: "record-1",
        tags: ["sticker done"],
        alTipus: "A",
      }],
    },
  }]);

  assert.deepEqual(toListGroup(group), {
    code: "E-RO-UL-SP-01",
    codePrefix: "E-RO-UL-SP",
    name: "Teszt",
    price: 1200,
    currency: "HUF",
    placement: "Polc",
    comment: "Megjegyzés",
    items: [{
      code: "E-RO-UL-SP-01",
      counter: "01",
      recordId: "record-1",
      serialNumber: "SN-1",
      stickerSize: "small",
    }],
  });
});

test("detail payload includes only the selected group's editable item fields", () => {
  const [group] = groupInventoryRecords([{
    id: "__v2_inventory_0000",
    schemaVersion: 2,
    groups: {
      "E-RO-UL-SP": [{
        counter: "01",
        leltariSzam: "E-RO-UL-SP-01",
        name: "Teszt",
        price: 1200,
        currency: "HUF",
        serialNumber: "SN-1",
        placement: "Polc",
        comment: "Megjegyzés",
        stickerCount: 2,
        stickerSize: "small",
        recordId: "record-1",
        tags: ["sticker done"],
        alTipus: "A",
        letrehozva: new Date("2026-01-02T03:04:05.000Z"),
        privateField: "not sent",
      }],
    },
  }]);

  const detail = toDetailGroup(group);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].alTipus, "A");
  assert.equal(detail.items[0].stickerCount, 2);
  assert.equal(detail.items[0].recordId, "record-1");
  assert.deepEqual(detail.items[0].tags, ["sticker done"]);
  assert.equal(detail.items[0].privateField, undefined);
  assert.equal(detail.items[0].shardId, "__v2_inventory_0000");
});
