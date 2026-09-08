import { z } from "zod";
import { DateTime } from "luxon";
export const text = z.string().trim().max(10000);
export const safeUrl = z.union([
  z.literal(""),
  z
    .string()
    .max(2048)
    .url()
    .refine((s) => {
      const u = new URL(s);
      return (
        ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      );
    }, "http/httpsのURLを指定してください"),
]);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => DateTime.fromISO(s).isValid, "日付が不正です");
export const deadlineSchema = z
  .object({
    kind: z.enum(["unknown", "none", "date", "datetime"]),
    date: date.nullable().default(null),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .default(null),
    zone: z.string().max(100).nullable().default(null),
    confirmed: z.boolean().default(false),
    evidence: text.default(""),
    uncertainty: z.array(z.string().max(200)).max(10).default([]),
  })
  .superRefine((d, ctx) => {
    if (["date", "datetime"].includes(d.kind) && !d.date)
      ctx.addIssue({ code: "custom", message: "年月日を確認してください" });
    if (d.kind !== "datetime" && (d.time || d.zone))
      ctx.addIssue({
        code: "custom",
        message: "日付だけの期限に時刻は保存できません",
      });
    if (
      d.kind === "datetime" &&
      (!d.time ||
        !d.zone ||
        !DateTime.fromISO(`${d.date}T${d.time}`, { zone: d.zone ?? "" })
          .isValid)
    )
      ctx.addIssue({
        code: "custom",
        message: "時刻とタイムゾーンを確認してください",
      });
    if (d.kind === "datetime" && d.date && d.time && d.zone) {
      const dt = DateTime.fromISO(`${d.date}T${d.time}`, { zone: d.zone });
      if (
        dt.isValid &&
        (dt.toFormat("yyyy-MM-dd'T'HH:mm") !== `${d.date}T${d.time}` ||
          dt.getPossibleOffsets().length !== 1)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "夏時間の切替で曖昧・存在しない時刻です。根拠のUTCオフセットを確認してください",
        });
    }
    if (["unknown", "none"].includes(d.kind) && d.date)
      ctx.addIssue({
        code: "custom",
        message: "期限の種類と日付が矛盾しています",
      });
    if (d.confirmed && (d.kind === "unknown" || !d.evidence))
      ctx.addIssue({ code: "custom", message: "期限の根拠を確認してください" });
  });
export type Deadline = z.infer<typeof deadlineSchema>;
export interface Task {
  id: string;
  title: string;
  original: string;
  sourceUrl: string;
  deadline: Deadline;
  deadlineConfirmedAt: string | null;
  planAt: string | null;
  startPlan?: {
    durationMinutes: number;
    action?: string;
    origin: "automatic" | "requested" | "manual";
    reason: string;
  };
  intake?: {
    version: 1;
    mode: "direct" | "source";
    receivedAt: string;
    referenceAt: string | null;
    zone: string;
    deadlineText: string;
    startText: string;
    notes: string[];
  };
  next: string;
  stepDone: string;
  totalDone: string;
  workUrl: string;
  resume: string;
  state: "ready" | "active" | "paused" | "work_done" | "closed" | "cancelled";
  needsSubmission: boolean;
  submittedAt: string | null;
  importance: "normal" | "high";
  estimate: number | null;
  createdAt: string;
  lastActedAt: string | null;
  deferUntil: string | null;
  revision: number;
  notificationRevision: number;
  deadlineRevision: number;
}
export const createSchema = z
  .object({
    title: z.string().trim().max(200).default(""),
    original: text.default(""),
    sourceUrl: safeUrl.default(""),
  })
  .refine((x) => x.title || x.original, "タイトルか案内文を入力してください");
export const editSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    workUrl: safeUrl.optional(),
    sourceUrl: safeUrl.optional(),
    next: text.optional(),
    stepDone: text.optional(),
    totalDone: text.optional(),
    needsSubmission: z.boolean().optional(),
    importance: z.enum(["normal", "high"]).optional(),
    estimate: z.number().int().min(1).max(10000).nullable().optional(),
  })
  .strict();
export const iso = z.string().datetime({ offset: true });
export const preferencesSchema = z.object({
  zone: z
    .string()
    .refine((s) => DateTime.now().setZone(s).isValid)
    .default("Asia/Tokyo"),
  dailyTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .default(null),
  weeklyTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .default(null),
  weeklyDay: z.number().int().min(1).max(7).default(7),
  deadlineTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .default(null),
  planNotify: z.boolean().default(false),
  aiEnabled: z.boolean().default(false),
});
export function extract(original: string): Deadline {
  const uncertainty: string[] = [];
  const match = original.match(/(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})日?/);
  if (/明日|明後日|今日|来週/.test(original))
    uncertainty.push("案内の発信日と基準日時を確認する");
  if (match) {
    if (!match[1]) uncertainty.push("期限の年を確認する");
    uncertainty.push("提出時刻とタイムゾーンを確認する");
  }
  const candidate = match?.[1]
    ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
    : null;
  return deadlineSchema.parse({
    kind: candidate && DateTime.fromISO(candidate).isValid ? "date" : "unknown",
    date: candidate && DateTime.fromISO(candidate).isValid ? candidate : null,
    evidence: match
      ? (original.split("\n").find((l) => l.includes(match[0])) ?? match[0])
      : "",
    uncertainty: uncertainty.length
      ? uncertainty
      : ["提出期限の根拠を確認する"],
  });
}
export function deadlineLabel(d: Deadline) {
  if (d.kind === "none")
    return d.confirmed ? "期限なし（本人確認済み）" : "期限なしの候補";
  if (d.kind === "unknown") return "期限未確認";
  return `${d.date}${d.kind === "datetime" ? ` ${d.time} (${d.zone})` : "・時刻未確認"}${d.confirmed ? "・本人確認済み" : "・未確認の候補"}`;
}
export function ended(t: Task) {
  return t.state === "closed" || t.state === "cancelled";
}
export function dueMillis(d: Deadline) {
  return d.kind === "datetime" && d.confirmed
    ? DateTime.fromISO(`${d.date}T${d.time}`, { zone: d.zone! }).toMillis()
    : null;
}
export function choose(
  tasks: Task[],
  now = Date.now(),
  selected?: string,
  zone = "Asia/Tokyo",
) {
  const active = tasks.filter((t) => !ended(t));
  const chosen = active.find((t) => t.id === selected);
  const ranked = active
    .filter((t) => !t.deferUntil || Date.parse(t.deferUntil) <= now)
    .map((t) => {
      const day = DateTime.fromMillis(now, { zone }).toISODate()!;
      const d = t.deadline;
      const ms = dueMillis(d);
      const overdue =
        d.confirmed &&
        d.date &&
        (d.kind === "datetime" ? ms! < now : d.date < day);
      const soon =
        d.confirmed &&
        d.date &&
        (d.kind === "datetime"
          ? ms! >= now && ms! < now + 86400000
          : d.date === day);
      const score = soon
        ? 100
        : t.planAt && Date.parse(t.planAt) <= now
          ? 80
          : t.importance === "high"
            ? 60
            : overdue
              ? 50
              : !d.confirmed
                ? 40
                : t.state === "paused"
                  ? 30
                  : 20;
      return {
        task: t,
        score,
        reason: soon
          ? "確認済みの期限が近いため"
          : t.planAt && Date.parse(t.planAt) <= now
            ? "自分で決めた着手時刻になったため"
            : t.importance === "high"
              ? "重要と指定したため"
              : overdue
                ? "期限経過後の対応を確認するため"
                : !d.confirmed
                  ? "期限の不明点を先に確認するため"
                  : t.state === "paused"
                    ? "保存した再開地点から戻れるため"
                    : "次の具体的な一手があるため",
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt),
    );
  return {
    task: chosen ?? ranked[0]?.task ?? null,
    reason: chosen ? "自分で選んだ作業です" : (ranked[0]?.reason ?? ""),
    attention: active.filter(
      (t) =>
        !t.deadline.confirmed ||
        (t.deadline.date &&
          t.deadline.date <=
            DateTime.fromMillis(now, { zone }).plus({ days: 3 }).toISODate()!),
    ),
  };
}

export function smallAction(title: string) {
  if (/レポート|論文|作文/.test(title)) return "資料を1つ開く";
  if (/勉強|試験|問題|演習/.test(title)) return "問題を1問読む";
  return "課題ページを開く";
}
