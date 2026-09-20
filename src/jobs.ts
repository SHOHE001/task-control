import { DateTime } from "luxon";
import webpush from "web-push";
import type { Store } from "./db.ts";
import { ended } from "./domain.ts";
import { Google, syncOne, syncWork } from "./integrations.ts";
export function enqueue(
  store: Store,
  id: string,
  kind: string,
  due: number,
  taskId: string | null = null,
  revision: number | null = null,
  expires = due + 3600000,
) {
  store.db
    .prepare(
      "INSERT OR IGNORE INTO jobs(id,kind,due,expires,task_id,revision) VALUES(?,?,?,?,?,?)",
    )
    .run(id, kind, due, expires, taskId, revision);
}
export function schedule(store: Store, now = Date.now()) {
  const p = store.prefs();
  const today = DateTime.fromMillis(now, { zone: p.zone }).startOf("day");
  for (const t of store.list()) {
    if (ended(t)) continue;
    if (p.planNotify && t.planAt && t.state !== "work_done") {
      const due = Date.parse(t.planAt);
      enqueue(
        store,
        `plan:${t.id}:${t.notificationRevision}`,
        "plan",
        due,
        t.id,
        t.notificationRevision,
      );
    }
    if (p.deadlineTime && t.deadline.confirmed && t.deadline.date) {
      const due = DateTime.fromISO(`${t.deadline.date}T${p.deadlineTime}`, {
        zone: p.zone,
      })
        .minus({ days: 1 })
        .toMillis();
      enqueue(
        store,
        `deadline:${t.id}:${t.notificationRevision}`,
        "deadline",
        due,
        t.id,
        t.notificationRevision,
      );
    }
  }
  for (let n = 0; n < 8; n++) {
    const day = today.plus({ days: n });
    for (const [kind, time] of [
      ["daily", p.dailyTime],
      ["weekly", p.weeklyTime],
    ] as const) {
      if (!time || (kind === "weekly" && day.weekday !== p.weeklyDay)) continue;
      const due = DateTime.fromISO(`${day.toISODate()}T${time}`, {
        zone: p.zone,
      }).toMillis();
      enqueue(
        store,
        `${kind}:${store.get("preferencesRevision", 0)}:${day.toISODate()}`,
        kind,
        due,
      );
    }
  }
}
export type Send = (subscription: any, payload: string) => Promise<unknown>;
export async function runNotifications(
  store: Store,
  now = Date.now(),
  send?: Send,
  monotonic: () => number = () => performance.now(),
) {
  const startedAt = monotonic();
  const timestamp = () => now + Math.floor(monotonic() - startedAt);
  store.db
    .prepare(
      "UPDATE jobs SET status='expired',error='通知時刻から1時間以上経過したため送信を省略' WHERE status IN ('pending','sending') AND expires<?",
    )
    .run(now);
  store.db
    .prepare(
      "UPDATE jobs SET status='failed',error='最大試行後に処理が中断しました（到達は不明）' WHERE attempts>=3 AND (status='pending' OR (status='sending' AND lease<?))",
    )
    .run(now);
  store.db
    .prepare(
      "UPDATE jobs SET status='pending' WHERE status='sending' AND lease<? AND expires>=?",
    )
    .run(now, now);
  const subs = store.db
    .prepare("SELECT * FROM subscriptions WHERE active=1")
    .all();
  if (
    !subs.length ||
    (!send &&
      !(
        process.env.VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY &&
        process.env.VAPID_SUBJECT
      ))
  )
    return;
  if (!send) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    send = (s, p) =>
      webpush.sendNotification(s, p, { TTL: 3600, timeout: 10000 });
  }
  // Reserve each attempt in the same transaction as its job, including failures.
  // Persisted timestamps keep retries/restarts and overlapping workers in one window.
  for (let i = 0; i < 3; i++) {
    const job = store.transaction(() => {
      const claimedAt = timestamp();
      const claims = (
        store.get<number[] | null>("notificationClaims", null) ??
        store.db
          .prepare("SELECT accepted_at FROM jobs WHERE accepted_at>?")
          .all(claimedAt - 60000)
          .map((row) => Number(row.accepted_at))
      ).filter((at) => at > claimedAt - 60000);
      if (claims.length >= 3) return;
      const r = store.db
        .prepare(
          "SELECT * FROM jobs WHERE status='pending' AND due<=? AND expires>=? AND attempts<3 ORDER BY due DESC LIMIT 1",
        )
        .get(claimedAt, claimedAt);
      if (r) {
        store.db
          .prepare(
            "UPDATE jobs SET status='sending',lease=?,attempts=attempts+1 WHERE id=?",
          )
          .run(claimedAt + 120000, r.id);
        store.set("notificationClaims", [...claims, claimedAt]);
      }
      return r;
    });
    if (!job) break;
    let failure = false;
    for (const sub of subs) {
      const current = store.db
        .prepare("SELECT status FROM jobs WHERE id=?")
        .get(job.id);
      if (current?.status !== "sending") break;
      if (job.task_id) {
        const t = store.task(String(job.task_id));
        if (ended(t) || t.notificationRevision !== job.revision) {
          store.db
            .prepare("UPDATE jobs SET status='cancelled' WHERE id=?")
            .run(job.id);
          break;
        }
      }
      const delivery = store.db
        .prepare(
          "SELECT status FROM deliveries WHERE job_id=? AND subscription_id=?",
        )
        .get(job.id, sub.id);
      if (delivery?.status === "accepted") continue;
      try {
        await send!(
          JSON.parse(sub.data as string),
          JSON.stringify({
            title: "今の一手",
            body:
              job.kind === "weekly"
                ? "大学の課題一覧と、登録した課題を照合する時間です"
                : "5分だけ始める時間です。作業ページを開いてみましょう",
            tag: job.id,
            url: `/?job=${encodeURIComponent(String(job.id))}`,
            jobId: job.id,
          }),
        );
        store.db
          .prepare(
            "INSERT INTO deliveries VALUES(?,?,'accepted') ON CONFLICT(job_id,subscription_id) DO UPDATE SET status='accepted'",
          )
          .run(job.id, sub.id);
      } catch (e) {
        failure = true;
        if ([404, 410].includes((e as any).statusCode))
          store.db
            .prepare("UPDATE subscriptions SET active=0 WHERE id=?")
            .run(sub.id);
      }
    }
    const completedAt = timestamp();
    store.db
      .prepare(
        "UPDATE jobs SET status=?,due=?,accepted_at=?,error=? WHERE id=? AND status='sending'",
      )
      .run(
        failure
          ? Number(job.attempts) >= 2
            ? "failed"
            : "pending"
          : "accepted",
        failure ? completedAt + 60000 * 2 ** Number(job.attempts) : job.due,
        failure ? null : completedAt,
        failure ? "送信失敗（到達は不明）" : null,
        job.id,
      );
  }
}
export async function tick(
  store: Store,
  now = Date.now(),
  send?: Send,
  google = new Google(store),
) {
  store.set("workerHeartbeat", now);
  schedule(store, now);
  await runNotifications(store, now, send);
  if (store.get("calendarId", "") && store.get("googleToken", ""))
    for (const t of store.list()) {
      if (
        t.deadline.confirmed ||
        store.db.prepare("SELECT task_id FROM sync WHERE task_id=?").get(t.id)
      )
        await syncOne(store, t, google, now);
      if (
        t.planAt ||
        store.db
          .prepare("SELECT task_id FROM work_sync WHERE task_id=?")
          .get(t.id)
      )
        await syncWork(store, t, google, now);
    }
  store.db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
}
