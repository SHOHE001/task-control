import { useState } from "react";
import { api, formatTime, jobStates } from "./presentation";
export function Settings({
  data,
  busy,
  run,
  refresh,
}: {
  data: any;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [ai, setAi] = useState(data.preferences.aiEnabled);
  return (
    <>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(async () => {
            await api("/settings", {
              zone: f.get("zone"),
              dailyTime: f.get("dailyTime") || null,
              weeklyTime: f.get("weeklyTime") || null,
              weeklyDay: Number(f.get("weeklyDay")),
              deadlineTime: f.get("deadlineTime") || null,
              planNotify: f.has("planNotify"),
              aiEnabled: ai,
            });
            await refresh();
          });
        }}
      >
        <h2>通知のタイミング</h2>
        <p className="muted">
          通知がほしい時間だけ設定してください。空欄なら通知しません。
        </p>
        <label>
          日付と通知に使う地域
          <input name="zone" defaultValue={data.preferences.zone} required />
        </label>
        <label className="check">
          <input
            name="planNotify"
            type="checkbox"
            defaultChecked={data.preferences.planNotify}
          />
          取り組む予定の時間に通知
        </label>
        <label>
          一日の確認
          <input
            name="dailyTime"
            type="time"
            defaultValue={data.preferences.dailyTime ?? ""}
          />
        </label>
        <label>
          大学の課題一覧を見直す曜日
          <select name="weeklyDay" defaultValue={data.preferences.weeklyDay}>
            {["月", "火", "水", "木", "金", "土", "日"].map((d, i) => (
              <option key={d} value={i + 1}>
                {d}曜日
              </option>
            ))}
          </select>
        </label>
        <label>
          見直す時間
          <input
            name="weeklyTime"
            type="time"
            defaultValue={data.preferences.weeklyTime ?? ""}
          />
        </label>
        <label>
          締切の前日に知らせる時間
          <input
            name="deadlineTime"
            type="time"
            defaultValue={data.preferences.deadlineTime ?? ""}
          />
        </label>
        <p className="muted">
          この時刻は自分の確認予定です。実際の提出時刻とは別です。
        </p>
        <h2>外部AIの補助</h2>
        <p>
          {data.ai.configured
            ? `設定先：${data.ai.endpoint}`
            : "使わなくても、課題の追加や作業はできます。"}
        </p>
        <p>
          有効にして候補ボタンを押すと、タイトル・案内原文・次の一手・再開メモを設定先へ送ります。契約と費用条件は接続先で確認してください。
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={ai}
            onChange={(e) => setAi(e.target.checked)}
            disabled={!data.ai.configured && !ai}
          />
          送信内容を理解し、外部AI補助を有効にする
        </label>
        <button disabled={busy}>設定を保存</button>
      </form>
      <details className="panel settings-group">
        <summary>端末への通知</summary>
        <p>
          {data.push.configured
            ? "配信設定あり"
            : "配信設定不足：VAPIDの設定が必要です"}
        </p>
        <p>
          端末の許可：
          {typeof Notification === "undefined"
            ? "この環境では非対応"
            : Notification.permission === "granted"
              ? "許可済み"
              : Notification.permission === "denied"
                ? "拒否されています。端末設定で変更できます。"
                : "未許可"}
        </p>
        <p>
          購読端末：{data.push.subscriptions} ／ worker：
          {data.workerHeartbeat && Date.now() - data.workerHeartbeat < 120000
            ? "稼働を確認"
            : "稼働未確認・起動状態を確認してください"}
        </p>
        <p className="muted">
          iPhoneはホーム画面へ追加し、そこから開いて許可します。通知本文には課題名や原文を出しません。
        </p>
        <div className="actions">
          <button
            disabled={busy || !data.push.configured}
            onClick={() =>
              void run(async () => {
                if (
                  !("serviceWorker" in navigator) ||
                  !("PushManager" in window) ||
                  typeof Notification === "undefined"
                )
                  throw new Error("この環境はWeb Pushに対応していません");
                const permission = await Notification.requestPermission();
                if (permission !== "granted")
                  throw new Error("通知は許可されていません");
                const reg = await navigator.serviceWorker.ready;
                const key = Uint8Array.from(
                  atob(
                    data.push.publicKey.replace(/-/g, "+").replace(/_/g, "/"),
                  ),
                  (c) => c.charCodeAt(0),
                );
                const subscription =
                  (await reg.pushManager.getSubscription()) ??
                  (await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: key,
                  }));
                await api("/push/subscribe", subscription.toJSON());
                await refresh();
              })
            }
          >
            この端末で通知を許可
          </button>
          <button
            className="secondary"
            disabled={busy || !data.push.subscriptions || !data.push.configured}
            onClick={() =>
              void run(async () => {
                await api("/push/test", {});
                await refresh();
              })
            }
          >
            テスト通知を予約
          </button>
        </div>
        <p className="muted">
          送信要求の受理は、端末への到達や本人の確認を意味しません。
        </p>
      </details>
      <details className="panel settings-group">
        <summary>Googleカレンダー</summary>
        <p>
          {data.google.connected
            ? "Google認可済み"
            : data.google.configured
              ? "認可待ち"
              : "未接続。課題の追加や作業は、このまま使えます"}
        </p>
        <p>専用カレンダー：{data.google.calendarId || "未指定"}</p>
        <p className="muted">
          確認した期限だけを一方向に反映します。原文は送りません。時刻未確認は終日予定です。
        </p>
        {!data.google.connected && (
          <button
            disabled={busy || !data.google.configured}
            onClick={() =>
              void run(async () => {
                const r = await api("/google/connect", {});
                location.href = r.url;
              })
            }
          >
            Googleの接続を設定
          </button>
        )}
        {data.google.connected && !data.google.calendarId && (
          <>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Googleに専用のtask-controlカレンダーを新規作成しますか？",
                  )
                )
                  void run(async () => {
                    await api("/google/calendar", { create: true, ack: true });
                    await refresh();
                  });
              }}
            >
              専用カレンダーを新規作成
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const id = new FormData(e.currentTarget).get("calendarId");
                void run(async () => {
                  await api("/google/calendar", {
                    create: false,
                    id,
                    ack: true,
                  });
                  await refresh();
                });
              }}
            >
              <label>
                既存の専用カレンダーID
                <input name="calendarId" required />
              </label>
              <label className="check">
                <input type="checkbox" required />
                メイン以外の専用カレンダーを同期先に指定する
              </label>
              <button className="secondary" disabled={busy}>
                この同期先を指定
              </button>
            </form>
          </>
        )}
        {data.google.calendarId && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("/google/retry", {});
                await refresh();
              })
            }
          >
            失敗した同期を再試行
          </button>
        )}
        {data.sync
          .filter((s: any) => s.status === "failed")
          .map((s: any) => (
            <p className="error" key={s.task_id}>
              {s.error}
            </p>
          ))}
      </details>
      <details className="panel settings-group">
        <summary>通知の予定と履歴</summary>
        {data.jobs.length === 0 ? (
          <p>まだ通知予定はありません。</p>
        ) : (
          data.jobs.map((j: any) => (
            <div className="history" key={j.id}>
              <p>
                {
                  (
                    {
                      plan: "着手",
                      daily: "一日の確認",
                      weekly: "週の照合",
                      deadline: "期限の確認",
                      test: "テスト",
                    } as any
                  )[j.kind]
                }{" "}
                · {formatTime(j.due, data.preferences.zone)}
              </p>
              <small>
                {jobStates[j.status]}
                {j.opened_at ? " ／ 通知リンクからアプリを開いた記録あり" : ""}
              </small>
              {j.error && <p>{j.error}</p>}
            </div>
          ))
        )}
      </details>
    </>
  );
}
