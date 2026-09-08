import { DateTime } from "luxon";
import { z } from "zod";
import { extract, iso, smallAction, type Task } from "./domain.ts";
import type { Store } from "./db.ts";

// A source adapter passes verbatim text and an explicit source timestamp when known.
// Direct input uses receipt time; copied source text must opt into source mode.
export const intakeSchema = z
  .object({
    text: z.string().trim().min(1).max(10000),
    mode: z.enum(["direct", "source"]).default("direct"),
    referenceAt: iso.optional(),
  })
  .strict();
const dateToken =
  /(?:(?:\d{4})[年/-])?\d{1,2}[月/-]\d{1,2}日?|明後日|明日|今日|(?:今週|来週)?[月火水木金土日]曜(?:日)?/;
const workWords = /やる|取り組|着手|始め|作業|少し|分(?:間)?|勉強したい/;
const deadlineWords = /まで|締切|期限|提出|試験/;

function localSlot(day: DateTime, hour: number, minute: number) {
  const dt = day.set({ hour, minute, second: 0, millisecond: 0 });
  return dt.isValid &&
    dt.hour === hour &&
    dt.minute === minute &&
    dt.getPossibleOffsets().length === 1
    ? dt
    : null;
}
export function defaultPlan(t: Task, now: number, zone: string) {
  const today = DateTime.fromMillis(now, { zone });
  if (t.deadline.confirmed && t.deadline.date) {
    for (const days of [7, 3, 1, 0]) {
      const slot = localSlot(
        DateTime.fromISO(t.deadline.date, { zone }).minus({ days }),
        18,
        0,
      );
      const limit =
        t.deadline.kind === "datetime"
          ? DateTime.fromISO(`${t.deadline.date}T${t.deadline.time}`, {
              zone: t.deadline.zone!,
            }).toMillis()
          : Infinity;
      if (slot && slot.toMillis() > now && slot.toMillis() < limit)
        return {
          at: slot.toISO()!,
          reason: `確認済み締切の${days}日前・18時の自動予定`,
        };
    }
    return {
      at: null,
      reason: "締切までに未来の自動枠がありません。取り組む時間を選べます。",
    };
  }
  const slot = localSlot(today.plus({ days: 1 }), 18, 0);
  return {
    at: slot?.toISO() ?? null,
    reason: "締切とは別に、翌日18時に20分の仮予定を作成",
  };
}

function explicitPlan(clause: string, base: DateTime | null, now: number) {
  const notes: string[] = [];
  const durationMatch = clause.match(/(?<![\d時:])(\d+)分(?:間)?/);
  const duration = durationMatch ? Number(durationMatch[1]) : 20;
  if (duration < 1 || duration > 180)
    return {
      at: null,
      duration: 20,
      notes: ["着手時間は1〜180分で指定してください。予定は未作成です。"],
    };
  if (!base)
    return {
      at: null,
      duration,
      notes: ["元情報の基準日時が不明なため、着手予定は未作成です。"],
    };
  let day: DateTime | null = null;
  const absolute = clause.match(
    /(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})日?/,
  );
  if (absolute) {
    if (!absolute[1])
      return {
        at: null,
        duration,
        notes: [
          "着手予定の日付に年がありません。年を含む日時を選んでください。",
        ],
      };
    day = DateTime.fromISO(
      `${absolute[1]}-${absolute[2].padStart(2, "0")}-${absolute[3].padStart(2, "0")}`,
      { zone: base.zoneName! },
    );
  } else if (/明後日/.test(clause)) day = base.plus({ days: 2 });
  else if (/明日/.test(clause)) day = base.plus({ days: 1 });
  else if (/今日/.test(clause)) day = base;
  else if (/[月火水木金土日]曜/.test(clause)) {
    const target =
      "月火水木金土日".indexOf(clause.match(/([月火水木金土日])曜/)![1]) + 1;
    let delta = target - base.weekday;
    if (/来週/.test(clause)) delta += 7;
    else if (delta < 0 && !/今週/.test(clause)) delta += 7;
    day = base.plus({ days: delta });
  } else if (/今週/.test(clause)) {
    day = base;
    if (base.hour >= 18) day = base.plus({ days: 1 });
    if (day.weekNumber !== base.weekNumber || day.weekYear !== base.weekYear)
      return {
        at: null,
        duration,
        notes: [
          "今週の18時の枠が残っていません。取り組む時間を選んでください。",
        ],
      };
    notes.push(
      "今週の希望から、最初の18時を自動選択しました。空き時間の照合はしていません。",
    );
  }
  if (!day)
    return {
      at: null,
      duration,
      notes: ["着手希望を日時にできませんでした。予定だけ後から選べます。"],
    };
  const clock = clause.match(
    /(\d{1,2})(?:時(?:([0-9]{1,2})分?|半)?|:([0-9]{2}))/,
  );
  let hour = clock ? Number(clock[1]) : /朝/.test(clause) ? 9 : 18;
  const minute = clock
    ? Number(clock[2] ?? clock[3] ?? (clock[0].endsWith("半") ? 30 : 0))
    : 0;
  if (/午後/.test(clause) && hour < 12) hour += 12;
  if (/午前/.test(clause) && hour === 12) hour = 0;
  if (!clock)
    notes.push(
      `時刻が未指定のため${hour}時を自動選択しました。締切時刻ではありません。`,
    );
  const slot = hour <= 23 && minute <= 59 ? localSlot(day, hour, minute) : null;
  if (!slot || slot.toMillis() <= now)
    return {
      at: null,
      duration,
      notes: ["希望日時が過去・無効・夏時間で曖昧なため、予定は未作成です。"],
    };
  return { at: slot.toISO(), duration, notes };
}

export function intake(store: Store, input: unknown, now = Date.now()) {
  const x = intakeSchema.parse(input);
  const zone = store.prefs().zone;
  const receivedAt = new Date(now).toISOString();
  const referenceAt =
    x.referenceAt ?? (x.mode === "direct" ? receivedAt : null);
  const base = referenceAt ? DateTime.fromISO(referenceAt).setZone(zone) : null;
  const clauses = x.text
    .split(/[。\n！!；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const workClauses = clauses.filter(
    (s) =>
      workWords.test(s) &&
      /明日|明後日|今日|今週|来週|曜|\d+時|\d+:\d+|\d+分|\d+[月/-]\d+/.test(
        s,
      ) &&
      !deadlineWords.test(s),
  );
  const work = workClauses.join("。");
  const deadlineClauses = clauses.filter(
    (s) =>
      !workClauses.includes(s) && (deadlineWords.test(s) || dateToken.test(s)),
  );
  const deadlineText = deadlineClauses.join("。");
  const deadline = extract(deadlineText);
  // Multiple date mentions never silently collapse into one confirmed/candidate date.
  if (
    (deadlineText.match(new RegExp(dateToken.source, "g")) ?? []).length > 1
  ) {
    deadline.kind = "unknown";
    deadline.date = null;
    deadline.uncertainty = ["日付が複数あります。締切を選んでください。"];
  }
  if (deadlineText && !deadline.evidence) deadline.evidence = deadlineText;
  let title =
    clauses.find(
      (s) =>
        !workClauses.includes(s) &&
        !/^(?:締切|期限|試験)\s*[:：]?\s*\d/.test(s),
    ) ?? clauses[0];
  title = title
    .replace(
      new RegExp(
        `^(?:締切[：:]?\\s*)?(?:${dateToken.source})\\s*まで(?:に)?\\s*`,
      ),
      "",
    )
    .replace(
      new RegExp(
        `(?:[、,\\s]*(?:締切|期限|提出|試験)[：:]?\\s*)?${dateToken.source}\\s*(?:まで(?:に)?|が締切|提出期限)?$`,
      ),
      "",
    )
    .replace(/^[、,\s]+|[、,\s]+$/g, "");
  title = (title || clauses[0]).slice(0, 200);
  const requested = work ? explicitPlan(work, base, now) : null;
  if (
    workClauses.length > 1 ||
    (work.match(new RegExp(dateToken.source, "g")) ?? []).length > 1
  ) {
    if (requested) {
      requested.at = null;
      requested.notes = [
        "着手希望が複数あります。最初の予定を選んでください。",
      ];
    }
  }
  const task = store.create({ title, original: x.text }, (t) => {
    t.deadline = deadline;
    t.next = smallAction(title);
    t.stepDone = "最初の行動をひとつ試せたら十分です";
    const automatic = defaultPlan(t, now, zone);
    t.planAt = requested ? requested.at : automatic.at;
    t.startPlan = {
      durationMinutes: requested?.duration ?? 20,
      action: t.next,
      origin: requested ? "requested" : "automatic",
      reason: requested ? "入力された着手希望を優先" : automatic.reason,
    };
    t.intake = {
      version: 1,
      mode: x.mode,
      receivedAt,
      referenceAt,
      zone,
      deadlineText,
      startText: work,
      notes: requested?.notes ?? [automatic.reason],
    };
  });
  return intakeResult(task);
}
export function intakeResult(task: Task) {
  return {
    task,
    deadlineCandidate: {
      ...task.deadline,
      raw: task.intake?.deadlineText ?? task.deadline.evidence,
    },
    startPlan: { value: task.planAt, action: task.next, ...task.startPlan },
    needsConfirmation: !!task.intake?.deadlineText && !task.deadline.confirmed,
    notes: task.intake?.notes ?? [],
  };
}
