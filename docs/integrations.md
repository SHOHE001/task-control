# 連携セットアップ

## Web Push / PWA

2026-09-08に公式資料を確認。iPhone/iPadのWeb PushはiOS/iPadOS 16.4以降のホーム画面Webアプリで、本人の操作を契機とした通知許可が必要です。HTTPSと対応ブラウザー、OS側の許可も必要です。[WebKitの説明](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) / [Apple公式手順](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)

1. `npx web-push generate-vapid-keys` を手元で実行し、出力を安全に `.env` のVAPID_PUBLIC_KEY / VAPID_PRIVATE_KEYへ設定。VAPID_SUBJECTは自分で指定した管理用mailtoまたはHTTPS URL。
2. Webとworkerを再起動。設定画面で「配信設定あり」を確認する。
3. iPhoneはSafariでHTTPSのアプリを開いてホーム画面へ追加し、そのアイコンから起動。設定の「この端末で通知を許可」を本人が押す。拒否時は端末設定で許可を見直す。
4. 「テスト通知を予約」を本人が押し、アプリを閉じて通知を待つ。workerが実際のPushサービスへ送信する操作なので、自動テストでは行わない。
5. DB履歴の「送信要求受理・到達不明」と、実端末での到達を別々に確認する。通知を押して認証後にアプリが開くとリンク起動の記録が付く。作業開始や提出とはみなさない。

初版はApple / Google FCM / MozillaのPush endpointを許可します。未知の任意URLへのサーバー送信を防ぐため、他プロバイダーは明示的なコード対応が必要です。通知内容は汎用の行動案内だけで、課題タイトル・原文・再開メモを含みません。サブスクリプションごとに送信結果を追跡しますが、端末の到達・閲覧を検証できない場合は不明のままです。

Service Workerにはfetch handlerを置かず、認証済みデータをキャッシュしません。オフライン編集は初版対象外。アイコンはコードで生成したもので `node scripts/render-icons.mjs` により再生成できます（開発用Chromiumが必要）。

## Googleカレンダー

1. 自分のGoogle CloudプロジェクトでCalendar APIとOAuth同意画面を設定する。Webアプリ用OAuth clientを作成する。
2. 承認済みredirect URIを `APP_ORIGIN/api/google/callback` と一致させる。GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRETと32バイトhexのENCRYPTION_KEYをサーバーの.envに設定する。
3. 設定画面から「Googleの接続を設定」を本人が実行して認可する。認可コード・更新トークンを画面やログへ出さない。更新トークンはAES-256-GCMでDBへ暗号化保存する。
4. 専用カレンダーを明示的に新規作成するか、自分が所有する専用カレンダーIDを指定し確認する。メインカレンダーは拒否する。設定直後からworkerが確認済み期限を同期するため、テスト用タスクのあるDBでは実接続しない。
5. 再同期後も同じ予定IDで更新されることを本人の実データを扱う許可範囲で確認する。同期先を後からUIで変更することは初版では禁止している。

要求scopeは `calendar.app.created`（アプリ作成専用カレンダー）、`calendar.events.owned`（指定した所有カレンダーの予定）、`calendar.calendarlist.readonly`（メイン/所有権判定）。更新トークンが期限切れ・失効した場合は認可をやり直す。OAuth同意画面のテストモードではGoogle側の更新トークン制限にも注意する。

原文は送信しません。タスクタイトル、確認済み期限、管理用識別子を送信します。日付のみの予定は翌日をexclusive endとする終日予定で「時刻未確認」と表示。リマインダーは既定値も含めて無効です。[Google Events insert仕様](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)

固定予定IDとprivate所有マーカーで管理対象を識別します。Googleでの変更は取り込まず、アプリからの変更時に上書きします。無関係な予定は更新・削除しません。確認済み期限を不明/なしへ変更したときは管理している予定のみ削除します。アプリで完了した課題の確認済み期限は履歴としてカレンダーに残します。

自動テストではfake providerに対して、二重作成防止、削除、エラー表示を確認します。Google実接続の成功や実機での到達とは別の検証です。

## 任意の外部AI

AI_ENDPOINTはOpenAI互換chat/completionsの完全なHTTPS URL、AI_MODELは契約した接続先のモデル名、AI_API_KEYは必要ならサーバーの.envへ設定します。特定ベンダーや有料契約は必須ではありません。実際の互換性・利用料金・データ保存条件は選んだ接続先で確認してください。

設定画面の説明に同意して有効にし、タスク詳細で候補ボタンを押したときだけタイトル・原文・次の一手・再開メモを送ります。候補採用も本人の操作です。認証情報はブラウザーへ渡しません。APIが返すJSONを検証し、引用が原文にない場合やエラー時はテンプレートに戻ります。日付や完了状態を書き換えるツールはAIへ渡しません。
