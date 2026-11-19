export async function bootstrapUserProfile({
  db,
  uid,
  profile,
  isFirstAuthUser,
  serverTimestamp,
}) {
  const users = db.collection("users");
  const userRef = users.doc(uid);
  const bootstrapRef = db.collection("system").doc("accessBootstrap");

  return db.runTransaction(async (transaction) => {
    const [bootstrapSnapshot, userSnapshot] = await Promise.all([
      transaction.get(bootstrapRef),
      transaction.get(userRef),
    ]);

    let bootstrapData;
    if (bootstrapSnapshot.exists) {
      bootstrapData = bootstrapSnapshot.data();
    } else {
      const usersSnapshot = await transaction.get(users.limit(1));
      bootstrapData = {
        initialized: true,
        firstUserUid: usersSnapshot.empty && isFirstAuthUser ? uid : null,
        createdAt: serverTimestamp(),
      };
      transaction.set(bootstrapRef, bootstrapData);
    }

    const hasAccess = userSnapshot.exists
      ? userSnapshot.data().hasAccess === true || bootstrapData.firstUserUid === uid
      : bootstrapData.firstUserUid === uid;
    transaction.set(userRef, {
      ...profile,
      uid,
      hasAccess,
      lastSignInAt: serverTimestamp(),
    }, { merge: true });

    return { hasAccess };
  });
}
