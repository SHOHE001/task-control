import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DateTime } from "luxon";
import type { Task } from "../src/domain";
import {
  api,
  deadlineText,
  formatTime,
  historyText,
  nextText,
  reasonText,
  stateText,
  stepText,
  jobStates,
} from "./presentation";
import {
  DeadlineForm,
  EditForm,
  Guide,
  Icon,
  PauseForm,
  PlanForm,
  Sheet,
} from "./components";
import { Settings } from "./Settings";
import "./style.css";
type View = "home" | "inbox" | "list" | "detail" | "settings";
type Modal = {
  kind:
    | "deadline"
    | "plan"
    | "pause"
    | "edit"
    | "smaller"
    | "submit"
    | "finish"
    | "cancel";
  task: Task;
};
const guideKey = "task-control:guide:v1";
const tabs = [
  { view: "home" as View, label: "今日", icon: "today" as const },
  { view: "list" as View, label: "課題", icon: "tasks" as const },
  { view: "inbox" as View, label: "追加", icon: "add" as const },
  { view: "settings" as View, label: "設定", icon: "settings" as const },
];
function App() {
  const initial = new URLSearchParams(location.search);
  const initialView = initial.get("view");
  const [view, setView] = useState<View>(
    ["home", "inbox", "list", "settings"].includes(initialView ?? "")
      ? (initialView as View)
      : "home",
  );
  const [logged, setLogged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [home, setHome] = useState<any>({});
  const [settings, setSettings] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [guide, setGuide] = useState(false);
  const [suggestion, setSuggestion] = useState<any>(null);
  const [filter, setFilter] = useState("open");
  const detailId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const requestGeneration = useRef(0);
  const zone = settings?.preferences.zone ?? "Asia/Tokyo";
  async function refresh() {
    const generation = ++requestGeneration.current;
    const [ts, h, s] = await Promise.all([
      api("/tasks"),
      api("/home"),
      api("/settings"),
    ]);
    if (generation !== requestGeneration.current) return;
    setTasks(ts);
    setHome(h);
    setSettings(s);
    setLogged(true);
    if (detailId.current) setDetail(await api("/tasks/" + detailId.current));
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if ((e as any).status === 401) {
        setLogged(false);
        setModal(null);
        setGuide(false);
      }
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
    window.scrollTo(0, 0);
    const target = view === "inbox" ? titleInput.current : heading.current;
    target?.focus({ preventScroll: true });
  }, [view, logged]);
  useEffect(() => {
    if (!logged) return;
    try {
      if (localStorage.getItem(guideKey) !== "done") setGuide(true);
    } catch {
      setGuide(true);
    }
    const id = new URLSearchParams(location.search).get("job");
    if (id)
      void api("/push/opened", { id })
        .then(() => history.replaceState(null, "", location.pathname))
        .catch(() => {});
  }, [logged]);
  function closeGuide() {
    try {
      localStorage.setItem(guideKey, "done");
    } catch {
      /* optional browser preference */
    }
    setGuide(false);
  }
  function navigate(next: View) {
    setView(next);
    setModal(null);
    setError("");
    setNotice("");
    setSuggestion(null);
    if (next !== "detail") detailId.current = null;
    history.replaceState(
      null,
      "",
      `?view=${next === "detail" ? "home" : next}`,
    );
  }
  async function open(t: Task) {
    detailId.current = t.id;
    setDetail(await api("/tasks/" + t.id));
    navigate("detail");
  }
  function show(kind: Modal["kind"], task: Task) {
    setError("");
    setNotice("");
    setSuggestion(null);
    setModal({ kind, task });
  }
  async function mutate(
    t: Task,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    const updated = await api(`/tasks/${t.id}/action`, {
      revision: t.revision,
      action,
      ...extra,
    });
    await refresh();
    return updated as Task;
  }
  function begin(t: Task) {
    const url = t.workUrl || t.sourceUrl;
    const tab = url ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    void perform(async () => {
      try {
        const updated = await mutate(t, "start");
        if (tab) tab.location.href = url;
        await open(updated);
        if (url && !tab)
          setNotice(
            "作業を始めました。「作業ページを開く」から続けてください。",
          );
      } catch (e) {
        tab?.close();
        throw e;
      }
    });
  }
  const activeTasks = tasks.filter(
    (t) => !["closed", "cancelled"].includes(t.state),
  );
  const task: Task | undefined = view === "detail" ? detail?.task : home.task;
  const modalTitles = {
    deadline: "締切はいつ？",
    plan: "いつ取り組む？",
    pause: "途中で休む",
    edit: "課題の情報を編集",
    smaller: "始めにくいときは",
    submit: "提出できましたか？",
    finish: "作業は終わりましたか？",
    cancel: "この課題を取りやめますか？",
  };
  function card(t: Task, reason?: string) {
    const active = t.state === "active",
      submitted = t.state === "work_done";
    return (
      <section className="focus-card" data-testid="main-action">
        <div className="card-top">
          <span className="pill">
            <Icon
              name={
                submitted
                  ? "check"
                  : active
                    ? "today"
                    : t.state === "paused"
                      ? "pause"
                      : "tasks"
              }
            />
            {stateText[t.state]}
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void perform(() => open(t))}
          >
            課題の詳細
            <Icon name="arrow" />
          </button>
        </div>
        <h2>{t.title}</h2>
        <button className="deadline-line" onClick={() => show("deadline", t)}>
          <Icon name="calendar" />
          <span>{deadlineText(t.deadline)}</span>
          <span className="text-link">
            {t.deadline.confirmed ? "変更" : "入力する"}
          </span>
        </button>
        <div className="next-step">
          <p className="eyebrow">
            {submitted
              ? "最後にすること"
              : t.resume
                ? "前回の続き"
                : "まずはここから"}
          </p>
          <h3>
            {submitted
              ? "提出ページで、送信できたか確認する"
              : t.resume || nextText(t)}
          </h3>
          {!t.resume && !submitted && <p className="muted">{stepText(t)}</p>}
        </div>
        {reason && <p className="reason">{reasonText(reason)}</p>}
        <div className="actions">
          {submitted ? (
            <button
              className="primary grow"
              disabled={busy}
              onClick={() => show("submit", t)}
            >
              提出済みにする
              <Icon name="check" />
            </button>
          ) : active ? (
            <>
              <button
                className="secondary grow"
                disabled={busy}
                onClick={() => show("pause", t)}
              >
                <Icon name="pause" />
                途中で休む
              </button>
              <button
                className="primary grow"
                disabled={busy}
                onClick={() => show("finish", t)}
              >
                作業が終わった
                <Icon name="check" />
              </button>
            </>
          ) : (
            <button
              className="primary grow"
              disabled={busy}
              onClick={() => begin(t)}
            >
              {t.state === "paused" ? "続きからはじめる" : "はじめる"}
              <Icon name="arrow" />
            </button>
          )}
          {!active && !submitted && (
            <button className="secondary" onClick={() => show("smaller", t)}>
              始めにくい
            </button>
          )}
        </div>
        {(t.workUrl || t.sourceUrl) && (
          <a
            className="work-link"
            href={t.workUrl || t.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="link" />
            {submitted ? "提出ページを開く" : "作業ページを開く"}
          </a>
        )}
        {!active && !submitted && (
          <button className="text-button" onClick={() => show("plan", t)}>
            あとで取り組む
          </button>
        )}
      </section>
    );
  }
  function taskRow(t: Task) {
    return (
      <div className="task-row" key={t.id}>
        <button
          className="task-open"
          onClick={() => void perform(() => open(t))}
        >
          <span
            className={`task-symbol ${t.state === "closed" ? "complete" : ""}`}
          >
            <Icon name={t.state === "closed" ? "check" : "tasks"} />
          </span>
          <span className="row-copy">
            <strong>{t.title}</strong>
            <small>
              {deadlineText(t.deadline)} · {stateText[t.state]}
            </small>
          </span>
          <Icon name="arrow" />
        </button>
        {!["closed", "cancelled"].includes(t.state) && (
          <button
            className="text-button choose-task"
            disabled={busy}
            aria-label={`${t.title}を今日の課題にする`}
            onClick={() =>
              void perform(async () => {
                await api("/select", { id: t.id });
                await refresh();
                navigate("home");
              })
            }
          >
            今日はこれをする
          </button>
        )}
      </div>
    );
  }
  if (loading)
    return (
      <main className="loading" aria-label="課題を読み込み中" aria-busy="true">
        <div className="skeleton title-skeleton" />
        <div className="skeleton card-skeleton" />
      </main>
    );
  if (!logged)
    return (
      <main className="login">
        <div className="app-icon">
          <Icon name="arrow" />
        </div>
        <p className="eyebrow">TASK CONTROL</p>
        <h1>課題を、ひとつずつ。</h1>
        <p className="muted">
          何をするか迷ったら、ここから。
          <br />
          中断した続きも、すぐに見つかります。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const password = new FormData(e.currentTarget).get("password");
            void perform(async () => {
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
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "ログインしています…" : "ログイン"}
          </button>
        </form>
      </main>
    );
  return (
    <div className="app-layout">
      <a href="#main" className="skip-link">
        本文へ移動
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="app-icon small">
            <Icon name="arrow" />
          </span>
          <span>task-control</span>
        </div>
        <nav aria-label="メインナビゲーション">
          {tabs.map((tab) => (
            <button
              key={tab.view}
              aria-current={view === tab.view ? "page" : undefined}
              className={view === tab.view ? "current" : ""}
              disabled={busy}
              onClick={() => {
                navigate(tab.view);
                void perform(refresh);
              }}
            >
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="text-button" onClick={() => setGuide(true)}>
            <Icon name="help" />
            使い方
          </button>
          <span className="caption">少しずつ、進めていこう。</span>
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <span className="mobile-brand">task-control</span>
          <span className="desktop-context">自分のペースで、ひとつずつ。</span>
          <button
            className="text-button"
            aria-label="使い方を見る"
            onClick={() => setGuide(true)}
          >
            <Icon name="help" />
            <span>使い方</span>
          </button>
        </header>
        <main id="main" className="content">
          <div aria-live="polite">
            {!modal && error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {notice && <p className="notice">{notice}</p>}
          </div>
          {view === "home" && (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">
                    {DateTime.now()
                      .setZone(zone)
                      .setLocale("ja")
                      .toFormat("M月d日 cccc")}
                  </p>
                  <h1 ref={heading} tabIndex={-1}>
                    今日すること
                  </h1>
                  <p className="muted">
                    まずは、ひとつ。続きからでも大丈夫です。
                  </p>
                </div>
                <button
                  className="primary compact desktop-add"
                  onClick={() => navigate("inbox")}
                >
                  <Icon name="add" />
                  課題を追加
                </button>
              </div>
              <div className="home-grid">
                <div>
                  {task ? (
                    card(task, home.reason)
                  ) : (
                    <section className="focus-card empty-state">
                      <div className="empty-symbol">
                        <Icon name={activeTasks.length ? "today" : "add"} />
                      </div>
                      <h2>
                        {activeTasks.length
                          ? "予定の時間まで、ひと休み。"
                          : "最初の課題を追加しましょう。"}
                      </h2>
                      <p className="muted">
                        {activeTasks.length
                          ? "今始めたければ、課題一覧から選べます。"
                          : "課題の名前か、届いた案内を入れるだけ。締切や細かい設定は、あとからで大丈夫です。"}
                      </p>
                      <button
                        className="primary"
                        onClick={() =>
                          navigate(activeTasks.length ? "list" : "inbox")
                        }
                      >
                        {activeTasks.length ? "課題を選ぶ" : "課題を追加"}
                        <Icon name={activeTasks.length ? "tasks" : "add"} />
                      </button>
                    </section>
                  )}
                  {task && (
                    <button
                      className="text-button alternate"
                      onClick={() => navigate("list")}
                    >
                      別の課題を選ぶ
                      <Icon name="arrow" />
                    </button>
                  )}
                </div>
                <aside className="home-aside">
                  <section className="panel deadlines">
                    <div className="section-title">
                      <h2>締切を見ておく</h2>
                      <Icon name="calendar" />
                    </div>
                    <p className="caption">
                      近い締切や、まだ入力していないもの。
                    </p>
                    {home.attention?.length ? (
                      home.attention.slice(0, 3).map((t: Task) => (
                        <button
                          className="deadline-row"
                          key={t.id}
                          onClick={() => {
                            void perform(async () => {
                              await open(t);
                              show("deadline", t);
                            });
                          }}
                        >
                          <strong>{t.title}</strong>
                          <span>{deadlineText(t.deadline)}</span>
                        </button>
                      ))
                    ) : (
                      <p className="muted">今、近い締切はありません。</p>
                    )}
                    {home.attention?.length > 3 && (
                      <button
                        className="text-button"
                        onClick={() => navigate("list")}
                      >
                        すべての課題を見る
                      </button>
                    )}
                  </section>
                  <details className="weekly panel">
                    <summary>登録し忘れがないか見直す</summary>
                    <p className="muted">
                      週に一度、大学の課題一覧と見比べてみましょう。このアプリに入れていない課題は、ここには表示されません。
                    </p>
                    <p className="caption">
                      {home.weeklyCheckedAt
                        ? `前回見比べた日：${formatTime(home.weeklyCheckedAt, zone)}`
                        : "まだ見直した記録はありません。"}
                    </p>
                    <button
                      className="secondary wide"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api("/weekly-check", {});
                          await refresh();
                          setNotice("課題一覧を見直した日を保存しました。");
                        })
                      }
                    >
                      大学の一覧と見比べた
                    </button>
                    <button
                      className="text-button"
                      onClick={() => navigate("settings")}
                    >
                      見直す時間を設定
                    </button>
                  </details>
                </aside>
              </div>
            </>
          )}
          {view === "inbox" && (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">覚えておく場所を、ここに。</p>
                  <h1 ref={heading} tabIndex={-1}>
                    課題を追加
                  </h1>
                  <p className="muted">
                    名前だけで保存できます。まだ決まっていないことは、あとで。
                  </p>
                </div>
              </div>
              <div className="narrow">
                <form
                  className="panel add-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void perform(async () => {
                      const t = await api("/tasks", {
                        title: f.get("title"),
                        original: f.get("original"),
                        sourceUrl: f.get("sourceUrl"),
                      });
                      await refresh();
                      await open(t);
                      setNotice(
                        "追加しました。締切を入れても、そのまま始めても大丈夫です。",
                      );
                    });
                  }}
                >
                  <label>
                    課題の名前
                    <input
                      name="title"
                      ref={titleInput}
                      maxLength={200}
                      placeholder="例：英語のレポート"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    届いた案内（任意）
                    <textarea
                      name="original"
                      rows={5}
                      placeholder="先生からのメールや、課題ページの文章を貼り付ける"
                    />
                  </label>
                  <p className="hint">
                    案内だけを貼り付けても保存できます。書かれている締切は、あとで一緒に見られます。
                  </p>
                  <details>
                    <summary>案内のリンクも残す</summary>
                    <label>
                      案内のURL
                      <input
                        name="sourceUrl"
                        type="url"
                        placeholder="https://…"
                      />
                    </label>
                  </details>
                  <button className="primary wide" disabled={busy}>
                    {busy ? "保存しています…" : "課題を保存"}
                    <Icon name="add" />
                  </button>
                </form>
                <p className="caption center">
                  分類や優先順位を、いま決める必要はありません。
                </p>
              </div>
            </>
          )}
          {view === "list" && (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">取り組むことを、見渡す。</p>
                  <h1 ref={heading} tabIndex={-1}>
                    課題
                  </h1>
                </div>
                <button
                  className="primary compact"
                  onClick={() => navigate("inbox")}
                >
                  <Icon name="add" />
                  追加
                </button>
              </div>
              <div className="segments" aria-label="課題の表示">
                {[
                  ["open", "これから・途中"],
                  ["closed", "終わった課題"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <section className="panel task-list">
                {tasks
                  .filter((t) =>
                    filter === "open"
                      ? !["closed", "cancelled"].includes(t.state)
                      : ["closed", "cancelled"].includes(t.state),
                  )
                  .map(taskRow)}
                {!tasks.some((t) =>
                  filter === "open"
                    ? !["closed", "cancelled"].includes(t.state)
                    : ["closed", "cancelled"].includes(t.state),
                ) && (
                  <div className="empty-state">
                    <Icon name="tasks" />
                    <h2>
                      {filter === "open"
                        ? "ここに課題が並びます。"
                        : "終わった課題は、ここに。"}
                    </h2>
                    <p className="muted">
                      {filter === "open"
                        ? "課題の名前だけでも追加できます。"
                        : "作業や提出が済んだ課題を、あとから見返せます。"}
                    </p>
                    {filter === "open" && (
                      <button
                        className="primary"
                        onClick={() => navigate("inbox")}
                      >
                        課題を追加
                      </button>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          {view === "detail" && task && (
            <>
              <button
                className="text-button back"
                onClick={() => navigate("list")}
              >
                <Icon name="back" />
                課題一覧
              </button>
              <div className="page-title">
                <div>
                  <p className="eyebrow">{stateText[task.state]}</p>
                  <h1 ref={heading} tabIndex={-1}>
                    {task.title}
                  </h1>
                </div>
                <button
                  className="secondary compact"
                  onClick={() => show("edit", task)}
                >
                  編集
                </button>
              </div>
              <ol className="progress-steps" aria-label="課題の進み方">
                {(task.needsSubmission
                  ? ["取り組む", "提出する", "完了"]
                  : ["取り組む", "完了"]
                ).map((label, i, arr) => (
                  <li
                    key={label}
                    aria-current={
                      task.state === "closed"
                        ? i === arr.length - 1
                          ? "step"
                          : undefined
                        : task.state === "work_done"
                          ? i === 1
                            ? "step"
                            : undefined
                          : i === 0
                            ? "step"
                            : undefined
                    }
                  >
                    <span>{i + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
              <div className="detail-grid">
                <div>
                  {["closed", "cancelled"].includes(task.state) ? (
                    <section className="focus-card complete-card">
                      <div className="empty-symbol">
                        <Icon name="check" />
                      </div>
                      <h2>
                        {task.state === "cancelled"
                          ? "この課題は取りやめました。"
                          : "おつかれさまでした。"}
                      </h2>
                      <p>
                        {task.submittedAt
                          ? `提出したことを確認した日：${formatTime(task.submittedAt, zone)}`
                          : task.state === "closed"
                            ? "作業が終わったことを保存しました。"
                            : "必要になったら、また再開できます。"}
                      </p>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await mutate(task, "reopen");
                            setNotice("もう一度取り組めるようにしました。");
                          })
                        }
                      >
                        完了を取り消して再開する
                      </button>
                    </section>
                  ) : (
                    <section className="focus-card">
                      <div className="card-top">
                        <span className="pill">{stateText[task.state]}</span>
                        {task.planAt && (
                          <span className="caption">
                            予定：{formatTime(task.planAt, zone)}
                          </span>
                        )}
                      </div>
                      <h2>
                        {task.state === "work_done"
                          ? "あとは、提出。"
                          : task.state === "active"
                            ? "自分のペースで進めましょう。"
                            : task.resume
                              ? "前回の続きから。"
                              : "まず、これから。"}
                      </h2>
                      {task.state === "work_done" ? (
                        <>
                          <p className="muted">
                            作業の終了は保存しました。提出ページで送信できたことを確認したら、下のボタンで完了にできます。
                          </p>
                          {(task.workUrl || task.sourceUrl) && (
                            <a
                              className="work-link"
                              target="_blank"
                              rel="noopener noreferrer"
                              href={task.workUrl || task.sourceUrl}
                            >
                              <Icon name="link" />
                              提出ページを開く
                            </a>
                          )}
                          <button
                            className="primary wide"
                            disabled={busy}
                            onClick={() => show("submit", task)}
                          >
                            提出済みにする
                            <Icon name="check" />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="note">
                            <span>
                              {task.resume ? "続きのメモ" : "最初にすること"}
                            </span>
                            <p>{task.resume || nextText(task)}</p>
                          </div>
                          {!task.resume && (
                            <p className="muted">{stepText(task)}</p>
                          )}
                          {task.workUrl || task.sourceUrl ? (
                            <a
                              className="work-link"
                              target="_blank"
                              rel="noopener noreferrer"
                              href={task.workUrl || task.sourceUrl}
                            >
                              <Icon name="link" />
                              作業ページを開く
                            </a>
                          ) : (
                            <button
                              className="text-button"
                              onClick={() => show("edit", task)}
                            >
                              <Icon name="link" />
                              作業ページのリンクを追加
                            </button>
                          )}
                          <div className="actions">
                            {task.state === "active" ? (
                              <>
                                <button
                                  className="secondary grow"
                                  disabled={busy}
                                  onClick={() => show("pause", task)}
                                >
                                  <Icon name="pause" />
                                  途中で休む
                                </button>
                                <button
                                  className="primary grow"
                                  disabled={busy}
                                  onClick={() => show("finish", task)}
                                >
                                  作業が終わった
                                  <Icon name="check" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="primary grow"
                                  disabled={busy}
                                  onClick={() => begin(task)}
                                >
                                  {task.state === "paused"
                                    ? "続きからはじめる"
                                    : "はじめる"}
                                  <Icon name="arrow" />
                                </button>
                                <button
                                  className="secondary"
                                  onClick={() => show("smaller", task)}
                                >
                                  始めにくい
                                </button>
                              </>
                            )}
                          </div>
                          <details className="other-actions">
                            <summary>ほかの操作</summary>
                            <div className="stack">
                              <button
                                className="text-button"
                                onClick={() => show("plan", task)}
                              >
                                あとで取り組む時間を決める
                              </button>
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  void perform(async () => {
                                    await mutate(task, "step_done");
                                    setNotice(
                                      "ひと区切りを保存しました。残りの作業は続けられます。",
                                    );
                                  })
                                }
                              >
                                ひと区切りだけ終わった
                              </button>
                              {task.state !== "active" && (
                                <button
                                  className="text-button"
                                  onClick={() => show("finish", task)}
                                >
                                  すでに作業は終わっている
                                </button>
                              )}
                              <button
                                className="text-button"
                                onClick={() => show("edit", task)}
                              >
                                最初にすることを書き換える
                              </button>
                            </div>
                          </details>
                        </>
                      )}
                    </section>
                  )}
                  <details className="panel">
                    <summary>先生からの案内</summary>
                    <blockquote>
                      {task.original ||
                        "案内の文章は、まだ貼り付けていません。"}
                    </blockquote>
                    {task.sourceUrl && (
                      <a
                        href={task.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        案内のページを開く
                        <Icon name="link" />
                      </a>
                    )}
                  </details>
                </div>
                <aside className="detail-aside">
                  <section className="panel">
                    <div className="section-title">
                      <h2>締切</h2>
                      <Icon name="calendar" />
                    </div>
                    <p className="deadline-value">
                      {deadlineText(task.deadline)}
                    </p>
                    {!task.deadline.confirmed && (
                      <p className="caption">
                        分かったときに入力できます。先に作業を始めても大丈夫です。
                      </p>
                    )}
                    <button
                      className="secondary wide"
                      onClick={() => show("deadline", task)}
                    >
                      {task.deadline.confirmed ? "締切を変更" : "締切を入力"}
                    </button>
                  </section>
                  <details className="panel">
                    <summary>作業や変更の記録</summary>
                    {task.submittedAt && (
                      <p className="caption">
                        提出の記録は、自分で提出先を確認して保存したものです。
                      </p>
                    )}
                    {detail.history.map((h: any, i: number) => (
                      <div className="history" key={i}>
                        <strong>{historyText[h.kind] || h.kind}</strong>
                        <small>{formatTime(h.at, zone)}</small>
                        {h.kind === "deadline_confirmed" && (
                          <p>
                            {deadlineText(JSON.parse(h.before_data).deadline)} →{" "}
                            {deadlineText(JSON.parse(h.after_data).deadline)}
                          </p>
                        )}
                      </div>
                    ))}
                  </details>
                  <details className="panel">
                    <summary>通知とカレンダー</summary>
                    <p>
                      カレンダー：
                      {detail.sync?.status === "synced"
                        ? "同期済み"
                        : detail.sync?.status === "failed"
                          ? "同期できませんでした"
                          : "まだ同期していません"}
                    </p>
                    {detail.sync?.error && (
                      <p className="error">{detail.sync.error}</p>
                    )}
                    {detail.jobs.map((j: any, i: number) => (
                      <p key={i}>
                        {jobStates[j.status]} · {formatTime(j.due, zone)}
                      </p>
                    ))}
                  </details>
                  {!["closed", "cancelled"].includes(task.state) && (
                    <button
                      className="text-button destructive"
                      onClick={() => show("cancel", task)}
                    >
                      この課題を取りやめる
                    </button>
                  )}
                </aside>
              </div>
            </>
          )}
          {view === "settings" && settings && (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">必要なものだけ、自分に合わせる。</p>
                  <h1 ref={heading} tabIndex={-1}>
                    設定
                  </h1>
                </div>
              </div>
              <div className="narrow">
                <button
                  className="settings-help panel"
                  onClick={() => setGuide(true)}
                >
                  <Icon name="help" />
                  <span>
                    <strong>使い方をもう一度見る</strong>
                    <small>追加・開始・休憩・提出の流れ</small>
                  </span>
                  <Icon name="arrow" />
                </button>
                <Settings
                  data={settings}
                  busy={busy}
                  run={async (fn) => {
                    await perform(async () => {
                      await fn();
                      setNotice("設定を保存しました。");
                    });
                  }}
                  refresh={refresh}
                />
                <button
                  className="text-button destructive"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api("/logout", {});
                      setLogged(false);
                      setTasks([]);
                      setHome({});
                      setDetail(null);
                      detailId.current = null;
                    })
                  }
                >
                  ログアウト
                </button>
              </div>
            </>
          )}
        </main>
      </div>
      {guide && (
        <Guide
          close={closeGuide}
          add={() => {
            closeGuide();
            navigate("inbox");
          }}
        />
      )}
      {modal && !guide && (
        <Sheet
          title={modalTitles[modal.kind]}
          error={error}
          busy={busy}
          close={() => {
            setModal(null);
            setError("");
          }}
        >
          {modal.kind === "deadline" && (
            <DeadlineForm
              task={modal.task}
              busy={busy}
              close={() => {
                setModal(null);
                setError("");
              }}
              save={(d) =>
                perform(async () => {
                  await api(`/tasks/${modal.task.id}/deadline`, {
                    revision: modal.task.revision,
                    deadline: d,
                    ack: true,
                  });
                  await refresh();
                  setModal(null);
                  setNotice(
                    d.kind === "unknown"
                      ? "締切は、分かったときに入力できます。"
                      : "締切を保存しました。",
                  );
                })
              }
            />
          )}
          {modal.kind === "plan" && (
            <PlanForm
              task={modal.task}
              busy={busy}
              zone={zone}
              save={(at) =>
                perform(async () => {
                  await api(`/tasks/${modal.task.id}/plan`, {
                    revision: modal.task.revision,
                    planAt: at,
                  });
                  await refresh();
                  setModal(null);
                  setNotice("取り組む予定を保存しました。締切は変わりません。");
                })
              }
            />
          )}
          {modal.kind === "pause" && (
            <PauseForm
              task={modal.task}
              busy={busy}
              save={(memo) =>
                perform(async () => {
                  await mutate(modal.task, "pause", { memo });
                  setModal(null);
                  setNotice(
                    "続きのメモを保存しました。またここから始められます。",
                  );
                })
              }
            />
          )}
          {modal.kind === "edit" && (
            <EditForm
              task={modal.task}
              busy={busy}
              save={(fields) =>
                perform(async () => {
                  await api(`/tasks/${modal.task.id}/edit`, {
                    revision: modal.task.revision,
                    fields,
                  });
                  await refresh();
                  setModal(null);
                  setNotice("課題の情報を保存しました。");
                })
              }
            />
          )}
          {modal.kind === "finish" && (
            <>
              <p>
                {modal.task.needsSubmission
                  ? "課題の作業が全部終わったら、次は提出です。ここでは、まだ提出済みにはなりません。"
                  : "課題の作業が全部終わったら、完了にできます。"}
              </p>
              {modal.task.totalDone && (
                <div className="note">
                  <span>全部終わったときの目安</span>
                  <p>{modal.task.totalDone}</p>
                </div>
              )}
              <button
                className="primary wide"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await mutate(modal.task, "work_done");
                    setModal(null);
                    setNotice(
                      modal.task.needsSubmission
                        ? "作業の終了を保存しました。あとは提出です。"
                        : "作業の終了を保存しました。おつかれさまでした。",
                    );
                  })
                }
              >
                {modal.task.needsSubmission
                  ? "作業は終わった。提出へ進む"
                  : "作業を完了にする"}
              </button>
              <button className="quiet wide" onClick={() => setModal(null)}>
                まだ続ける
              </button>
            </>
          )}
          {modal.kind === "submit" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await mutate(modal.task, "submit", { ack: true });
                  setModal(null);
                  setNotice("提出済みにしました。おつかれさまでした。");
                });
              }}
            >
              <p>
                提出先の完了画面やメールで、送信できたことを確認してください。
              </p>
              <label className="check">
                <input type="checkbox" required />
                提出先で、送信できたことを確認しました
              </label>
              <button className="primary wide" disabled={busy}>
                提出済みにする
                <Icon name="check" />
              </button>
              <button
                type="button"
                className="quiet wide"
                onClick={() => setModal(null)}
              >
                まだ提出していない
              </button>
            </form>
          )}
          {modal.kind === "cancel" && (
            <>
              <p>
                提出が必要な課題かどうか、確認してください。取りやめた課題は「終わった課題」から戻せます。
              </p>
              <button
                className="danger wide"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await mutate(modal.task, "cancel", { ack: true });
                    setModal(null);
                  })
                }
              >
                この課題を取りやめる
              </button>
            </>
          )}
          {modal.kind === "smaller" && (
            <>
              <p className="muted">今、どこで引っかかっていますか？</p>
              <div className="choice-list">
                {[
                  [
                    "unclear",
                    "何をすればいいか分からない",
                    "課題の内容を読むところから",
                  ],
                  [
                    "large",
                    "やることが大きすぎる",
                    "最初の作業を、もう少し小さく",
                  ],
                  ["energy", "今は時間や元気がない", "取り組む時間を変える"],
                  ["purpose", "やる意味が分からない", "目的を考えるところから"],
                ].map(([reason, title, body]) => (
                  <button
                    className="choice"
                    key={reason}
                    disabled={busy}
                    onClick={() => {
                      if (reason === "energy") {
                        setModal({ kind: "plan", task: modal.task });
                        return;
                      }
                      void perform(async () => {
                        await mutate(modal.task, "smaller", { reason });
                        setModal(null);
                        setNotice("最初にすることを、小さく変えました。");
                      });
                    }}
                  >
                    <span>
                      <strong>{title}</strong>
                      <small>{body}</small>
                    </span>
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
              <details>
                <summary>別の候補も見てみる</summary>
                <p className="caption">
                  {settings.preferences.aiEnabled
                    ? "課題の名前・案内・続きのメモを、設定した外部AIへ送ります。"
                    : "外部AIを使わず、用意した例から候補を出します。"}
                </p>
                <button
                  className="secondary wide"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      setSuggestion(
                        await api(`/tasks/${modal.task.id}/suggest`, {}),
                      );
                    })
                  }
                >
                  {settings.preferences.aiEnabled
                    ? "AIに候補を聞く"
                    : "作業の例を見てみる"}
                </button>
                {suggestion && (
                  <div className="note">
                    <span>
                      {suggestion.source === "ai" ? "AIの候補" : "用意した例"}
                    </span>
                    <p>{suggestion.next}</p>
                    {suggestion.notice && <p>{suggestion.notice}</p>}
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api(`/tasks/${modal.task.id}/edit`, {
                            revision: modal.task.revision,
                            fields: {
                              next: suggestion.next,
                              stepDone: suggestion.stepDone,
                            },
                          });
                          await refresh();
                          setModal(null);
                          setSuggestion(null);
                        })
                      }
                    >
                      これから始めることにする
                    </button>
                  </div>
                )}
              </details>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
