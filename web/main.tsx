import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { DateTime } from "luxon";
import { deadlineLabel, type Task } from "../src/domain";
import "./style.css";
async function api(path: string, body?: unknown) {
  let r: Response;
  try {
    r = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "通信できませんでした。変更は保存されていません。接続後にもう一度お試しください。",
    );
  }
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error || "保存できませんでした"), {
      status: r.status,
    });
  return data;
}
type View = "home" | "inbox" | "list" | "detail" | "settings";
const states: Record<string, string> = {
  ready: "次の一手あり",
  active: "開始を記録",
  paused: "再開できます",
  work_done: "作業終了・提出未確認",
  closed: "完了",
  cancelled: "本人が取消",
};
const jobStates: Record<string, string> = {
  pending: "予定あり",
  sending: "送信処理中",
  accepted: "送信要求受理・到達不明",
  cancelled: "無効化済み",
  expired: "古い通知を省略",
  failed: "送信失敗",
};
function formatTime(value: string | number, zone = "Asia/Tokyo") {
  return (
    typeof value === "number"
      ? DateTime.fromMillis(value)
      : DateTime.fromISO(value)
  )
    .setZone(zone)
    .toFormat("yyyy/MM/dd HH:mm");
}
function App() {
  const [view, setView] = useState<View>(
    (new URLSearchParams(location.search).get("view") as View) || "home",
  );
  const [logged, setLogged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [home, setHome] = useState<any>({});
  const [detail, setDetail] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [shrink, setShrink] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [suggestion, setSuggestion] = useState<any>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);
  async function refresh() {
    const [ts, h, s] = await Promise.all([
      api("/tasks"),
      api("/home"),
      api("/settings"),
    ]);
    setTasks(ts);
    setHome(h);
    setSettings(s);
    setLogged(true);
    if (detail) setDetail(await api("/tasks/" + detail.task.id));
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if ((e as any).status === 401) setLogged(false);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh()
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setLoading(false));
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (logged) {
      const id = new URLSearchParams(location.search).get("job");
      if (id)
        void api("/push/opened", { id })
          .then(() => history.replaceState(null, "", location.pathname))
          .catch(() => {});
    }
  }, [logged]);
  async function open(t: Task) {
    setDetail(await api("/tasks/" + t.id));
    setView("detail");
    setSuggestion(null);
    setPlanning(false);
    setShrink(false);
  }
  async function action(
    t: Task,
    act: string,
    extra: Record<string, unknown> = {},
  ) {
    await api(`/tasks/${t.id}/action`, {
      revision: t.revision,
      action: act,
      ...extra,
    });
    await refresh();
  }
  function navigate(v: View) {
    setView(v);
    setError("");
    setNotice("");
    setPlanning(false);
    setShrink(false);
    void run(refresh);
  }
  const t: Task | undefined = view === "detail" ? detail?.task : home.task;
  function Plan({ task }: { task: Task }) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const value = String(f.get("when") || "");
          void run(async () => {
            const at = value
              ? DateTime.fromISO(value, {
                  zone: settings.preferences.zone,
                }).toISO()
              : null;
            await api(`/tasks/${task.id}/plan`, {
              revision: task.revision,
              planAt: at,
            });
            await refresh();
            setPlanning(false);
            setNotice("着手予定を保存しました。提出期限は変わりません。");
          });
        }}
      >
        <h3>取り組む時間を変える</h3>
        <p>提出期限とは別の、自分の予定です。</p>
        <label>
          着手予定（{settings.preferences.zone}）
          <input
            name="when"
            type="datetime-local"
            defaultValue={
              task.planAt
                ? DateTime.fromISO(task.planAt)
                    .setZone(settings.preferences.zone)
                    .toFormat("yyyy-MM-dd'T'HH:mm")
                : ""
            }
          />
        </label>
        <div className="actions">
          <button disabled={busy}>予定を保存</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setPlanning(false)}
          >
            閉じる
          </button>
        </div>
      </form>
    );
  }
  function ActionCard({ task, reason }: { task: Task; reason?: string }) {
    return (
      <section className="action-card" data-testid="main-action">
        <div className="eyebrow">
          {task.resume ? "ここから再開" : "小さな一歩から"}
        </div>
        <p className="task-name">{task.title}</p>
        <h2>
          {task.state === "work_done"
            ? "提出完了画面を開き、提出状況を確認する"
            : task.next}
        </h2>
        {task.resume && (
          <div className="resume">
            <span>前回の再開メモ</span>
            <p>{task.resume}</p>
          </div>
        )}
        <div className="finish">
          <span>今回、ここまでできれば</span>
          <p>{task.stepDone || "一つ確認できたら、次の一手を決める"}</p>
        </div>
        <p className="deadline">{deadlineLabel(task.deadline)}</p>
        {task.estimate && <p>今回の目安：{task.estimate}分（本人の設定）</p>}
        {reason && <p className="reason">{reason}</p>}
        <div className="actions">
          <button
            disabled={busy}
            onClick={() => {
              if (task.state === "work_done") {
                void run(() => open(task));
                return;
              }
              const url = task.workUrl || task.sourceUrl;
              const tab = url ? window.open("about:blank", "_blank") : null;
              if (tab) tab.opener = null;
              void run(async () => {
                try {
                  await action(task, "start");
                  if (tab) tab.location.href = url;
                  else if (url)
                    setNotice(
                      "開始を記録しました。下の作業ページのリンクを開いてください。",
                    );
                  await open({ ...task, revision: task.revision + 1 });
                } catch (e) {
                  tab?.close();
                  throw e;
                }
              });
            }}
          >
            {task.state === "work_done"
              ? "提出を確認する"
              : task.state === "paused"
                ? "再開する"
                : "始める"}{" "}
            <span aria-hidden>↗</span>
          </button>
          <button
            disabled={busy}
            className="secondary"
            onClick={() => {
              setShrink(!shrink);
              setPlanning(false);
            }}
          >
            もっと小さくする
          </button>
          <button
            className="quiet"
            onClick={() => {
              setPlanning(!planning);
              setShrink(false);
            }}
          >
            時間を変える
          </button>
        </div>
        {(task.workUrl || task.sourceUrl) && (
          <a
            className="work-link"
            href={task.workUrl || task.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            作業ページを開く ↗
          </a>
        )}
        {shrink && (
          <div className="choices">
            <p>今、引っかかっていること</p>
            {[
              ["unclear", "何をすればよいか分からない"],
              ["large", "作業が大きすぎる"],
              ["energy", "今は時間や体力がない"],
              ["purpose", "必要性に納得できない"],
            ].map(([reason, label]) => (
              <button
                key={reason}
                disabled={busy}
                className="secondary"
                onClick={() => {
                  if (reason === "energy") {
                    setPlanning(true);
                    setShrink(false);
                  } else
                    void run(async () => {
                      await action(task, "smaller", { reason });
                      setShrink(false);
                    });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {planning && Plan({ task })}
      </section>
    );
  }
  if (loading)
    return (
      <main>
        <p>保存した情報を読み込んでいます…</p>
      </main>
    );
  return (
    <>
      <header>
        <a href="/" className="brand">
          <span aria-hidden>↗</span> task-control
        </a>
        {logged && (
          <button
            className="quiet"
            onClick={() =>
              void run(async () => {
                await api("/logout", {});
                setLogged(false);
                setTasks([]);
                setDetail(null);
                setHome({});
              })
            }
          >
            ログアウト
          </button>
        )}
      </header>
      <main>
        <div aria-live="polite">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <p className="notice">{notice}</p>}
        </div>
        {!logged ? (
          <section className="login">
            <div className="eyebrow">自分のペースで、ここから</div>
            <h1>今の一手へ。</h1>
            <p>期限を確かめる。少し始める。続きに戻る。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const password = new FormData(e.currentTarget).get("password");
                void run(async () => {
                  await api("/login", { password });
                  await refresh();
                });
              }}
            >
              <label>
                パスワード
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button disabled={busy}>ログイン</button>
            </form>
          </section>
        ) : (
          <>
            {view === "home" && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">一度に、ひとつで大丈夫</p>
                    <h1>今の一手</h1>
                  </div>
                  <button className="quiet" onClick={() => navigate("inbox")}>
                    ＋ 案内を登録
                  </button>
                </div>
                {t ? (
                  ActionCard({ task: t, reason: home.reason })
                ) : (
                  <section className="action-card">
                    <h2>
                      {tasks.some(
                        (t) => !["closed", "cancelled"].includes(t.state),
                      )
                        ? "予定した時間までひと休み"
                        : "案内をひとつ、ここに。"}
                    </h2>
                    <p>タイトルだけでも保存できます。整理はあとから。</p>
                    <button
                      onClick={() => navigate(tasks.length ? "list" : "inbox")}
                    >
                      {tasks.length ? "別の作業を選ぶ" : "最初の案内を登録"}
                    </button>
                  </section>
                )}
                <section className="attention">
                  <h3>期限と確認しておきたいこと</h3>
                  <p className="muted">
                    ここにあるのは、登録した情報だけです。
                  </p>
                  {home.attention?.slice(0, 3).map((x: Task) => (
                    <button
                      className="list-row"
                      key={x.id}
                      onClick={() => void run(() => open(x))}
                    >
                      <span>{x.title}</span>
                      <small>{deadlineLabel(x.deadline)}</small>
                    </button>
                  ))}
                  {home.attention?.length > 3 && (
                    <button className="quiet" onClick={() => navigate("list")}>
                      ほかの期限・未確認事項を見る
                    </button>
                  )}
                  <button className="quiet" onClick={() => navigate("list")}>
                    別の作業を選ぶ →
                  </button>
                </section>
                <section className="weekly">
                  <h3>週に一度、登録漏れを照合</h3>
                  <p>大学の課題一覧を開き、このアプリと見比べます。</p>
                  <p className="muted">
                    {home.weeklyCheckedAt
                      ? `本人が照合を記録：${formatTime(home.weeklyCheckedAt, settings.preferences.zone)}`
                      : "まだ照合の記録はありません。"}{" "}
                    {home.weeklyTime
                      ? "設定した曜日・時刻に確認します。"
                      : "確認時刻は設定から選べます。"}
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api("/weekly-check", {});
                        await refresh();
                        setNotice(
                          "本人による照合を記録しました。大学サイトをシステムが確認した記録ではありません。",
                        );
                      })
                    }
                  >
                    大学の一覧と照合した
                  </button>
                </section>
              </>
            )}
            {view === "inbox" && (
              <>
                <p className="eyebrow">まずは受け取るだけ</p>
                <h1>登録・受信箱</h1>
                <form
                  className="panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    void run(async () => {
                      const added = await api("/tasks", {
                        title: f.get("title"),
                        original: f.get("original"),
                        sourceUrl: f.get("sourceUrl"),
                      });
                      await refresh();
                      await open(added);
                    });
                  }}
                >
                  <label>
                    案内文
                    <textarea
                      name="original"
                      rows={6}
                      placeholder="案内をそのまま貼り付ける。あとで根拠を確認できます。"
                    />
                  </label>
                  <label>
                    タイトルだけでもOK
                    <input
                      name="title"
                      maxLength={200}
                      placeholder="例：演習のレポート"
                    />
                  </label>
                  <details>
                    <summary>出典のリンクを追加（任意）</summary>
                    <label>
                      出典URL
                      <input
                        name="sourceUrl"
                        type="url"
                        placeholder="https://…"
                      />
                    </label>
                  </details>
                  <button disabled={busy}>受信箱に保存</button>
                  <p className="muted">
                    原文の解析はまずアプリ内で行います。期限は確認するまで候補です。
                  </p>
                </form>
                <h2>期限の確認を待っているもの</h2>
                {tasks
                  .filter(
                    (x) =>
                      !x.deadline.confirmed &&
                      !["closed", "cancelled"].includes(x.state),
                  )
                  .map((x) => (
                    <button
                      className="list-row"
                      key={x.id}
                      onClick={() => void run(() => open(x))}
                    >
                      {x.title}
                      <small>{x.deadline.uncertainty.join("・")}</small>
                    </button>
                  ))}
              </>
            )}
            {view === "list" && (
              <>
                <p className="eyebrow">見渡したいときに</p>
                <h1>一覧・期限確認</h1>
                <p className="muted">
                  日付のみの期限には、締切時刻を補っていません。
                </p>
                {tasks.length === 0 && <p>まだ登録がありません。</p>}
                {tasks.map((x) => (
                  <section className="task-row" key={x.id}>
                    <button
                      className="list-row"
                      onClick={() => void run(() => open(x))}
                    >
                      <strong>{x.title}</strong>
                      <small>{deadlineLabel(x.deadline)}</small>
                      <small>
                        {states[x.state]}
                        {x.submittedAt ? "・提出は本人確認済み" : ""}
                      </small>
                    </button>
                    {!["closed", "cancelled"].includes(x.state) && (
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api("/select", { id: x.id });
                            await refresh();
                            setView("home");
                          })
                        }
                      >
                        今はこれをする →
                      </button>
                    )}
                  </section>
                ))}
              </>
            )}
            {view === "detail" && t && (
              <>
                <p className="eyebrow">作業の続きと、期限の根拠</p>
                <h1>{t.title}</h1>
                <p className="muted">
                  {states[t.state]}
                  {t.submittedAt
                    ? ` ／ 提出は本人の申告（${formatTime(t.submittedAt, settings.preferences.zone)}）`
                    : ""}
                </p>
                {!["closed", "cancelled"].includes(t.state) &&
                  ActionCard({ task: t })}
                <section className="panel">
                  <h2>中断・終了を記録する</h2>
                  {!["closed", "cancelled"].includes(t.state) && (
                    <>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const memo = new FormData(e.currentTarget).get(
                            "memo",
                          );
                          void run(() => action(t, "pause", { memo }));
                        }}
                      >
                        <label>
                          再開メモ（任意）
                          <textarea
                            name="memo"
                            key={`${t.id}-${t.resume}`}
                            defaultValue={t.resume}
                            placeholder={`次は「${t.next}」。終了条件：${t.stepDone}`}
                            rows={2}
                          />
                        </label>
                        <button className="secondary" disabled={busy}>
                          この地点で中断する
                        </button>
                      </form>
                      <div className="actions">
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void run(() => action(t, "step_done"))}
                        >
                          今回の一手が終わった
                        </button>
                        <button
                          className="secondary"
                          disabled={busy || t.state === "work_done"}
                          onClick={() => void run(() => action(t, "work_done"))}
                        >
                          作業全体が終わった
                        </button>
                      </div>
                    </>
                  )}
                  {t.state === "work_done" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(() => action(t, "submit", { ack: true }));
                      }}
                    >
                      <label className="check">
                        <input type="checkbox" required />
                        提出完了画面などで、提出済みであることを自分で確認した
                      </label>
                      <button disabled={busy}>本人による提出確認を記録</button>
                    </form>
                  )}
                  <details>
                    <summary>誤操作の修正・取りやめ</summary>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void run(() => action(t, "reopen"))}
                    >
                      完了・提出確認を取り消して再開
                    </button>
                    {!["closed", "cancelled"].includes(t.state) && (
                      <button
                        className="quiet"
                        onClick={() => {
                          if (
                            window.confirm(
                              "このタスクを取りやめますか？ 必須提出物かどうかは自分で確認してください。",
                            )
                          )
                            void run(() => action(t, "cancel", { ack: true }));
                        }}
                      >
                        自分の判断で取りやめる
                      </button>
                    )}
                  </details>
                </section>
                <section className="panel">
                  <h2>期限の根拠を確認</h2>
                  <blockquote>
                    {t.original || "案内原文はまだありません。"}
                  </blockquote>
                  {t.sourceUrl && (
                    <a
                      href={t.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      出典を開く ↗
                    </a>
                  )}
                  <p>{deadlineLabel(t.deadline)}</p>
                  {t.deadline.uncertainty.map((s) => (
                    <p className="muted" key={s}>
                      {s}
                    </p>
                  ))}
                  <DeadlineForm
                    key={`${t.id}-${t.revision}`}
                    task={t}
                    busy={busy}
                    save={(d) =>
                      run(async () => {
                        await api(`/tasks/${t.id}/deadline`, {
                          revision: t.revision,
                          deadline: d,
                          ack: true,
                        });
                        await refresh();
                        setNotice("期限の変更前後と確認日時を記録しました。");
                      })
                    }
                  />
                </section>
                <section className="panel">
                  <h2>作業の入口を整える</h2>
                  <form
                    key={`${t.id}-${t.revision}`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(async () => {
                        await api(`/tasks/${t.id}/edit`, {
                          revision: t.revision,
                          fields: {
                            title: f.get("title"),
                            workUrl: f.get("workUrl"),
                            sourceUrl: f.get("sourceUrl"),
                            next: f.get("next"),
                            stepDone: f.get("stepDone"),
                            totalDone: f.get("totalDone"),
                            importance: f.get("importance"),
                            estimate: f.get("estimate")
                              ? Number(f.get("estimate"))
                              : null,
                            needsSubmission: f.has("needsSubmission"),
                          },
                        });
                        await refresh();
                        setNotice("作業情報を保存しました");
                      });
                    }}
                  >
                    <label>
                      タイトル
                      <input name="title" defaultValue={t.title} required />
                    </label>
                    <label>
                      作業ページURL
                      <input
                        name="workUrl"
                        type="url"
                        defaultValue={t.workUrl}
                      />
                    </label>
                    <label>
                      次の一手
                      <input name="next" defaultValue={t.next} />
                    </label>
                    <label>
                      今回の終了条件
                      <input name="stepDone" defaultValue={t.stepDone} />
                    </label>
                    <label>
                      作業全体の完了条件
                      <input name="totalDone" defaultValue={t.totalDone} />
                    </label>
                    <details>
                      <summary>任意の補足</summary>
                      <label>
                        出典URL
                        <input
                          name="sourceUrl"
                          type="url"
                          defaultValue={t.sourceUrl}
                        />
                      </label>
                      <label>
                        重要度
                        <select name="importance" defaultValue={t.importance}>
                          <option value="normal">通常</option>
                          <option value="high">重要</option>
                        </select>
                      </label>
                      <label>
                        今回の目安時間（分・空欄は不明）
                        <input
                          name="estimate"
                          type="number"
                          min="1"
                          max="10000"
                          defaultValue={t.estimate ?? ""}
                        />
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          name="needsSubmission"
                          defaultChecked={t.needsSubmission}
                        />
                        提出が必要
                      </label>
                    </details>
                    <button disabled={busy}>作業情報を保存</button>
                  </form>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setSuggestion(await api(`/tasks/${t.id}/suggest`, {}));
                      })
                    }
                  >
                    次の一手の候補を出す
                    {settings.preferences.aiEnabled
                      ? "（外部AIへ送信）"
                      : "（テンプレート）"}
                  </button>
                  {suggestion && (
                    <div className="resume">
                      <p>
                        {suggestion.source === "ai"
                          ? "AIの候補（未採用）"
                          : "テンプレートの候補"}
                      </p>
                      <p>{suggestion.notice}</p>
                      <p>{suggestion.next}</p>
                      <p>終了条件：{suggestion.stepDone}</p>
                      <p>{suggestion.evidence}</p>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/tasks/${t.id}/edit`, {
                              revision: t.revision,
                              fields: {
                                next: suggestion.next,
                                stepDone: suggestion.stepDone,
                              },
                            });
                            await refresh();
                            setSuggestion(null);
                          })
                        }
                      >
                        この一手を採用する
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel">
                  <h2>通知・同期・履歴</h2>
                  <p>
                    カレンダー：
                    {detail.sync?.status === "synced"
                      ? "同期済み"
                      : detail.sync?.status === "failed"
                        ? "失敗・古い期限が外部に残る可能性あり"
                        : "未同期"}
                  </p>
                  {detail.sync?.error && (
                    <p className="error">{detail.sync.error}</p>
                  )}
                  {detail.jobs.map((j: any, i: number) => (
                    <p key={i}>
                      {jobStates[j.status]} ·{" "}
                      {formatTime(j.due, settings.preferences.zone)}
                    </p>
                  ))}
                  <details>
                    <summary>変更履歴を見る</summary>
                    {detail.history.map((h: any, i: number) => (
                      <div className="history" key={i}>
                        <p>
                          {h.kind} ·{" "}
                          {formatTime(h.at, settings.preferences.zone)}
                        </p>
                        {h.kind === "deadline_confirmed" && (
                          <p>
                            {deadlineLabel(JSON.parse(h.before_data).deadline)}{" "}
                            → {deadlineLabel(JSON.parse(h.after_data).deadline)}
                          </p>
                        )}
                      </div>
                    ))}
                  </details>
                </section>
              </>
            )}
            {view === "settings" && settings && (
              <>
                <p className="eyebrow">必要なものだけ、つなぐ</p>
                <h1>設定・連携状態</h1>
                <Settings
                  data={settings}
                  busy={busy}
                  run={run}
                  refresh={refresh}
                />
              </>
            )}
          </>
        )}
      </main>
      {logged && (
        <nav aria-label="メインナビゲーション">
          {[
            ["home", "今の一手"],
            ["inbox", "登録"],
            ["list", "一覧・期限"],
            ["settings", "設定"],
          ].map(([v, label]) => (
            <button
              key={v}
              className={view === v ? "current" : ""}
              onClick={() => navigate(v as View)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <footer>期限を確かめて、ひとつずつ。</footer>
    </>
  );
}
function DeadlineForm({
  task,
  busy,
  save,
}: {
  task: Task;
  busy: boolean;
  save: (d: unknown) => Promise<void>;
}) {
  const [kind, setKind] = useState(task.deadline.kind);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void save({
          kind,
          date: ["date", "datetime"].includes(kind) ? f.get("date") : null,
          time: kind === "datetime" ? f.get("time") : null,
          zone: kind === "datetime" ? f.get("zone") : null,
          confirmed: kind !== "unknown",
          evidence: f.get("evidence"),
          uncertainty:
            kind === "date"
              ? ["提出時刻を確認する"]
              : kind === "unknown"
                ? ["提出期限の根拠を確認する"]
                : [],
        });
      }}
    >
      <label>
        確認できた範囲
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="unknown">まだ分からない</option>
          <option value="none">期限なしと明示されている</option>
          <option value="date">年月日まで分かる（時刻未確認）</option>
          <option value="datetime">年月日・時刻・タイムゾーンまで分かる</option>
        </select>
      </label>
      {["date", "datetime"].includes(kind) && (
        <label>
          提出日（年も確認）
          <input
            name="date"
            type="date"
            defaultValue={task.deadline.date ?? ""}
            required
          />
        </label>
      )}
      {kind === "datetime" && (
        <>
          <label>
            提出時刻
            <input
              name="time"
              type="time"
              defaultValue={task.deadline.time ?? ""}
              required
            />
          </label>
          <label>
            根拠を確認したタイムゾーン
            <input
              name="zone"
              placeholder="例：Asia/Tokyo"
              defaultValue={task.deadline.zone ?? ""}
              required
            />
          </label>
        </>
      )}
      <label>
        根拠の原文・確認内容
        <textarea
          name="evidence"
          defaultValue={task.deadline.evidence}
          required={kind !== "unknown"}
          rows={2}
        />
      </label>
      <label className="check">
        <input type="checkbox" required />
        根拠を確認し、提出期限の情報を明示的に変更する
      </label>
      <button disabled={busy}>期限の確認・変更を保存</button>
    </form>
  );
}
function Settings({
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
        <h2>自分で決める確認時刻</h2>
        <p className="muted">空欄は通知なし。起床・就寝時刻は推測しません。</p>
        <label>
          表示・通知タイムゾーン
          <input name="zone" defaultValue={data.preferences.zone} required />
        </label>
        <label className="check">
          <input
            name="planNotify"
            type="checkbox"
            defaultChecked={data.preferences.planNotify}
          />
          自分で決めた着手時刻に通知
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
          登録漏れを照合する曜日
          <select name="weeklyDay" defaultValue={data.preferences.weeklyDay}>
            {["月", "火", "水", "木", "金", "土", "日"].map((d, i) => (
              <option key={d} value={i + 1}>
                {d}曜日
              </option>
            ))}
          </select>
        </label>
        <label>
          週の照合時刻
          <input
            name="weeklyTime"
            type="time"
            defaultValue={data.preferences.weeklyTime ?? ""}
          />
        </label>
        <label>
          確認済み期限の前日に確認する時刻
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
            : "未設定：手入力とテンプレートで利用できます。"}
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
      <section className="panel">
        <h2>端末への通知</h2>
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
      </section>
      <section className="panel">
        <h2>Googleカレンダー</h2>
        <p>
          {data.google.connected
            ? "Google認可済み"
            : data.google.configured
              ? "認可待ち"
              : "未設定：コア機能はそのまま使えます"}
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
      </section>
      <section className="panel">
        <h2>通知の予定と履歴</h2>
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
      </section>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
