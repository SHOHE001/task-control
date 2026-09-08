import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createSchema,
  extract,
  ended,
  preferencesSchema,
  type Task,
  smallAction,
} from "./domain.ts";
export class Store {
  db: DatabaseSync;
  constructor(path = process.env.DB_PATH ?? "./data/task-control.sqlite") {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;",
    );
    this.transaction(() => {
      if (
        !this.db
          .prepare("SELECT name FROM sqlite_master WHERE name='migrations'")
          .get()
      )
        this.db.exec(
          readFileSync(
            new URL("../migrations/001.sql", import.meta.url),
            "utf8",
          ),
        );
      if (
        !this.db.prepare("SELECT version FROM migrations WHERE version=2").get()
      )
        this.db.exec(
          readFileSync(
            new URL("../migrations/002.sql", import.meta.url),
            "utf8",
          ),
        );
    });
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key);
    return row ? JSON.parse(row.value as string) : fallback;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  prefs() {
    return preferencesSchema.parse(this.get("preferences", {}));
  }
  list(): Task[] {
    return this.db
      .prepare("SELECT data FROM tasks ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  task(id: string): Task {
    const row = this.db.prepare("SELECT data FROM tasks WHERE id=?").get(id);
    if (!row)
      throw Object.assign(new Error("タスクが見つかりません"), {
        statusCode: 404,
      });
    return JSON.parse(row.data as string);
  }
  create(input: unknown, initialize?: (t: Task) => void) {
    const x = createSchema.parse(input);
    const now = new Date().toISOString();
    const d = extract(x.original);
    const t: Task = {
      id: randomUUID(),
      title: x.title || x.original.slice(0, 80),
      original: x.original,
      sourceUrl: x.sourceUrl,
      deadline: d,
      deadlineConfirmedAt: null,
      planAt: null,
      next: smallAction(x.title || x.original),
      stepDone: "確認した条件が1行残っている",
      totalDone: "",
      workUrl: "",
      resume: "",
      state: "ready",
      needsSubmission: true,
      submittedAt: null,
      importance: "normal",
      estimate: null,
      createdAt: now,
      lastActedAt: null,
      deferUntil: null,
      revision: 1,
      notificationRevision: 1,
      deadlineRevision: 1,
    };
    initialize?.(t);
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO tasks(id,data) VALUES(?,?)")
        .run(t.id, JSON.stringify(t));
      this.history(t.id, "created", null, t);
    });
    return t;
  }
  history(id: string | null, kind: string, before: unknown, after: unknown) {
    this.db
      .prepare(
        "INSERT INTO history(task_id,kind,before_data,after_data,at) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        kind,
        JSON.stringify(before),
        JSON.stringify(after),
        new Date().toISOString(),
      );
  }
  change(id: string, version: number, kind: string, fn: (t: Task) => void) {
    return this.transaction(() => {
      const t = this.task(id);
      if (t.revision !== version)
        throw Object.assign(
          new Error("別の画面で更新されました。再読み込みしてください"),
          { statusCode: 409 },
        );
      const before = structuredClone(t);
      fn(t);
      t.revision++;
      this.db
        .prepare("UPDATE tasks SET data=?,version=? WHERE id=?")
        .run(JSON.stringify(t), t.revision, id);
      this.history(id, kind, before, t);
      if (t.notificationRevision !== before.notificationRevision || ended(t))
        this.db
          .prepare(
            "UPDATE jobs SET status='cancelled' WHERE task_id=? AND status IN ('pending','sending')",
          )
          .run(id);
      if (t.deadlineRevision !== before.deadlineRevision)
        this.db
          .prepare(
            "UPDATE sync SET desired=?,status='pending',attempts=0,next_try=0,error=NULL WHERE task_id=?",
          )
          .run(t.deadlineRevision, id);
      this.db
        .prepare(
          "UPDATE work_sync SET desired=?,status='pending',attempts=0,next_try=0,error=NULL WHERE task_id=?",
        )
        .run(t.revision, id);
      return t;
    });
  }
  close() {
    this.db.close();
  }
}
