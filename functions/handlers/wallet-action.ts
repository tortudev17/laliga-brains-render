import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const { uid } = await requireUser(event);
  const [wallet, ledger] = await Promise.all([
    firebaseDb.ref(`laligaBrains/economy/wallets/${uid}`).get(),
    firebaseDb.ref(`laligaBrains/economy/ledger/${uid}`).orderByChild("createdAt").limitToLast(100).get(),
  ]);
  const transactions = ledger.exists() ? Object.values(ledger.val()).sort((a, b) => Number((b as { createdAt: number }).createdAt) - Number((a as { createdAt: number }).createdAt)) : [];
  return json(200, { wallet: wallet.val() ?? { balance: 0, updatedAt: Date.now() }, transactions });
});
