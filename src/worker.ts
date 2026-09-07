import { Store } from "./db.ts";
import { tick } from "./jobs.ts";
import { randomUUID } from "node:crypto";
const store = new Store();
let stopping = false;
const owner = randomUUID();
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
while (!stopping) {
  const acquired = store.transaction(() => {
    const lock = store.get("workerLock", { owner: "", expires: 0 });
    if (lock.expires > Date.now() && lock.owner !== owner) return false;
    store.set("workerLock", { owner, expires: Date.now() + 120000 });
    return true;
  });
  if (acquired) {
    const renew = setInterval(() => {
      store.set("workerLock", { owner, expires: Date.now() + 120000 });
    }, 10000);
    try {
      await tick(store);
    } catch {
      console.error("worker処理に失敗しました。DBと設定を確認してください");
    } finally {
      clearInterval(renew);
      store.transaction(() => {
        if (store.get("workerLock", { owner: "" }).owner === owner)
          store.set("workerLock", { owner: "", expires: 0 });
      });
    }
  }
  if (!stopping) await new Promise((r) => setTimeout(r, 15000));
}
store.close();
