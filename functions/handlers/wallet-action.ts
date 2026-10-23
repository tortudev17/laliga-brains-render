import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const { uid } = await requireUser(event);
  const [wallet, ledger] = await Promise.all([
    firebaseDb.ref(`laligaBrains/economy/wallets/${uid}`).get(),
    // Read this user's ledger without an orderBy query. The live database does
    // not define the createdAt index on per-user ledgers, so the indexed query
    // returns HTTP 400 even though the authenticated read itself is allowed.
    firebaseDb.ref(`laligaBrains/economy/ledger/${uid}`).get(),
  ]);
  const transactions = ledger.exists()
    ? Object.values(ledger.val())
      .sort((a, b) => Number((b as { createdAt: number }).createdAt) - Number((a as { createdAt: number }).createdAt))
      .slice(0, 100)
    : [];
  return json(200, { wallet: wallet.val() ?? { balance: 0, updatedAt: Date.now() }, transactions });
});
