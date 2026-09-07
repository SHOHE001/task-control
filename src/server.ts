import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { Store } from "./db.ts";
import {
  choose,
  deadlineSchema,
  editSchema,
  iso,
  preferencesSchema,
  text,
  ended,
} from "./domain.ts";
import { verify, sessionHash } from "./auth.ts";
import { Google, suggest, aiConfiguration } from "./integrations.ts";
import { enqueue, schedule } from "./jobs.ts";
export async function buildApp(
  store = new Store(),
  origin = process.env.APP_ORIGIN ?? "http://localhost:3000",
) {
  const app = Fastify({ logger: false, bodyLimit: 64000 });
  const secure = new URL(origin).protocol === "https:";
  if (process.env.NODE_ENV === "production" && !secure)
    throw new Error("本番APP_ORIGINにはHTTPSが必要です");
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: secure ? [] : null,
      },
    },
  });
  await app.register(rateLimit, { global: false });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (
      !req.routeOptions.url?.startsWith("/api/") &&
      !req.url.startsWith("/api/")
    )
      return;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== origin
    )
      return reply.code(403).send({ error: "操作元を確認できません" });
    if (req.url.split("?")[0] === "/api/login") return;
    const token = req.cookies.session;
    const session = token
      ? store.db
          .prepare("SELECT expires FROM sessions WHERE id=?")
          .get(sessionHash(token))
      : null;
    if (!session || Number(session.expires) < Date.now())
      return reply.code(401).send({ error: "ログインしてください" });
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: err.issues.map((i) => i.message).join(" / ") });
    const e = err as Error & { statusCode?: number };
    reply.code(e.statusCode ?? 400).send({
      error:
        e.statusCode === 404
          ? e.message
          : e.statusCode === 409
            ? e.message
            : "操作を保存できませんでした。入力や連携設定を確認してください",
    });
  });
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { password } = z
        .object({ password: z.string().min(1).max(256) })
        .parse(req.body);
      const user = store.db
        .prepare("SELECT password FROM users WHERE id=1")
        .get();
      if (!user)
        return reply
          .code(503)
          .send({ error: "管理者が初回パスワードを設定してください" });
      if (!verify(password, user.password as string))
        return reply.code(401).send({ error: "パスワードを確認してください" });
      const token = randomBytes(32).toString("hex");
      store.db
        .prepare("INSERT INTO sessions VALUES(?,?)")
        .run(sessionHash(token), Date.now() + 7 * 86400000);
      reply.setCookie("session", token, {
        path: "/",
        httpOnly: true,
        secure,
        sameSite: "lax",
        maxAge: 7 * 86400,
      });
      return { ok: true };
    },
  );
  app.post("/api/logout", async (req, reply) => {
    store.db
      .prepare("DELETE FROM sessions WHERE id=?")
      .run(sessionHash(req.cookies.session!));
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/tasks", async () => store.list());
  app.post("/api/tasks", async (req) => store.create(req.body));
  app.get("/api/home", async () => ({
    ...choose(
      store.list(),
      Date.now(),
      store.get("selectedTask", ""),
      store.prefs().zone,
    ),
    weeklyCheckedAt: store.get("weeklyCheckedAt", null),
    weeklyTime: store.prefs().weeklyTime,
  }));
  app.post("/api/select", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.body);
    store.task(id);
    store.set("selectedTask", id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req) => ({
    task: store.task(req.params.id),
    history: store.db
      .prepare(
        "SELECT kind,at,before_data,after_data FROM history WHERE task_id=? ORDER BY id DESC LIMIT 30",
      )
      .all(req.params.id),
    sync:
      store.db
        .prepare("SELECT status,error,synced,desired FROM sync WHERE task_id=?")
        .get(req.params.id) ?? null,
    jobs: store.db
      .prepare(
        "SELECT kind,due,status,error,accepted_at,opened_at FROM jobs WHERE task_id=? ORDER BY due DESC LIMIT 20",
      )
      .all(req.params.id),
  }));
  app.post<{ Params: { id: string } }>("/api/tasks/:id/edit", async (req) => {
    const { revision, fields } = z
      .object({ revision: z.number(), fields: editSchema })
      .parse(req.body);
    return store.change(req.params.id, revision, "edited", (t) => {
      Object.assign(t, fields);
      if (fields.title) t.deadlineRevision++;
    });
  });
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/deadline",
    async (req) => {
      const x = z
        .object({
          revision: z.number(),
          deadline: deadlineSchema,
          ack: z.literal(true),
        })
        .parse(req.body);
      return store.change(
        req.params.id,
        x.revision,
        "deadline_confirmed",
        (t) => {
          t.deadline = x.deadline;
          t.deadlineConfirmedAt = x.deadline.confirmed
            ? new Date().toISOString()
            : null;
          t.deadlineRevision++;
          t.notificationRevision++;
        },
      );
    },
  );
  app.post<{ Params: { id: string } }>("/api/tasks/:id/plan", async (req) => {
    const x = z
      .object({ revision: z.number(), planAt: iso.nullable() })
      .parse(req.body);
    const t = store.change(req.params.id, x.revision, "planned", (t) => {
      t.planAt = x.planAt;
      t.deferUntil = x.planAt;
      t.notificationRevision++;
    });
    store.set("selectedTask", "");
    schedule(store);
    return t;
  });
  app.post<{ Params: { id: string } }>("/api/tasks/:id/action", async (req) => {
    const x = z
      .object({
        revision: z.number(),
        action: z.enum([
          "start",
          "pause",
          "step_done",
          "work_done",
          "submit",
          "reopen",
          "cancel",
          "smaller",
        ]),
        memo: text.optional(),
        reason: z.enum(["unclear", "large", "energy", "purpose"]).optional(),
        ack: z.boolean().optional(),
      })
      .parse(req.body);
    const t = store.change(req.params.id, x.revision, x.action, (t) => {
      const now = new Date().toISOString();
      if (ended(t) && x.action !== "reopen")
        throw new Error("再開操作が必要です");
      switch (x.action) {
        case "start":
          if (t.state === "work_done")
            throw new Error("作業を再開してください");
          t.state = "active";
          t.lastActedAt = now;
          t.deferUntil = null;
          break;
        case "pause":
          t.state = "paused";
          t.resume = x.memo || `次は「${t.next}」。終了条件：${t.stepDone}`;
          t.deferUntil = new Date(Date.now() + 30 * 60000).toISOString();
          break;
        case "step_done":
          t.state = "ready";
          t.resume =
            x.memo ||
            "前の一手は本人が終了を確認。次に必要な条件を一つ確認する";
          t.next = "残っている作業を一つ確認し、次の一手を決める";
          t.stepDone = "次にすることが1行残っている";
          t.deferUntil = new Date(Date.now() + 30 * 60000).toISOString();
          break;
        case "work_done":
          t.state = t.needsSubmission ? "work_done" : "closed";
          t.next = "提出完了画面を開き、提出状況を確認する";
          t.stepDone = "本人が提出完了の表示を確認した";
          t.notificationRevision++;
          break;
        case "submit":
          if (!x.ack || t.state !== "work_done" || !t.needsSubmission)
            throw new Error("作業全体の終了後、本人による提出確認が必要です");
          t.submittedAt = now;
          t.state = "closed";
          t.notificationRevision++;
          break;
        case "reopen":
          t.state = "ready";
          t.submittedAt = null;
          t.deferUntil = null;
          t.notificationRevision++;
          break;
        case "cancel":
          if (!x.ack) throw new Error("取消の確認が必要です");
          t.state = "cancelled";
          t.notificationRevision++;
          break;
        case "smaller":
          if (x.reason === "energy")
            throw new Error("時間を変える操作で着手予定を変更してください");
          if (x.reason === "purpose") {
            t.next = "この課題の目的と、続けるかを自分で確認する";
            t.stepDone = "続ける理由か確認先が1行残っている";
          } else {
            t.next =
              x.reason === "large"
                ? "作業ページを開き、最初の見出しを一つ読む"
                : "課題条件を一つ確認する";
            t.stepDone = "確認したことが1行残っている";
          }
          break;
      }
    });
    if (
      ["pause", "step_done", "work_done", "submit", "cancel"].includes(x.action)
    )
      store.set("selectedTask", "");
    return t;
  });
  app.post<{ Params: { id: string } }>("/api/tasks/:id/suggest", async (req) =>
    suggest(store, store.task(req.params.id)),
  );
  app.get("/api/settings", async () => ({
    preferences: store.prefs(),
    workerHeartbeat: store.get("workerHeartbeat", null),
    google: {
      configured: new Google(store).configured(),
      connected: !!store.get("googleToken", ""),
      calendarId: store.get("calendarId", ""),
    },
    ai: aiConfiguration(),
    push: {
      configured: !!(
        process.env.VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY &&
        process.env.VAPID_SUBJECT
      ),
      publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
      subscriptions: store.db
        .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE active=1")
        .get()!.n,
    },
    jobs: store.db
      .prepare(
        "SELECT id,kind,due,status,error,accepted_at,opened_at FROM jobs ORDER BY due DESC LIMIT 30",
      )
      .all(),
    sync: store.db.prepare("SELECT task_id,status,error FROM sync").all(),
    weeklyCheckedAt: store.get("weeklyCheckedAt", null),
  }));
  app.post("/api/settings", async (req) => {
    const p = preferencesSchema.parse(req.body);
    store.transaction(() => {
      store.set("preferences", p);
      store.set("preferencesRevision", store.get("preferencesRevision", 0) + 1);
      store.db
        .prepare(
          "UPDATE jobs SET status='cancelled' WHERE status IN ('pending','sending')",
        )
        .run();
      for (const t of store.list()) {
        t.notificationRevision++;
        t.revision++;
        store.db
          .prepare("UPDATE tasks SET data=?,version=? WHERE id=?")
          .run(JSON.stringify(t), t.revision, t.id);
      }
    });
    schedule(store);
    return { ok: true };
  });
  app.post("/api/weekly-check", async () => {
    store.set("weeklyCheckedAt", new Date().toISOString());
    store.history(
      null,
      "weekly_self_check",
      null,
      "本人が大学の課題一覧と照合したと記録",
    );
    return { ok: true };
  });
  app.post("/api/push/subscribe", async (req) => {
    const s = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({
          p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
          auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}$/),
        }),
      })
      .parse(req.body);
    const u = new URL(s.endpoint);
    if (
      u.protocol !== "https:" ||
      u.port ||
      u.username ||
      u.password ||
      ![
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].some((h) => u.hostname === h || u.hostname.endsWith("." + h))
    )
      throw new Error("対応するPushサービスではありません");
    const id = createHash("sha256").update(s.endpoint).digest("hex");
    store.db
      .prepare(
        "INSERT INTO subscriptions VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=1",
      )
      .run(id, JSON.stringify(s));
    return { ok: true };
  });
  app.post("/api/push/test", async () => {
    enqueue(
      store,
      `test:${randomBytes(8).toString("hex")}`,
      "test",
      Date.now(),
    );
    return { ok: true };
  });
  app.post("/api/push/opened", async (req) => {
    const { id } = z.object({ id: z.string().max(200) }).parse(req.body);
    store.db
      .prepare("UPDATE jobs SET opened_at=? WHERE id=?")
      .run(Date.now(), id);
    return { ok: true };
  });
  app.post("/api/google/connect", async () => {
    const g = new Google(store);
    if (!g.configured()) throw new Error("Google設定が必要です");
    const state = randomBytes(32).toString("hex");
    store.set("oauthState", { state, expires: Date.now() + 600000 });
    return {
      url:
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          redirect_uri: `${origin}/api/google/callback`,
          response_type: "code",
          scope:
            "https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/calendar.calendarlist.readonly",
          access_type: "offline",
          prompt: "consent",
          state,
        }),
    };
  });
  app.get("/api/google/callback", async (req, reply) => {
    const x = z
      .object({ code: z.string(), state: z.string() })
      .parse(req.query);
    const pending = store.get("oauthState", { state: "", expires: 0 });
    store.set("oauthState", { state: "", expires: 0 });
    if (x.state !== pending.state || pending.expires < Date.now())
      throw new Error("認可をやり直してください");
    await new Google(store).exchange(x.code, `${origin}/api/google/callback`);
    return reply.redirect("/?view=settings");
  });
  app.post("/api/google/calendar", async (req) => {
    const x = z
      .object({
        create: z.boolean(),
        id: z.string().optional(),
        ack: z.literal(true),
      })
      .parse(req.body);
    if (store.get("calendarId", ""))
      throw new Error("同期先は設定済みです。変更には移行が必要です");
    const g = new Google(store);
    const id = x.create
      ? await g.createCalendar()
      : await g.selectCalendar(z.string().min(1).parse(x.id));
    store.set("calendarId", id);
    return { ok: true };
  });
  app.post("/api/google/retry", async () => {
    store.db
      .prepare("UPDATE sync SET status='pending',attempts=0,next_try=0")
      .run();
    return { ok: true };
  });
  if (existsSync(resolve("dist/index.html"))) {
    await app.register(serveStatic, { root: resolve("dist") });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "見つかりません" })
        : reply.sendFile("index.html"),
    );
  }
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const app = await buildApp();
  await app.listen({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "127.0.0.1",
  });
  console.log("task-control起動");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
}
