import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { DateTime } from "luxon";
import { Store } from "../src/db.ts";
import { intake, defaultPlan } from "../src/intake.ts";
import { deadlineSchema } from "../src/domain.ts";
import {
  syncOne,
  syncWork,
  eventId,
  workEventBody,
  type CalendarAdapter,
} from "../src/integrations.ts";
import { tick, schedule, runNotifications } from "../src/jobs.ts";
import { buildApp } from "../src/server.ts";
import { sessionHash } from "../src/auth.ts";
const now = Date.parse("2026-09-08T09:00:00+09:00");
const example = "9月20日までに経済学レポート。明日の18時に少しだけやる";
function fakeCalendar() {
  const events = new Map<string, any>();
  const writes: string[] = [];
  const adapter: CalendarAdapter = {
    async call(path, method = "GET", body?: any) {
      const id = method === "POST" ? body.id : path.split("/").at(-1)!;
      if (method === "GET") {
        if (!events.has(id))
          throw Object.assign(new Error("missing"), { status: 404 });
        return structuredClone(events.get(id));
      }
      writes.push(method);
      if (method === "DELETE") events.delete(id);
      else events.set(id, structuredClone(body));
      return {};
    },
  };
  return { events, writes, adapter };
}
async function fixture() {
  const store = new Store(":memory:");
  const app = await buildApp(store);
  const token = "fictional-intake-test-session";
  store.db
    .prepare("INSERT INTO sessions VALUES(?,?)")
    .run(sessionHash(token), Date.now() + 60000);
  const headers = {
    origin: "http://localhost:3000",
    cookie: `session=${token}`,
  };
  return {
    store,
    app,
    headers,
    post: (url: string, payload: unknown) =>
      app.inject({
        method: "POST",
        url: `/api${url}`,
        headers,
        payload: payload as any,
      }),
    close: async () => {
      await app.close();
      store.close();
    },
  };
}
test("MVP: one sentence persists independent uncertain deadline and requested start; fake worker exports only start", async () => {
  const s = new Store(":memory:");
  try {
    const result = intake(s, { text: example }, now);
    const t = result.task;
    assert.equal(t.title, "経済学レポート");
    assert.equal(t.deadline.date, null);
    assert.equal(t.deadline.confirmed, false);
    assert.match(result.deadlineCandidate.raw, /9月20日/);
    assert.match(t.deadline.uncertainty.join(" "), /年/);
    assert.equal(t.next, "資料を1つ開く");
    assert.equal(t.planAt, "2026-09-09T18:00:00.000+09:00");
    assert.equal(t.intake!.referenceAt, new Date(now).toISOString());
    assert.equal(t.original, example);
    assert.equal(result.needsConfirmation, true);
    assert.equal(
      s.db.prepare("SELECT COUNT(*) n FROM history WHERE task_id=?").get(t.id)!
        .n,
      1,
    );
    s.set("calendarId", "fake-dedicated");
    s.set("googleToken", "fake-token-unused");
    const fake = fakeCalendar();
    // tick only needs call; no network-capable Google is constructed here.
    await tick(s, now, async () => {}, fake.adapter as any);
    await tick(s, now + 1000, async () => {}, fake.adapter as any);
    assert.equal(fake.events.size, 1);
    assert.deepEqual(fake.writes, ["POST"]);
    const event = fake.events.get(eventId(`${t.id}:start`));
    assert.match(event.summary, /資料を1つ開く/);
    assert.equal(event.extendedProperties.private.taskControlKind, "start");
    assert.equal(
      Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime),
      20 * 60000,
    );
    assert.deepEqual(event.reminders, { useDefault: false, overrides: [] });
    assert.equal(s.task(t.id).deadline.confirmed, false);
  } finally {
    s.close();
  }
});
test("intake extracts year-qualified dates conservatively and never treats start dates as deadline", () => {
  const s = new Store(":memory:");
  try {
    for (const text of [
      "木曜までに経済学レポート",
      "経済学レポート。明日まで",
      "経済学レポート。2026年2月30日まで",
      "経済学レポート。9月20日と9月22日まで",
    ]) {
      const r = intake(s, { text }, now);
      assert.equal(r.task.deadline.date, null);
      assert.equal(r.task.deadline.confirmed, false);
    }
    const dated = intake(s, { text: "2026年9月20日までに経済学レポート" }, now);
    assert.equal(dated.task.deadline.date, "2026-09-20");
    assert.equal(dated.task.deadline.time, null);
    assert.equal(dated.task.deadline.confirmed, false);
    const onlyStart = intake(
      s,
      { text: "経済学レポート。2026年9月15日18時にやる" },
      now,
    );
    assert.equal(onlyStart.task.deadline.date, null);
    assert.equal(onlyStart.needsConfirmation, false);
    assert.match(onlyStart.task.planAt!, /^2026-09-15T18:00/);
    assert.equal(intake(s, { text: "読む" }, now).task.title, "読む");
  } finally {
    s.close();
  }
});
test("requested time/duration wins; source-relative, invalid, ambiguous and past wishes stay unscheduled", () => {
  const s = new Store(":memory:");
  try {
    const study = intake(
      s,
      { text: "基本情報の勉強。試験10/20。今週どこかで30分やりたい" },
      now,
    );
    assert.equal(study.task.title, "基本情報の勉強");
    assert.equal(study.task.startPlan!.durationMinutes, 30);
    assert.equal(study.task.next, "問題を1問読む");
    assert.equal(study.task.deadline.date, null);
    assert.match(study.task.planAt!, /^2026-09-08T18:00/);
    assert.equal(
      intake(s, { text: example, mode: "source" }, now).task.planAt,
      null,
    );
    assert.match(
      intake(
        s,
        { text: example, mode: "source", referenceAt: "2026-09-08T00:00:00Z" },
        now,
      ).task.planAt!,
      /2026-09-09T18:00/,
    );
    for (const wish of [
      "明日の25時にやる",
      "今日の8時にやる",
      "来週どこかでやる",
      "9月15日18時にやる",
      "明日18時と明後日18時にやる",
      "明日18時に999分やる",
    ]) {
      const r = intake(s, { text: `架空の課題。${wish}` }, now);
      assert.equal(r.task.planAt, null, wish);
      assert.ok(r.notes.length);
    }
    const halfHour = intake(s, { text: "レポート。明日18時30分にやる" }, now);
    assert.equal(halfHour.task.startPlan!.durationMinutes, 20);
    assert.match(halfHour.task.planAt!, /T18:30/);
    const evening = intake(s, { text: "レポート。明日の夕方に少しやる" }, now);
    assert.match(evening.task.planAt!, /T18:00/);
    assert.match(evening.notes.join(" "), /自動選択/);
    s.set("preferences", { zone: "America/New_York" });
    assert.equal(
      intake(s, { text: "課題。2026年11月1日1時30分にやる" }, now).task.planAt,
      null,
    );
  } finally {
    s.close();
  }
});
test("deadline confirmation replans only automatic starts; explicit and manual plans remain independent", async () => {
  const f = await fixture();
  try {
    const d = deadlineSchema.parse({
      kind: "date",
      date: "2099-09-20",
      confirmed: true,
      evidence: "fictional source",
    });
    let t = intake(f.store, { text: "架空のレポート" }, now).task;
    const r = await f.post(`/tasks/${t.id}/deadline`, {
      revision: t.revision,
      deadline: d,
      ack: true,
    });
    assert.equal(r.statusCode, 200);
    t = r.json();
    assert.match(t.planAt!, /^2099-09-13T18:00/);
    assert.equal(t.deadline.date, d.date);
    assert.match(
      defaultPlan(t, Date.parse("2099-09-15T00:00:00Z"), "Asia/Tokyo").at!,
      /^2099-09-17/,
    );
    const manual = await f.post(`/tasks/${t.id}/plan`, {
      revision: t.revision,
      planAt: "2099-09-18T10:00:00+09:00",
    });
    t = manual.json();
    const before = structuredClone(t.deadline);
    const changed = await f.post(`/tasks/${t.id}/deadline`, {
      revision: t.revision,
      deadline: { ...d, date: "2099-10-20" },
      ack: true,
    });
    assert.equal(changed.json().planAt, t.planAt);
    assert.equal(
      (
        await f.post(`/tasks/${t.id}/plan`, {
          revision: changed.json().revision,
          planAt: null,
        })
      ).json().deadline.date,
      "2099-10-20",
    );
    assert.equal(before.date, "2099-09-20");
    let explicit = intake(f.store, { text: example }, now).task;
    const at = explicit.planAt;
    explicit = (
      await f.post(`/tasks/${explicit.id}/deadline`, {
        revision: explicit.revision,
        deadline: d,
        ack: true,
      })
    ).json();
    assert.equal(explicit.planAt, at);
  } finally {
    await f.close();
  }
});
test("intake API inherits auth and Origin; rejects unexpected privileged fields and preserves atomic history", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/intake",
          headers: { origin: f.headers.origin },
          payload: { text: example },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/intake",
          headers: { ...f.headers, origin: "https://foreign.invalid" },
          payload: { text: example },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await f.post("/intake", { text: example, confirmed: true })).statusCode,
      400,
    );
    assert.equal((await f.post("/intake", { text: " " })).statusCode, 400);
    assert.equal(f.store.list().length, 0);
    const r = await f.post("/intake", { text: example });
    assert.equal(r.statusCode, 200);
    assert.ok(r.json().startPlan.value);
    assert.equal(r.json().task.deadline.confirmed, false);
    f.store.db.exec(
      "CREATE TRIGGER reject_intake_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT,'fixture'); END;",
    );
    assert.equal(
      (await f.post("/intake", { text: "架空の別課題" })).statusCode,
      400,
    );
    assert.equal(f.store.list().length, 1);
  } finally {
    await f.close();
  }
});
test("work events update, cancel and reopen without touching deadline or unrelated events", async () => {
  const f = await fixture();
  try {
    f.store.set("calendarId", "fake-dedicated");
    const fake = fakeCalendar();
    let t = intake(f.store, { text: example }, now).task;
    t = (
      await f.post(`/tasks/${t.id}/deadline`, {
        revision: t.revision,
        deadline: {
          kind: "date",
          date: "2099-09-20",
          confirmed: true,
          evidence: "fictional",
        },
        ack: true,
      })
    ).json();
    await syncOne(f.store, t, fake.adapter, now);
    await syncWork(f.store, t, fake.adapter, now);
    assert.equal(fake.events.size, 2);
    const deadline = structuredClone(fake.events.get(eventId(t.id)));
    t = (
      await f.post(`/tasks/${t.id}/plan`, {
        revision: t.revision,
        planAt: "2099-09-15T18:00:00+09:00",
      })
    ).json();
    await syncWork(f.store, t, fake.adapter, now);
    assert.equal(fake.events.size, 2);
    assert.deepEqual(fake.events.get(eventId(t.id)), deadline);
    const stale = await f.post(`/tasks/${t.id}/plan`, {
      revision: t.revision - 1,
      planAt: null,
    });
    assert.equal(stale.statusCode, 409);
    t = (
      await f.post(`/tasks/${t.id}/action`, {
        revision: t.revision,
        action: "work_done",
      })
    ).json();
    assert.equal(t.submittedAt, null);
    await syncWork(f.store, t, fake.adapter, now);
    assert.equal(fake.events.size, 1);
    t = (
      await f.post(`/tasks/${t.id}/action`, {
        revision: t.revision,
        action: "reopen",
      })
    ).json();
    await syncWork(f.store, t, fake.adapter, now);
    assert.equal(fake.events.size, 2);
    assert.match(
      fake.events.get(eventId(`${t.id}:start`)).summary,
      /資料を1つ開く/,
    );
    t = (
      await f.post(`/tasks/${t.id}/plan`, {
        revision: t.revision,
        planAt: null,
      })
    ).json();
    await syncWork(f.store, t, fake.adapter, now);
    assert.equal(fake.events.size, 1);
    assert.deepEqual(fake.events.get(eventId(t.id)), deadline);
  } finally {
    await f.close();
  }
});
test("work ownership is checked before update/delete and after insert conflict", async () => {
  for (const mode of ["update", "delete", "conflict"]) {
    const s = new Store(":memory:");
    try {
      s.set("calendarId", "fake");
      let t = intake(s, { text: example }, now).task;
      if (mode === "delete")
        t = s.change(t.id, t.revision, "planned", (x) => {
          x.planAt = null;
        });
      let gets = 0;
      const writes: string[] = [];
      await syncWork(
        s,
        t,
        {
          async call(_path, method = "GET") {
            if (method === "GET") {
              gets++;
              if (mode === "conflict" && gets === 1)
                throw Object.assign(new Error(), { status: 404 });
              return {
                extendedProperties: {
                  private: { taskControlId: t.id, taskControlKind: "deadline" },
                },
              };
            }
            writes.push(method);
            if (method === "POST")
              throw Object.assign(new Error(), { status: 409 });
            return {};
          },
        },
        now,
      );
      assert.deepEqual(writes, mode === "conflict" ? ["POST"] : []);
      assert.equal(
        s.db.prepare("SELECT status FROM work_sync").get()!.status,
        "failed",
      );
    } finally {
      s.close();
    }
  }
});
test("work retries are bounded, reset on changes, and an in-flight old result cannot mark new revision synced", async () => {
  const s = new Store(":memory:");
  try {
    s.set("calendarId", "fake");
    let t = intake(s, { text: example }, now).task;
    let attempts = 0;
    const failing = {
      async call() {
        attempts++;
        throw new Error("fixture");
      },
    };
    for (let i = 0; i < 7; i++)
      await syncWork(s, t, failing, now + i * 3600001);
    assert.equal(attempts, 5);
    t = s.change(t.id, t.revision, "planned", (x) => {
      x.planAt = "2099-09-15T18:00:00Z";
    });
    const fake = fakeCalendar();
    await syncWork(s, t, fake.adapter, now);
    assert.equal(
      s.db.prepare("SELECT status FROM work_sync").get()!.status,
      "synced",
    );
    t = s.change(t.id, t.revision, "edited", (x) => {
      x.title = "架空の更新";
    });
    let updated = false;
    await syncWork(
      s,
      t,
      {
        async call(path, method, body) {
          if (method === "PUT" && !updated) {
            updated = true;
            s.change(t.id, t.revision, "planned", (x) => {
              x.planAt = null;
            });
          }
          return fake.adapter.call(path, method, body);
        },
      },
      now,
    );
    assert.equal(
      s.db.prepare("SELECT status FROM work_sync").get()!.status,
      "pending",
    );
    await syncWork(s, s.task(t.id), fake.adapter, now);
    assert.equal(fake.events.size, 0);
  } finally {
    s.close();
  }
});
test("migration preserves old tasks; intake data, work sync and history survive backup/reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tc-intake-"));
  const path = join(dir, "source.sqlite");
  let s: Store | undefined;
  try {
    const old = new DatabaseSync(path);
    old.exec(
      readFileSync(new URL("../migrations/001.sql", import.meta.url), "utf8"),
    );
    const legacy = new Store(":memory:");
    const oldTask = legacy.create({ title: "架空の既存" });
    legacy.close();
    old
      .prepare("INSERT INTO tasks(id,data) VALUES(?,?)")
      .run(oldTask.id, JSON.stringify(oldTask));
    old.close();
    s = new Store(path);
    assert.deepEqual(s.task(oldTask.id), oldTask);
    const t = intake(s, { text: example }, now).task;
    s.set("calendarId", "fake");
    await syncWork(s, t, fakeCalendar().adapter, now);
    await backup(s.db, join(dir, "backup.sqlite"));
    s.close();
    s = undefined;
    const restored = new Store(join(dir, "backup.sqlite"));
    try {
      assert.deepEqual(restored.task(t.id), t);
      assert.equal(
        restored.db.prepare("SELECT status FROM work_sync").get()!.status,
        "synced",
      );
      assert.equal(
        restored.db.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
    } finally {
      restored.close();
    }
    s = new Store(path);
    assert.deepEqual(s.task(t.id), t);
  } finally {
    s?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("start Push encourages action without revealing task name or original text", async () => {
  const s = new Store(":memory:");
  try {
    const t = intake(s, { text: example }, now).task;
    s.set("preferences", { planNotify: true });
    s.db
      .prepare("INSERT INTO subscriptions VALUES(?,?,1)")
      .run("fixture", JSON.stringify({ endpoint: "https://example.invalid" }));
    schedule(s, now);
    const payloads: string[] = [];
    await runNotifications(s, Date.parse(t.planAt!), async (_sub, payload) => {
      payloads.push(payload);
    });
    assert.equal(payloads.length, 1);
    assert.match(payloads[0], /5分だけ始める/);
    assert.ok(!payloads[0].includes(t.title));
    assert.ok(!payloads[0].includes(t.original));
    assert.equal(workEventBody({ ...t, state: "cancelled" }), null);
    assert.equal(DateTime.fromISO(t.planAt!).isValid, true);
  } finally {
    s.close();
  }
});
