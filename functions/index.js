import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { bootstrapUserProfile } from "./bootstrap-user.js";

initializeApp();

export const bootstrapFirstUser = onCall({ region: "europe-central2" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in is required.");
  }

  const token = request.auth.token;
  const authUsers = await getAuth().listUsers(2);
  const isFirstAuthUser = authUsers.users.length === 1
    && authUsers.users[0].uid === request.auth.uid
    && !authUsers.pageToken;
  const result = await bootstrapUserProfile({
    db: getFirestore(),
    uid: request.auth.uid,
    isFirstAuthUser,
    profile: {
      email: typeof token.email === "string" ? token.email : "",
      displayName: typeof token.name === "string" ? token.name : "",
      photoURL: typeof token.picture === "string" ? token.picture : "",
    },
    serverTimestamp: () => FieldValue.serverTimestamp(),
  });

  return result;
});
