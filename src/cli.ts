import { backup, DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  constants,
  chmodSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { Store } from "./db.ts";
import { hashPassword } from "./auth.ts";
const command = process.argv[2];
if (command === "restore") {
  const [source, target] = process.argv.slice(3);
  if (!source || !target || existsSync(target))
    throw new Error(
      "復元元と、新しい復元先DBを指定してください（既存DBへの上書き不可）",
    );
  const db = new DatabaseSync(resolve(source), { readOnly: true });
  if (db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok")
    throw new Error("バックアップが不正です");
  db.close();
  mkdirSync(dirname(resolve(target)), { recursive: true, mode: 0o700 });
  copyFileSync(source, target, constants.COPYFILE_EXCL);
  chmodSync(target, 0o600);
  console.log("新しい検証用DBへ復元しました");
} else {
  const store = new Store();
  try {
    if (command === "setup") {
      if (store.db.prepare("SELECT id FROM users").get())
        throw new Error("初回設定済みです");
      if (!process.stdin.isTTY) throw new Error("対話端末で実行してください");
      process.stdout.write("初回パスワード（12文字以上・入力非表示）: ");
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let password = "";
      await new Promise<void>((done, reject) => {
        const handler = (buffer: Buffer) => {
          for (const c of buffer.toString()) {
            if (c === "\u0003") {
              process.stdin.setRawMode(false);
              process.stdin.pause();
              reject(new Error("中止しました"));
              return;
            }
            if (c === "\r" || c === "\n") {
              process.stdin.off("data", handler);
              process.stdin.setRawMode(false);
              process.stdin.pause();
              done();
              return;
            }
            if (c === "\u007f") password = password.slice(0, -1);
            else password += c;
          }
        };
        process.stdin.on("data", handler);
      });
      store.db
        .prepare("INSERT INTO users VALUES(1,?)")
        .run(hashPassword(password));
      console.log("\n設定しました");
    } else if (command === "backup") {
      const dir = process.env.BACKUP_DIR ?? "./backups";
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const out = resolve(dir, `task-control-${Date.now()}.sqlite`);
      await backup(store.db, out);
      chmodSync(out, 0o600);
      console.log(out);
    } else if (command === "migrate") console.log("マイグレーション適用済み");
    else
      throw new Error("setup / backup / restore / migrateを指定してください");
  } finally {
    store.close();
  }
}
