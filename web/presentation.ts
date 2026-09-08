import { DateTime } from "luxon";
import type { Deadline, Task } from "../src/domain";
export async function api(path: string, body?: unknown) {
  let r: Response;
  try {
    r = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "保存できませんでした。接続を確認して、もう一度お試しください。入力した内容はこの画面に残っています。",
    );
  }
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(
      new Error(data.error || "保存できませんでした。もう一度お試しください。"),
      { status: r.status },
    );
  return data;
}
export function formatTime(value: string | number, zone = "Asia/Tokyo") {
  return (
    typeof value === "number"
      ? DateTime.fromMillis(value)
      : DateTime.fromISO(value)
  )
    .setZone(zone)
    .toFormat("yyyy/M/d HH:mm");
}
export function deadlineText(d: Deadline) {
  if (d.kind === "none")
    return d.confirmed ? "締切なし" : "締切なし・まだ未確認";
  if (d.kind === "unknown")
    return d.evidence ? "締切はまだ未確認" : "締切はまだ未入力";
  const day = DateTime.fromISO(d.date!)
    .setLocale("ja")
    .toFormat("M月d日（ccc）");
  return `${day}${d.kind === "datetime" ? ` ${d.time}（${d.zone}）` : "・時間は未定"}${d.confirmed ? "" : "・まだ未確認"}`;
}
const legacySteps = new Set([
  "提出期限の根拠を確認する",
  "期限の年を確認する",
  "提出時刻とタイムゾーンを確認する",
  "案内の発信日と基準日時を確認する",
  "提出時刻を確認する",
]);
export function nextText(t: Task) {
  if (legacySteps.has(t.next) || !t.next)
    return "課題の内容を読んで、最初にすることを決める";
  if (t.next === "残っている作業を一つ確認し、次の一手を決める")
    return "残りの作業から、次にすることをひとつ決める";
  return t.next;
}
export function stepText(t: Task) {
  if (legacySteps.has(t.next))
    return "まず何をするか、ひとつ分かれば十分です。";
  return t.stepDone || "できるところまで進めたら、続きのメモを残せます。";
}
export function reasonText(reason: string) {
  const map: Record<string, string> = {
    期限の不明点を先に確認するため:
      "締切がまだ分からない課題です。作業は先に始められます。",
    確認済みの期限が近いため: "締切が近づいています。",
    自分で決めた着手時刻になったため: "取り組む予定の時間になりました。",
    重要と指定したため: "大切な課題に指定しています。",
    期限経過後の対応を確認するため:
      "締切を過ぎています。提出できるか、案内を見てみましょう。",
    保存した再開地点から戻れるため: "前回の続きから始められます。",
    自分で選んだ作業です: "自分で選んだ課題です。",
    次の具体的な一手があるため: "まずは、この課題から。",
  };
  return map[reason] || reason;
}
export const stateText: Record<Task["state"], string> = {
  ready: "これから",
  active: "取り組み中",
  paused: "途中で休憩中",
  work_done: "あとは提出",
  closed: "完了",
  cancelled: "取りやめ",
};
export const jobStates: Record<string, string> = {
  pending: "通知の予定あり",
  sending: "送信中",
  accepted: "送信しました（端末への到着は不明）",
  cancelled: "取り消しました",
  expired: "時間が過ぎたため通知を省略",
  failed: "送信できませんでした",
};
export const historyText: Record<string, string> = {
  created: "課題を追加",
  edited: "課題の情報を変更",
  deadline_confirmed: "締切を保存",
  planned: "取り組む予定を変更",
  start: "作業を開始",
  pause: "続きのメモを保存",
  step_done: "ひと区切りを記録",
  work_done: "作業を終了",
  submit: "提出したことを確認",
  reopen: "完了を取り消し",
  cancel: "取りやめ",
  smaller: "最初の作業を小さく変更",
};
