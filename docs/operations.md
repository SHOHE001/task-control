# 配置と運用

## 配置前の確認

Gen8のOS/CPU、Node.js 22対応、実行ユーザー、保存ディスク、既存リバースプロキシ・認証、ドメイン/DNS、HTTPS、公開範囲、バックアップ先を実機で確認します。以下はLinux + systemdを選ぶ場合の例であり、既存環境を上書きする指示ではありません。リバースプロキシの既存認証を使う場合もアプリの単一ユーザーログインを維持できます。

1. `/opt/task-control` などの専用ディレクトリへ承認済みcommitを配置する。専用の一般ユーザーを作り、Node.js 22.18以上の22.xを用意する。rootでアプリを動かさない。
2. `npm ci`、`.env.example` を `.env` へコピー。`.env` は所有者のみ読める0600、data/backupsは0700、プロセスのumaskは0077にする。
3. APP_ORIGINを実際のHTTPS origin（末尾スラッシュなし）にする。HOSTは同一ホストのプロキシなら127.0.0.1、PORTは空いている専用ポート、DB_PATHはローカル永続ディスクの絶対パスにする。SQLite WALをNFSなどの共有ファイルシステムへ置かない。
4. `NODE_ENV=production`、`ENCRYPTION_KEY` を `openssl rand -hex 32` で生成し `.env` に設定する（値をIssueやログへ貼らない）。Googleを使わない場合のキー設定は任意。暗号鍵はDBと独立して安全にバックアップする。
5. 同じ実行ユーザーとDB_PATHで `npm run setup`、`npm run migrate`、`npm run build`。ブラウザーの初期パスワードを端末で非表示入力する。
6. Webとworkerを別systemd unitで常駐させる。同じ作業ディレクトリ、同じDB_PATH・環境設定を使う。

## systemd例

`deploy/task-control.service` と `deploy/task-control-worker.service` のUser/Group、WorkingDirectory、EnvironmentFile、ExecStart、ReadWritePathsを実環境へ合わせます。Node/npmのパスは `command -v node` / `command -v npm` で確認してください。既存unitは上書きしません。設定後に管理者が登録・起動します。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now task-control.service task-control-worker.service
sudo systemctl status task-control.service task-control-worker.service
```

ログは `journalctl -u task-control` / `journalctl -u task-control-worker`。秘密・原文をログしない実装です。設定画面のworker最終記録が2分以上古ければ停止やDBアクセスを確認します。Webだけの起動では通知は配信されません。誤ってworkerを複数起動した場合はDBリースが処理の重複を抑制しますが、運用構成は単一workerとしてください。

## HTTPS

既存プロキシを利用するか、管理者が選んだプロキシへ専用vhostを追加します。Caddyなら以下の形が一例です（ドメイン・ポートは実際の値に置き換える）。DNS、証明書取得に必要な疎通、公開範囲を確認してから適用します。

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

本番APP_ORIGINはHTTPS必須。セッションCookieはHttpOnly/Secure/SameSite=Lax、変更APIはOrigin完全一致を検証します。プロキシはOriginを実際のブラウザーの値のまま渡してください。APIキー・OAuthトークンはブラウザーへ渡しません。UI静的ファイルは公開されますが、個人データAPIはすべて認証必須です。

## バックアップ・復元

稼働中DBファイルだけを単純コピーするとWAL中の変更を欠落させるため、必ずSQLiteのオンラインbackup APIを使います。

```sh
npm run backup
# 新しい検証用パスへ復元。既存DBへの上書きは拒否します。
npm run restore -- ./backups/task-control-EXAMPLE.sqlite ./data/restore-check.sqlite
```

`BACKUP_DIR` を別マウント先のディレクトリにすれば別保存先へ退避できます。権限0700と空き容量を確認してください。ネットワーク保存先なら、まずローカルへ完成したバックアップを作り、暗号化された通信で完成ファイルを転送します。例：`rsync -a -- ./backups/backup.sqlite user@backup-host:/private/task-control/`。ホスト、認証、送信先は本人が設定し、このリポジトリのテストは転送しません。

DBバックアップには原文・セッション・Push購読・暗号化したOAuthトークンが含まれます。保存媒体も暗号化し、ENCRYPTION_KEYは別途安全に保管してください。鍵を失うとGoogleは再認可が必要です。保持期間と定期実行時刻は管理者が決め、cron/systemd timerで同じユーザー・環境の `npm run backup` を実行してください。

復元確認は本番workerを接続せず、別の検証用DBで実施します。テストコマンドはバックアップに元データが残ることを確認します。復元した本番データに対して外部連携テストを自動実行しないでください。

本番復旧はWeb/workerを停止し、現行DBとWALを保全してから、新しい復元DBパスをDB_PATHに指定。最初はPush/Google/AIを無効にした環境で内容を確認し、古いセッションの削除とGoogle同期・通知履歴の整合を点検します。通知は1時間以上古ければ省略されますが、直近分は再送され得ます。確認後に連携を戻してください。

## 更新と障害

更新前にバックアップ。承認済みcommitを別ディレクトリへ用意して依存・build・testを実行後、Web/workerを停止して切り替え、migrateして起動します。スキーマ非互換のダウングレードは行わず、旧コードと更新前バックアップを組にして別パスで復旧します。

- 保存失敗：画面の入力を控え、空き容量・DB/親ディレクトリの権限・ロックを確認。成功表示になるまで保存済みとは扱わない。
- worker停止：systemdと設定画面を確認。再起動後の古い通知は履歴で省略/取消を確認する。
- Google失敗：設定とOAuthの有効性を確認し、設定画面から再試行。反映成功までGoogle側の期限は古い可能性がある。
- Push失敗：端末許可、購読、VAPID、HTTPS、workerを確認。404/410の購読は無効化する。再購読して本人がテスト通知を操作する。
- パスワード紛失：現在の初版はCLIでの通常リセットを提供しない。DBを安全に保全し、管理者がユーザー認証レコードとセッションの再設定を行う。固定の復旧パスワードや無認証の再設定ルートはない。
