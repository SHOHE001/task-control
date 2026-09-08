import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DateTime } from "luxon";
import type { Deadline, Task } from "../src/domain";
import { nextText, stepText } from "./presentation";
export function Icon({
  name,
}: {
  name:
    | "today"
    | "tasks"
    | "add"
    | "settings"
    | "arrow"
    | "check"
    | "pause"
    | "help"
    | "close"
    | "back"
    | "calendar"
    | "link";
}) {
  const paths: Record<string, ReactNode> = {
    today: (
      <>
        <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
    tasks: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="3" />
        <path d="m8 9 1 1 2-2m2 1h3m-8 6 1 1 2-2m2 1h3" />
      </>
    ),
    add: <path d="M12 5v14M5 12h14" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    pause: (
      <>
        <path d="M8 5v14m8-14v14" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    back: <path d="m14 5-7 7 7 7" />,
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="3" />
        <path d="M8 3v4m8-4v4M4 11h16m-11 4h2m2 0h2" />
      </>
    ),
    link: (
      <>
        <path d="M14 5h5v5m0-5L9 15M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
export function Sheet({
  title,
  close,
  error,
  children,
  busy = false,
}: {
  title: string;
  close: () => void;
  error?: string;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const prior = document.activeElement as HTMLElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (prior?.isConnected) prior.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="sheet-header">
        <h2 id={id}>{title}</h2>
        <button
          className="icon-button"
          aria-label="閉じる"
          disabled={busy}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
const guidePages = [
  {
    icon: "add" as const,
    title: "課題をひとつ、追加する。",
    body: "課題の名前か、先生から届いた案内を入れるだけ。締切や作業の細かい設定は、あとからで大丈夫です。",
    sample: "例：英語のレポート",
    detail: "名前だけでも保存できます。",
  },
  {
    icon: "arrow" as const,
    title: "「はじめる」から、作業へ。",
    body: "今日の画面には、おすすめの課題がひとつ。作業ページを登録しておくと、ボタンからすぐに開けます。",
    sample: "課題ページを開いて、問題をひとつ読む",
    detail: "別の課題を選んでも大丈夫です。",
  },
  {
    icon: "pause" as const,
    title: "休むときは、続きをひとこと。",
    body: "「途中で休む」で、次にすることを残せます。作業が終わったら「作業が終わった」。提出まで済んだら「提出済みにする」で完了です。",
    sample: "次は、2問目から。",
    detail: "途中のままでも、ここから戻れます。",
  },
];
export function Guide({ close, add }: { close: () => void; add: () => void }) {
  const [page, setPage] = useState(0);
  const current = guidePages[page];
  return (
    <Sheet title="かんたん使い方" close={close}>
      <div className="guide" aria-live="polite">
        <div className="guide-symbol">
          <Icon name={current.icon} />
        </div>
        <p className="eyebrow">{page + 1} / 3</p>
        <h3>{current.title}</h3>
        <p>{current.body}</p>
        <div className="guide-example">
          <span>こんなふうに使えます</span>
          <strong>{current.sample}</strong>
          <p>{current.detail}</p>
        </div>
      </div>
      <div className="guide-dots" aria-label={`${page + 1}ページ目`}>
        {guidePages.map((_, i) => (
          <span key={i} className={i === page ? "selected" : ""} />
        ))}
      </div>
      <div className="actions">
        {page > 0 && (
          <button className="secondary" onClick={() => setPage(page - 1)}>
            戻る
          </button>
        )}
        {page < 2 ? (
          <button className="primary grow" onClick={() => setPage(page + 1)}>
            次へ
            <Icon name="arrow" />
          </button>
        ) : (
          <button className="primary grow" onClick={add}>
            課題を追加する
            <Icon name="add" />
          </button>
        )}
      </div>
      <button className="quiet wide" onClick={close}>
        {page < 2 ? "今はスキップ" : "今日の画面へ"}
      </button>
      <p className="caption center">「使い方」から、いつでも見返せます。</p>
    </Sheet>
  );
}
export function DeadlineForm({
  task,
  busy,
  save,
  close,
}: {
  task: Task;
  busy: boolean;
  save: (d: Deadline) => Promise<void>;
  close: () => void;
}) {
  const [kind, setKind] = useState<Deadline["kind"]>(task.deadline.kind);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const evidence =
          String(f.get("evidence") || "").trim() ||
          task.deadline.evidence ||
          (kind === "none"
            ? "案内に締切がないことを自分で確認"
            : "自分で案内を確認して入力");
        void save({
          kind,
          date: ["date", "datetime"].includes(kind)
            ? String(f.get("date"))
            : null,
          time: kind === "datetime" ? String(f.get("time")) : null,
          zone: kind === "datetime" ? String(f.get("zone")) : null,
          confirmed: kind !== "unknown",
          evidence,
          uncertainty:
            kind === "date"
              ? ["提出時刻を確認する"]
              : kind === "unknown"
                ? ["提出期限の根拠を確認する"]
                : [],
        });
      }}
    >
      <p className="muted">
        分かっているところだけで大丈夫です。時間は勝手に補いません。
      </p>
      {task.original && (
        <details className="source-preview">
          <summary>先生からの案内を見る</summary>
          <blockquote>{task.original}</blockquote>
          {task.sourceUrl && (
            <a target="_blank" rel="noopener noreferrer" href={task.sourceUrl}>
              案内のページを開く
            </a>
          )}
        </details>
      )}
      <label>
        締切について
        <select
          aria-label="締切について"
          value={kind}
          onChange={(e) => setKind(e.target.value as Deadline["kind"])}
        >
          <option value="unknown">まだ分からない</option>
          <option value="date">日付が分かる</option>
          <option value="datetime">日付と時間が分かる</option>
          <option value="none">締切はない</option>
        </select>
      </label>
      {["date", "datetime"].includes(kind) && (
        <label>
          締切日
          <input
            type="date"
            name="date"
            defaultValue={task.deadline.date ?? ""}
            required
          />
        </label>
      )}
      {task.deadline.date && !task.deadline.confirmed && (
        <p className="hint">
          案内から見つけた日付です。合っているか見てから保存してください。
        </p>
      )}
      {kind === "datetime" && (
        <div className="form-columns">
          <label>
            締切の時間
            <input
              name="time"
              type="time"
              defaultValue={task.deadline.time ?? ""}
              required
            />
          </label>
          <label>
            時間の地域
            <input
              name="zone"
              list="deadline-zones"
              defaultValue={task.deadline.zone ?? ""}
              placeholder="例：Asia/Tokyo（日本時間）"
              required
            />
            <datalist id="deadline-zones">
              <option value="Asia/Tokyo">日本時間</option>
              <option value="UTC">UTC</option>
            </datalist>
          </label>
        </div>
      )}
      <details>
        <summary>メモを添える（任意）</summary>
        <label>
          締切についてのメモ
          <textarea
            name="evidence"
            defaultValue={task.deadline.evidence}
            placeholder="例：先生のメールに書いてあった"
            rows={2}
          />
        </label>
      </details>
      <p className="caption">
        「締切を保存」を押すと、自分で確認した締切として保存します。あとから変更できます。
      </p>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={close}
        >
          今はあとで
        </button>
        <button className="primary grow" disabled={busy}>
          締切を保存
        </button>
      </div>
    </form>
  );
}
export function PlanForm({
  task,
  zone,
  busy,
  save,
}: {
  task: Task;
  zone: string;
  busy: boolean;
  save: (at: string | null) => Promise<void>;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const when = String(new FormData(e.currentTarget).get("when") || "");
        const dt = when ? DateTime.fromISO(when, { zone }) : null;
        void save(dt ? dt.toISO() : null);
      }}
    >
      <p className="muted">これは自分の予定です。課題の締切は変わりません。</p>
      <label>
        取り組む日時
        <input
          name="when"
          type="datetime-local"
          defaultValue={
            task.planAt
              ? DateTime.fromISO(task.planAt)
                  .setZone(zone)
                  .toFormat("yyyy-MM-dd'T'HH:mm")
              : ""
          }
        />
      </label>
      <p className="caption">
        {zone}の時間です。空欄にすると予定を取り消します。
      </p>
      <button className="primary wide" disabled={busy}>
        この時間にする
      </button>
    </form>
  );
}
export function PauseForm({
  task,
  busy,
  save,
}: {
  task: Task;
  busy: boolean;
  save: (memo: string) => Promise<void>;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(
          String(new FormData(e.currentTarget).get("memo") || "") ||
            `次は「${nextText(task)}」から。`,
        );
      }}
    >
      <p className="muted">
        次に開いたとき、このメモから戻れます。書かずに保存しても大丈夫です。
      </p>
      <label>
        次はどこから？
        <textarea
          name="memo"
          rows={3}
          defaultValue={task.resume}
          placeholder="例：2問目の計算から。資料は開いたまま。"
        />
      </label>
      <div className="note">
        <span>メモがなければ、こちらを残します</span>
        <p>次は「{nextText(task)}」から。</p>
      </div>
      <button className="primary wide" disabled={busy}>
        続きのメモを保存して休む
      </button>
    </form>
  );
}
export function EditForm({
  task,
  busy,
  save,
}: {
  task: Task;
  busy: boolean;
  save: (fields: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void save({
          title: f.get("title"),
          workUrl: f.get("workUrl"),
          sourceUrl: f.get("sourceUrl"),
          next: f.get("next"),
          stepDone: f.get("stepDone"),
          totalDone: f.get("totalDone"),
          importance: f.get("importance"),
          estimate: f.get("estimate") ? Number(f.get("estimate")) : null,
          needsSubmission: f.has("needsSubmission"),
        });
      }}
    >
      <label>
        課題の名前
        <input
          name="title"
          defaultValue={task.title}
          required
          maxLength={200}
        />
      </label>
      <label>
        作業ページのURL（任意）
        <input
          name="workUrl"
          type="url"
          defaultValue={task.workUrl}
          placeholder="課題ページや、書きかけの文書のリンク"
        />
      </label>
      <label>
        最初にすること
        <input
          name="next"
          defaultValue={nextText(task)}
          placeholder="例：まず問題を1問読む"
        />
      </label>
      <details>
        <summary>もう少し詳しく設定</summary>
        <label>
          ひと区切りの目安
          <input name="stepDone" defaultValue={stepText(task)} />
        </label>
        <label>
          全部終わったときの目安
          <input name="totalDone" defaultValue={task.totalDone} />
        </label>
        <label>
          案内のURL
          <input name="sourceUrl" type="url" defaultValue={task.sourceUrl} />
        </label>
        <label>
          大切さ
          <select name="importance" defaultValue={task.importance}>
            <option value="normal">ふつう</option>
            <option value="high">大切</option>
          </select>
        </label>
        <label>
          かかりそうな時間（分・空欄でもOK）
          <input
            name="estimate"
            type="number"
            min={1}
            max={10000}
            defaultValue={task.estimate ?? ""}
          />
        </label>
        <label className="check">
          <input
            name="needsSubmission"
            type="checkbox"
            defaultChecked={task.needsSubmission}
          />
          提出が必要な課題
        </label>
      </details>
      <button className="primary wide" disabled={busy}>
        変更を保存
      </button>
    </form>
  );
}
