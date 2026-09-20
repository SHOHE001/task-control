import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db.ts";
import { enqueue, runNotifications } from "../src/jobs.ts";

const now = 1_900_000_000_000;
function fixture(store: Store) {
  store.db
    .prepare("INSERT INTO subscriptions VALUES(?,?,1)")
    .run(
      "fixture",
      JSON.stringify({ endpoint: "https://example.test/fake-push" }),
    );
  for (let index = 0; index < 10; index++)
    enqueue(store, `job-${index}`, "test", now);
}

test("failed send rate limit survives ticks and database reopening", async () => {
  const directory = mkdtempSync(join(tmpdir(), "task-control-notifications-"));
  let store = new Store(join(directory, "test.sqlite"));
  try {
    fixture(store);
    let attempts = 0;
    const send = async () => {
      attempts++;
      throw new Error("fixture offline");
    };
    await runNotifications(store, now, send, () => 0);
    assert.equal(attempts, 3);
    store.close();
    store = new Store(join(directory, "test.sqlite"));
    await runNotifications(store, now + 15_000, send, () => 0);
    await runNotifications(store, now + 59_999, send, () => 0);
    assert.equal(attempts, 3);
    await runNotifications(store, now + 60_000, send, () => 0);
    assert.equal(attempts, 6);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("overlapping workers share an atomic rate limit across connections", async () => {
  const directory = mkdtempSync(join(tmpdir(), "task-control-workers-"));
  const first = new Store(join(directory, "test.sqlite"));
  const second = new Store(join(directory, "test.sqlite"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let running: Promise<void> | undefined;
  try {
    fixture(first);
    let attempts = 0;
    running = runNotifications(first, now, async () => {
      attempts++;
      await gate;
    });
    assert.equal(attempts, 1);
    await runNotifications(second, now, async () => {
      attempts++;
    });
    release();
    await running;
    assert.equal(attempts, 3);
    assert.equal(
      first.db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='accepted'")
        .get()!.n,
      3,
    );
  } finally {
    release();
    await running;
    second.close();
    first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expired final-attempt leases fail without a fourth send", async () => {
  const store = new Store(":memory:");
  try {
    for (const [id, status, lease] of [
      ["crashed", "sending", now - 1],
      ["previously-recovered", "pending", now - 1],
      ["active", "sending", now + 1],
    ] as const) {
      enqueue(store, id, "test", now);
      store.db
        .prepare("UPDATE jobs SET status=?,attempts=3,lease=? WHERE id=?")
        .run(status, lease, id);
    }
    let attempts = 0;
    await runNotifications(store, now, async () => {
      attempts++;
    });
    assert.equal(attempts, 0);
    for (const id of ["crashed", "previously-recovered"]) {
      const job = store.db
        .prepare("SELECT status,error,accepted_at FROM jobs WHERE id=?")
        .get(id)!;
      assert.equal(job.status, "failed");
      assert.ok(job.error);
      assert.equal(job.accepted_at, null);
    }
    assert.equal(
      store.db.prepare("SELECT status FROM jobs WHERE id='active'").get()!
        .status,
      "sending",
    );
  } finally {
    store.close();
  }
});

test("slow delivery timestamps each claim when it actually starts", async () => {
  const store = new Store(":memory:");
  try {
    fixture(store);
    let elapsed = 0;
    let attempts = 0;
    await runNotifications(
      store,
      now,
      async () => {
        attempts++;
        elapsed += 20_000;
      },
      () => elapsed,
    );
    assert.equal(attempts, 3);
    await runNotifications(
      store,
      now + 60_000,
      async () => {
        attempts++;
      },
      () => elapsed,
    );
    assert.equal(attempts, 4);
  } finally {
    store.close();
  }
});

test("first claim after upgrade counts recent accepted jobs", async () => {
  const store = new Store(":memory:");
  try {
    fixture(store);
    store.db
      .prepare(
        "UPDATE jobs SET status='accepted',accepted_at=? WHERE id IN ('job-0','job-1')",
      )
      .run(now);
    let attempts = 0;
    const fail = async () => {
      attempts++;
      throw new Error("fixture offline");
    };
    await runNotifications(store, now, fail);
    await runNotifications(store, now + 15_000, fail);
    assert.equal(attempts, 1);
  } finally {
    store.close();
  }
});
