import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapUserProfile } from "../functions/bootstrap-user.js";

function createDatabase(initialDocuments = {}) {
  const documents = new Map(Object.entries(initialDocuments));
  const database = {
    collection(name) {
      return {
        doc(id) {
          return { path: `${name}/${id}` };
        },
        limit(count) {
          return { collection: name, count };
        },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(ref) {
          if (ref.collection === "users" && ref.count) {
            const users = [...documents.entries()]
              .filter(([path]) => path.startsWith("users/"))
              .slice(0, ref.count)
              .map(([, data]) => data);
            return { empty: users.length === 0, docs: users };
          }
          const data = documents.get(ref.path);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        },
        set(ref, data, options) {
          writes.push({ type: "set", path: ref.path, data, options });
        },
      };
      const result = await callback(transaction);
      writes.forEach(({ type, path, data, options }) => {
        documents.set(path, options?.merge ? { ...documents.get(path), ...data } : data);
      });
      return result;
    },
  };
  return { database, documents };
}

const serverTimestamp = () => "test-timestamp";

test("grants access to the first user when there are no existing profiles", async () => {
  const { database, documents } = createDatabase();
  const result = await bootstrapUserProfile({
    db: database,
    uid: "first-user",
    profile: { email: "first@example.com" },
    isFirstAuthUser: true,
    serverTimestamp,
  });

  assert.deepEqual(result, { hasAccess: true });
  assert.equal(documents.get("users/first-user").hasAccess, true);
  assert.equal(documents.get("system/accessBootstrap").firstUserUid, "first-user");
});

test("does not grant access when a profile already exists before bootstrap", async () => {
  const { database, documents } = createDatabase({
    "users/existing-user": { uid: "existing-user", hasAccess: false },
  });
  const result = await bootstrapUserProfile({
    db: database,
    uid: "new-user",
    profile: { email: "new@example.com" },
    isFirstAuthUser: false,
    serverTimestamp,
  });

  assert.deepEqual(result, { hasAccess: false });
  assert.equal(documents.get("users/new-user").hasAccess, false);
  assert.equal(documents.get("system/accessBootstrap").firstUserUid, null);
});

test("does not grant access to users signing in after bootstrap", async () => {
  const { database, documents } = createDatabase({
    "system/accessBootstrap": { initialized: true, firstUserUid: "first-user" },
    "users/first-user": { uid: "first-user", hasAccess: true },
  });
  const result = await bootstrapUserProfile({
    db: database,
    uid: "later-user",
    profile: { email: "later@example.com" },
    isFirstAuthUser: false,
    serverTimestamp,
  });

  assert.deepEqual(result, { hasAccess: false });
  assert.equal(documents.get("users/later-user").hasAccess, false);
});

test("does not grant access when another Auth account exists without a profile", async () => {
  const { database, documents } = createDatabase();
  const result = await bootstrapUserProfile({
    db: database,
    uid: "second-auth-user",
    profile: { email: "second@example.com" },
    isFirstAuthUser: false,
    serverTimestamp,
  });

  assert.deepEqual(result, { hasAccess: false });
  assert.equal(documents.get("users/second-auth-user").hasAccess, false);
  assert.equal(documents.get("system/accessBootstrap").firstUserUid, null);
});
