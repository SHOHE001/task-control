import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { Store } from "../src/db.ts";
import { buildApp } from "../src/server.ts";
import { hashPassword } from "../src/auth.ts";
import { choose, deadlineSchema, extract } from "../src/domain.ts";
import { enqueue, runNotifications, schedule } from "../src/jobs.ts";
import {
  eventBody,
  syncOne,
  suggest,
  seal,
  unseal,
} from "../src/integrations.ts";
const password = "fictional-test-password-only";
async function fixture() {
  const store = new Store(":memory:");
  store.db.prepare("INSERT INTO users VALUES(1,?)").run(hashPassword(password));
  const app = await buildApp(store);
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost:3000" },
    payload: { password },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
    origin: "http://localhost:3000",
    cookie: login.cookies[0].name + "=" + login.cookies[0].value,
  };
  return {
    store,
    app,
    headers,
    post: async (url: string, payload: unknown) =>
      app.inject({
        method: "POST",
        url: "/api" + url,
        headers,
        payload: payload as any,
      }),
    close: async () => {
      await app.close();
      store.close();
    },
  };
}
test("1 title-only registration persists incomplete information", async () => {
  const f = await fixture();
  try {
    const r = await f.post("/tasks", { title: "架空の演習" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().deadline.kind, "unknown");
    assert.equal(f.store.list().length, 1);
  } finally {
    await f.close();
  }
});
test("2 date only never gets an invented time; year remains unknown", () => {
  const d = extract("2027年9月18日までに提出");
  assert.equal(d.kind, "date");
  assert.equal(d.time, null);
  assert.equal(d.confirmed, false);
  assert.equal(extract("9月18日まで").kind, "unknown");
  assert.equal(extract("9月18日まで").date, null);
  assert.throws(() => deadlineSchema.parse({ ...d, time: "23:59" }));
});
test("3 relative deadline has no inferred announcement date", () => {
  const d = extract("明日までに提出してください");
  assert.equal(d.kind, "unknown");
  assert.equal(d.date, null);
  assert.match(d.uncertainty.join(), /発信日/);
});
test("4 rescheduling preserves confirmed deadline and its audit entry", async () => {
  const f = await fixture();
  try {
    let t = f.store.create({ title: "架空の提出物" });
    let r = await f.post(`/tasks/${t.id}/deadline`, {
      revision: t.revision,
      ack: true,
      deadline: {
        kind: "date",
        date: "2027-09-18",
        evidence: "2027年9月18日まで",
        confirmed: true,
      },
    });
    assert.equal(r.statusCode, 200);
    t = r.json();
    r = await f.post(`/tasks/${t.id}/plan`, {
      revision: t.revision,
      planAt: "2027-09-16T10:00:00+09:00",
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().deadline, t.deadline);
    assert.equal(
      f.store.db
        .prepare(
          "SELECT count(*) n FROM history WHERE kind='deadline_confirmed'",
        )
        .get()!.n,
      1,
    );
    assert.equal(
      (
        await f.post(`/tasks/${t.id}/edit`, {
          revision: r.json().revision,
          fields: { deadline: { kind: "none" } },
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});
test("5 AI unconfigured or failing falls back without mutating deadline", async () => {
  const s = new Store(":memory:");
  try {
    const t = s.create({ title: "架空", original: "明日まで" });
    assert.equal((await suggest(s, t)).source, "template");
    const previous = {
      endpoint: process.env.AI_ENDPOINT,
      model: process.env.AI_MODEL,
    };
    process.env.AI_ENDPOINT = "https://ai.example.test/completions";
    process.env.AI_MODEL = "test";
    s.set("preferences", { ...s.prefs(), aiEnabled: true });
    let called = false;
    try {
      const r = await suggest(s, t, (async () => {
        called = true;
        throw new Error("offline");
      }) as any);
      assert.equal(called, true);
      assert.equal(r.source, "template");
      assert.deepEqual(s.task(t.id).deadline, t.deadline);
    } finally {
      if (previous.endpoint === undefined) delete process.env.AI_ENDPOINT;
      else process.env.AI_ENDPOINT = previous.endpoint;
      if (previous.model === undefined) delete process.env.AI_MODEL;
      else process.env.AI_MODEL = previous.model;
    }
  } finally {
    s.close();
  }
});
test("6 home has one recommendation, explanation, attention and explicit choice", () => {
  const s = new Store(":memory:");
  try {
    const a = s.create({ title: "架空A" });
    const b = s.create({ title: "架空B" });
    const h = choose(s.list());
    assert.ok(h.task);
    assert.ok(h.reason);
    assert.equal(h.attention.length, 2);
    assert.equal(choose(s.list(), Date.now(), a.id).task!.id, a.id);
    s.change(a.id, 1, "defer", (t) => {
      t.deferUntil = "2999-01-01T00:00:00Z";
    });
    assert.equal(choose(s.list()).task!.id, b.id);
  } finally {
    s.close();
  }
});
test("7 start / step completion / work completion / submission are distinct, reversible", async () => {
  const f = await fixture();
  try {
    let t = f.store.create({ title: "架空" });
    for (const action of ["start", "step_done", "work_done"]) {
      const r = await f.post(`/tasks/${t.id}/action`, {
        revision: t.revision,
        action,
      });
      assert.equal(r.statusCode, 200);
      t = r.json();
      assert.equal(t.submittedAt, null);
      assert.notEqual(t.state, "closed");
    }
    assert.equal(
      (
        await f.post(`/tasks/${t.id}/action`, {
          revision: t.revision,
          action: "submit",
        })
      ).statusCode,
      400,
    );
    t = (
      await f.post(`/tasks/${t.id}/action`, {
        revision: t.revision,
        action: "submit",
        ack: true,
      })
    ).json();
    assert.ok(t.submittedAt);
    assert.equal(t.state, "closed");
    t = (
      await f.post(`/tasks/${t.id}/action`, {
        revision: t.revision,
        action: "reopen",
      })
    ).json();
    assert.equal(t.submittedAt, null);
    assert.equal(t.state, "ready");
  } finally {
    await f.close();
  }
});
test("8 pause saves a resume point and work link", async () => {
  const f = await fixture();
  try {
    let t = f.store.create({ title: "架空" });
    t = (
      await f.post(`/tasks/${t.id}/edit`, {
        revision: t.revision,
        fields: { workUrl: "https://example.test/work" },
      })
    ).json();
    t = (
      await f.post(`/tasks/${t.id}/action`, {
        revision: t.revision,
        action: "pause",
        memo: "次は見出しを三つ書く",
      })
    ).json();
    assert.equal(t.resume, "次は見出しを三つ書く");
    assert.equal(f.store.task(t.id).workUrl, "https://example.test/work");
  } finally {
    await f.close();
  }
});
test("9 reopening the database preserves tasks, resume information and jobs", () => {
  const dir = mkdtempSync(join(tmpdir(), "task-control-"));
  try {
    let s = new Store(join(dir, "test.sqlite"));
    const t = s.create({ title: "架空" });
    s.change(t.id, 1, "pause", (x) => {
      x.resume = "続きをここから";
    });
    enqueue(s, "future", "plan", Date.now() + 100000, t.id, 1);
    s.close();
    s = new Store(join(dir, "test.sqlite"));
    assert.equal(s.task(t.id).resume, "続きをここから");
    assert.equal(s.db.prepare("SELECT count(*) n FROM jobs").get()!.n, 1);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("10 postponing or completing invalidates old notification jobs", async () => {
  const f = await fixture();
  try {
    f.store.set("preferences", { ...f.store.prefs(), planNotify: true });
    let t = f.store.create({ title: "架空" });
    t = (
      await f.post(`/tasks/${t.id}/plan`, {
        revision: 1,
        planAt: "2027-09-17T01:00:00Z",
      })
    ).json();
    const old = f.store.db.prepare("SELECT id FROM jobs").get()!.id;
    t = (
      await f.post(`/tasks/${t.id}/plan`, {
        revision: t.revision,
        planAt: "2027-09-18T01:00:00Z",
      })
    ).json();
    assert.equal(
      f.store.db.prepare("SELECT status FROM jobs WHERE id=?").get(old)!.status,
      "cancelled",
    );
    await f.post(`/tasks/${t.id}/action`, {
      revision: t.revision,
      action: "work_done",
    });
    assert.equal(
      f.store.db
        .prepare("SELECT count(*) n FROM jobs WHERE status='pending'")
        .get()!.n,
      0,
    );
  } finally {
    await f.close();
  }
});
function subscription(s: Store) {
  s.db
    .prepare("INSERT INTO subscriptions VALUES(?,?,1)")
    .run(
      "mock",
      JSON.stringify({ endpoint: "https://example.test/push", keys: {} }),
    );
}
test("11 worker retries, restart recovery, expiry and burst limiting", async () => {
  const s = new Store(":memory:");
  try {
    subscription(s);
    const now = Date.now();
    enqueue(s, "stale", "daily", now - 7200000);
    for (let i = 0; i < 10; i++) enqueue(s, "job" + i, "daily", now - 1000);
    let sends = 0;
    await runNotifications(s, now, async () => {
      sends++;
    });
    await runNotifications(s, now + 1000, async () => {
      sends++;
    });
    assert.equal(sends, 3);
    assert.equal(
      s.db.prepare("SELECT status FROM jobs WHERE id='stale'").get()!.status,
      "expired",
    );
    await runNotifications(s, now + 61000, async () => {
      sends++;
    });
    assert.equal(sends, 6);
    assert.equal(
      s.db
        .prepare("SELECT count(*) n FROM deliveries WHERE status='accepted'")
        .get()!.n,
      6,
    );
  } finally {
    s.close();
  }
});
test("11b accepted subscription is skipped after crash before job completion", async () => {
  const s = new Store(":memory:");
  try {
    subscription(s);
    const now = Date.now();
    enqueue(s, "crash", "daily", now - 100);
    s.db
      .prepare("UPDATE jobs SET status='sending',lease=? WHERE id='crash'")
      .run(now - 1);
    s.db
      .prepare("INSERT INTO deliveries VALUES('crash','mock','accepted')")
      .run();
    let sends = 0;
    await runNotifications(s, now, async () => {
      sends++;
    });
    assert.equal(sends, 0);
    assert.equal(
      s.db.prepare("SELECT status FROM jobs WHERE id='crash'").get()!.status,
      "accepted",
    );
  } finally {
    s.close();
  }
});
test("11c failed sends retry at most three times", async () => {
  const s = new Store(":memory:");
  try {
    subscription(s);
    const now = Date.now();
    enqueue(s, "retry", "daily", now);
    let sends = 0;
    const send = async () => {
      sends++;
      throw new Error("offline");
    };
    await runNotifications(s, now, send);
    await runNotifications(s, now + 60001, send);
    await runNotifications(s, now + 180002, send);
    await runNotifications(s, now + 500000, send);
    assert.equal(sends, 3);
    assert.equal(
      s.db.prepare("SELECT status FROM jobs WHERE id='retry'").get()!.status,
      "failed",
    );
  } finally {
    s.close();
  }
});
test("12 calendar repeated sync uses stable ID; date-only uses all-day, no reminders", async () => {
  const s = new Store(":memory:");
  try {
    s.set("calendarId", "dedicated");
    let t = s.create({ title: "架空" });
    t = s.change(t.id, 1, "deadline", (t) => {
      t.deadline = deadlineSchema.parse({
        kind: "date",
        date: "2027-09-18",
        evidence: "案内",
        confirmed: true,
      });
      t.deadlineRevision++;
    });
    const events = new Map();
    let creates = 0;
    const google = {
      call: async (path: string, method = "GET", body?: any) => {
        const id = path.split("/").at(-1)!;
        if (method === "GET") {
          if (!events.has(id))
            throw Object.assign(new Error("missing"), { status: 404 });
          return events.get(id);
        }
        if (method === "POST") {
          creates++;
          events.set(body.id, body);
          return body;
        }
        if (method === "PUT") {
          events.set(id, body);
          return body;
        }
        if (method === "DELETE") events.delete(id);
        return {};
      },
    };
    await syncOne(s, t, google);
    await syncOne(s, t, google);
    assert.equal(creates, 1);
    assert.equal(events.size, 1);
    assert.deepEqual(eventBody(t)!.start, { date: "2027-09-18" });
    assert.deepEqual(eventBody(t)!.end, { date: "2027-09-19" });
    assert.deepEqual(eventBody(t)!.reminders, {
      useDefault: false,
      overrides: [],
    });
    t = s.change(t.id, t.revision, "deadline", (t) => {
      t.deadline = deadlineSchema.parse({ kind: "unknown" });
      t.deadlineRevision++;
    });
    await syncOne(s, t, google);
    assert.equal(events.size, 0);
  } finally {
    s.close();
  }
});
test("13 failed calendar sync reports potentially stale external deadline", async () => {
  const s = new Store(":memory:");
  try {
    s.set("calendarId", "dedicated");
    const t = s.create({ title: "架空" });
    await syncOne(s, t, {
      call: async () => {
        throw new Error("offline");
      },
    });
    const r = s.db.prepare("SELECT status,error FROM sync").get()!;
    assert.equal(r.status, "failed");
    assert.match(String(r.error), /古い期限/);
  } finally {
    s.close();
  }
});
test("14 unauthenticated APIs, foreign origins, dangerous links and stale writes are rejected", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject("/api/tasks")).statusCode, 401);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/tasks",
          headers: { origin: "http://localhost:3000" },
          payload: { title: "x" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/tasks",
          headers: { ...f.headers, origin: "https://evil.test" },
          payload: { title: "x" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await f.post("/tasks", { title: "x", sourceUrl: "javascript:alert(1)" }))
        .statusCode,
      400,
    );
    const t = f.store.create({ title: "架空" });
    assert.equal(
      (
        await f.post(`/tasks/${t.id}/edit`, {
          revision: 0,
          fields: { title: "変更" },
        })
      ).statusCode,
      409,
    );
  } finally {
    await f.close();
  }
});
test("15 rejected storage writes return failure and preserve previous state", async () => {
  const f = await fixture();
  try {
    const t = f.store.create({ title: "架空" });
    f.store.db.exec(
      "CREATE TRIGGER reject_update BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'simulated disk error'); END;",
    );
    const r = await f.post(`/tasks/${t.id}/edit`, {
      revision: 1,
      fields: { title: "未保存" },
    });
    assert.notEqual(r.statusCode, 200);
    assert.equal(f.store.task(t.id).title, "架空");
  } finally {
    await f.close();
  }
});
test("16 online backup restores a separate valid DB, including WAL changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "task-control-backup-"));
  try {
    const s = new Store(join(dir, "live.sqlite"));
    const t = s.create({ title: "架空の復元テスト" });
    s.change(t.id, 1, "pause", (t) => {
      t.resume = "復元後の続き";
    });
    await backup(s.db, join(dir, "copy.sqlite"));
    const restored = new DatabaseSync(join(dir, "copy.sqlite"));
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get()!.integrity_check,
      "ok",
    );
    assert.equal(
      JSON.parse(
        restored.prepare("SELECT data FROM tasks").get()!.data as string,
      ).resume,
      "復元後の続き",
    );
    restored.close();
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("settings changes create new jobs without reactivating old IDs", () => {
  const s = new Store(":memory:");
  try {
    s.set("preferences", {
      ...s.prefs(),
      dailyTime: "12:00",
      weeklyTime: "12:00",
      weeklyDay: 1,
    });
    schedule(s);
    const before = s.db.prepare("SELECT count(*) n FROM jobs").get()!.n;
    schedule(s);
    assert.equal(s.db.prepare("SELECT count(*) n FROM jobs").get()!.n, before);
  } finally {
    s.close();
  }
});
test("OAuth secrets are encrypted and authenticated", () => {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "ab".repeat(32);
  try {
    const cipher = seal("fake-token");
    assert.equal(unseal(cipher), "fake-token");
    assert.ok(!cipher.includes("fake-token"));
    assert.throws(() => unseal(cipher.slice(0, -4) + "aaaa"));
  } finally {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  }
});

test("ambiguous/nonexistent deadline clocks are rejected; UTC offset can be explicit", () => {
  const base = {
    kind: "datetime",
    evidence: "架空の案内",
    confirmed: true,
    zone: "America/New_York",
  };
  assert.throws(() =>
    deadlineSchema.parse({ ...base, date: "2027-03-14", time: "02:30" }),
  );
  assert.throws(() =>
    deadlineSchema.parse({ ...base, date: "2027-11-07", time: "01:30" }),
  );
  assert.ok(
    deadlineSchema.parse({
      ...base,
      date: "2027-11-07",
      time: "01:30",
      zone: "UTC-5",
    }),
  );
});
test("malformed optional AI endpoint does not prevent settings or core operations", async () => {
  const old = process.env.AI_ENDPOINT;
  process.env.AI_ENDPOINT = "not-a-url";
  const f = await fixture();
  try {
    const result = await f.app.inject({
      url: "/api/settings",
      headers: f.headers,
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().ai.configured, false);
    assert.equal((await f.post("/tasks", { title: "架空" })).statusCode, 200);
  } finally {
    await f.close();
    if (old === undefined) delete process.env.AI_ENDPOINT;
    else process.env.AI_ENDPOINT = old;
  }
});
test("calendar never overwrites events without its ownership marker", async () => {
  const s = new Store(":memory:");
  try {
    s.set("calendarId", "dedicated");
    const t = s.create({ title: "架空" });
    let writes = 0;
    await syncOne(s, t, {
      call: async (_path, method = "GET") => {
        if (method !== "GET") writes++;
        return { summary: "unrelated" };
      },
    });
    assert.equal(writes, 0);
    assert.equal(
      s.db.prepare("SELECT status FROM sync").get()!.status,
      "failed",
    );
  } finally {
    s.close();
  }
});

test("expired Push subscriptions are never reported as accepted delivery", async () => {
  const s = new Store(":memory:");
  try {
    subscription(s);
    const now = Date.now();
    enqueue(s, "gone", "test", now);
    await runNotifications(s, now, async () => {
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    assert.equal(
      s.db.prepare("SELECT active FROM subscriptions").get()!.active,
      0,
    );
    const job = s.db
      .prepare("SELECT status,accepted_at FROM jobs WHERE id='gone'")
      .get()!;
    assert.notEqual(job.status, "accepted");
    assert.equal(job.accepted_at, null);
  } finally {
    s.close();
  }
});
