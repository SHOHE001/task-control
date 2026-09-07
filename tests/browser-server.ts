import { Store } from "../src/db.ts";
import { buildApp } from "../src/server.ts";
import { hashPassword } from "../src/auth.ts";
const store = new Store(":memory:");
store.db
  .prepare("INSERT INTO users VALUES(1,?)")
  .run(hashPassword("fictional-browser-password"));
const app = await buildApp(store, "http://127.0.0.1:3199");
await app.listen({ host: "127.0.0.1", port: 3199 });
