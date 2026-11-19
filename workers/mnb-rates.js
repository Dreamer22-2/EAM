const MNB_ENDPOINT = "http://www.mnb.hu/arfolyamok.asmx";
const ALLOWED_ORIGINS = new Set([
  "https://e5muhely.web.app",
  "https://e5muhely.firebaseapp.com",
  "http://127.0.0.1:5000",
  "http://localhost:5000",
]);

function corsHeaders(origin, isInventory = false) {
  let isCodespacesOrigin = false;
  if (origin.startsWith("https://")) {
    try {
      isCodespacesOrigin = new URL(origin).hostname.endsWith(".app.github.dev");
    } catch {
      isCodespacesOrigin = false;
    }
  }
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) || isCodespacesOrigin ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": isInventory ? "GET, POST, OPTIONS" : "GET, OPTIONS",
    "Access-Control-Allow-Headers": isInventory ? "Authorization, Content-Type" : "Content-Type",
    "Cache-Control": isInventory ? "no-store" : "public, max-age=3600",
    "Content-Type": "application/json; charset=utf-8",
  };
}

export function decodeFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(decodeFirestoreValue);
  }
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, field]) => [
        key,
        decodeFirestoreValue(field),
      ]),
    );
  }
  return undefined;
}

export function decodeFirestoreDocument(document) {
  return Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [
      key,
      decodeFirestoreValue(value),
    ]),
  );
}

function getGroupKey(item) {
  return [
    item.codePrefix,
    item.name || "",
    item.price ?? "",
    item.currency || "HUF",
    item.placement || "",
    item.comment || "",
  ].join("\u0000");
}

export function groupInventoryRecords(shards) {
  const groups = new Map();
  shards.forEach((shard) => {
    if (shard.schemaVersion !== 2) return;
    Object.entries(shard.groups || {}).forEach(([codePrefix, entries]) => {
      entries.forEach((record) => {
        const code = record.leltariSzam;
        if (!code) return;
        const item = {
          ...record,
          code,
          codePrefix,
          counter: record.counter || code.slice(code.lastIndexOf("-") + 1),
          shardId: shard.id,
        };
        const key = getGroupKey(item);
        if (!groups.has(key)) groups.set(key, { ...item, items: [] });
        groups.get(key).items.push(item);
      });
    });
  });
  return [...groups.values()];
}

export function toListGroup(group) {
  return {
    code: group.items[0].code,
    codePrefix: group.codePrefix,
    name: group.name || "",
    price: group.price ?? null,
    currency: group.currency || "HUF",
    placement: group.placement || "",
    comment: group.comment || "",
    items: group.items.map((item) => ({
      code: item.code,
      counter: item.counter,
      recordId: item.recordId || "",
      serialNumber: item.serialNumber || "",
      stickerSize: item.stickerSize || "big",
    })),
  };
}

const INVENTORY_RECORD_FIELDS = [
  "counter",
  "leltariSzam",
  "recordId",
  "tags",
  "alTipus",
  "name",
  "price",
  "currency",
  "stickerCount",
  "stickerSize",
  "serialNumber",
  "placement",
  "comment",
  "letrehozva",
];

export function toDetailGroup(group) {
  return {
    code: group.items[0].code,
    codePrefix: group.codePrefix,
    name: group.name || "",
    price: group.price ?? null,
    currency: group.currency || "HUF",
    placement: group.placement || "",
    comment: group.comment || "",
    items: group.items.map((item) => ({
      ...Object.fromEntries(INVENTORY_RECORD_FIELDS
        .filter((field) => Object.hasOwn(item, field))
        .map((field) => [field, item[field]])),
      code: item.code,
      codePrefix: item.codePrefix,
      counter: item.counter,
      shardId: item.shardId,
    })),
  };
}

async function firestoreGet(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Response(JSON.stringify({ error: "Not authorized" }), {
        status: response.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    if (response.status === 404) {
      throw new Response(JSON.stringify({ error: "Inventory storage is not initialized" }), {
        status: 409,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    throw new Error(`Firestore request failed with status ${response.status}`);
  }
  return response.json();
}

async function loadInventoryShards(projectId, token) {
  const endpoint = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
      + "/databases/(default)/documents/eszkozok",
  );
  endpoint.searchParams.set("pageSize", "1000");
  endpoint.searchParams.append("mask.fieldPaths", "schemaVersion");
  endpoint.searchParams.append("mask.fieldPaths", "groups");
  const shards = [];
  let pageToken = "";
  do {
    if (pageToken) endpoint.searchParams.set("pageToken", pageToken);
    const result = await firestoreGet(endpoint, token);
    (result.documents || []).forEach((document) => {
      const id = document.name.split("/").at(-1);
      const data = decodeFirestoreDocument(document);
      if (id.startsWith("__v2_inventory_") && data.schemaVersion === 2) {
        shards.push({ id, ...data });
      }
    });
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return shards;
}

async function loadInventoryShardsByIds(projectId, token, shardIds) {
  const documentsEndpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + "/databases/(default)/documents/eszkozok";
  return Promise.all([...new Set(shardIds)].map(async (shardId) => {
    const document = await firestoreGet(
      `${documentsEndpoint}/${encodeURIComponent(shardId)}`,
      token,
    );
    return {
      id: shardId,
      ...decodeFirestoreDocument(document),
    };
  }));
}

async function loadAuthorizedInventory(projectId, token, codePrefix = "") {
  const documentsEndpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + "/databases/(default)/documents";
  const counterDocument = await firestoreGet(
    `${documentsEndpoint}/leltariSzamlalok/__v2_counters`,
    token,
  );
  const counter = decodeFirestoreDocument(counterDocument);
  if (counter.schemaVersion !== 2 || counter.migrationComplete !== true) {
    throw new Response(JSON.stringify({ error: "Inventory migration is required" }), {
      status: 409,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const shards = codePrefix
    ? await loadInventoryShardsByIds(
      projectId,
      token,
      counter.shardIdsByPrefix?.[codePrefix] || [],
    )
    : await loadInventoryShards(projectId, token);
  return groupInventoryRecords(shards);
}

export async function handleInventoryRequest(request, env, headers) {
  try {
    const url = new URL(request.url);
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers,
      });
    }
    if (!env.FIREBASE_PROJECT_ID) {
      throw new Error("FIREBASE_PROJECT_ID is not configured");
    }
    if (url.pathname === "/inventory/list" && request.method === "GET") {
      const groups = await loadAuthorizedInventory(env.FIREBASE_PROJECT_ID, token);
      return new Response(JSON.stringify({ groups: groups.map(toListGroup) }), { headers });
    }
    if (url.pathname === "/inventory/details" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "A valid JSON request is required" }), {
          status: 400,
          headers,
        });
      }
      if (typeof body.code !== "string" || !body.code) {
        return new Response(JSON.stringify({ error: "A valid inventory code is required" }), {
          status: 400,
          headers,
        });
      }
      const codePrefix = body.code.replace(/-\d{2,3}$/, "");
      const groups = await loadAuthorizedInventory(env.FIREBASE_PROJECT_ID, token, codePrefix);
      const group = groups.find((candidate) => (
        candidate.items.some((item) => item.code === body.code)
      ));
      if (!group) {
        return new Response(JSON.stringify({ error: "Inventory group not found" }), {
          status: 404,
          headers,
        });
      }
      return new Response(JSON.stringify({ group: toDetailGroup(group) }), { headers });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
  } catch (error) {
    if (error instanceof Response) {
      return new Response(error.body, {
        status: error.status,
        headers: { ...headers, ...Object.fromEntries(error.headers) },
      });
    }
    console.error("Inventory API error", error);
    return new Response(JSON.stringify({ error: "Inventory request failed" }), {
      status: 500,
      headers,
    });
  }
}

function extractRate(xml, currency) {
  const pattern = new RegExp(
    `&lt;(?:\\w+:)?Rate[^>]*curr=["']${currency}["'][^&]*&gt;([^&]+)&lt;`,
    "i",
  );
  const match = xml.match(pattern);
  const value = Number(match?.[1]?.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    if (url.pathname.startsWith("/inventory/")) {
      const headers = corsHeaders(origin, true);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }
      return handleInventoryRequest(request, env, headers);
    }
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers,
      });
    }

    try {
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <GetCurrentExchangeRates xmlns="http://www.mnb.hu/webservices/" />
          </soap:Body>
        </soap:Envelope>`;
      const response = await fetch(MNB_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "http://www.mnb.hu/webservices/MNBArfolyamServiceSoap/GetCurrentExchangeRates",
        },
        body: soapBody,
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (!response.ok) {
        throw new Error(`MNB request failed with status ${response.status}`);
      }

      const xml = await response.text();
      const rates = {
        EUR: extractRate(xml, "EUR"),
        USD: extractRate(xml, "USD"),
      };
      if (!rates.EUR || !rates.USD) {
        throw new Error("MNB response did not contain EUR and USD rates");
      }

      return new Response(JSON.stringify({
        source: "MNB",
        fetchedAt: new Date().toISOString(),
        rates,
      }), { headers });
    } catch (error) {
      console.error("MNB exchange-rate proxy error", error);
      return new Response(JSON.stringify({ error: "Exchange rates unavailable" }), {
        status: 502,
        headers,
      });
    }
  },
};
