# 自然文受付API

`POST /api/intake` はWebと共通の自然文受付。セッション認証と正しいOriginが必須。公開無認証APIや新しい権限の強いトークンは追加しない。

```json
{
  "text": "9月20日までに経済学レポート。明日の18時に少しだけやる"
}
```

入力は `text` のみ必須。`mode` は `direct`（既定）または `source`。`referenceAt` はオフセット付きISO日時で省略可能。directは未指定なら受付日時、sourceは未指定なら基準不明とする。地域は本人の設定を使用する。元文の発信日時を知っているadapterだけがsourceのreferenceAtを指定する。受付日時と発信日時を混同しない。

例えば2026年9月8日9時（Asia/Tokyo）に受けると、概略は次のようになる（実際はTaskの既存項目も返す）。

```json
{
  "task": {
    "title": "経済学レポート",
    "planAt": "2026-09-09T18:00:00.000+09:00",
    "next": "資料を1つ開く"
  },
  "deadlineCandidate": {
    "kind": "unknown",
    "date": null,
    "confirmed": false,
    "raw": "9月20日までに経済学レポート"
  },
  "startPlan": {
    "value": "2026-09-09T18:00:00.000+09:00",
    "durationMinutes": 20,
    "action": "資料を1つ開く",
    "origin": "requested"
  },
  "needsConfirmation": true,
  "notes": []
}
```

`needsConfirmation` は締切候補の確認要否。着手予定を作れない理由や仮に選んだ時刻は `notes` に返す。保存成功とCalendar同期成功は別。workerが後から同期し、`GET /api/tasks/:id` の `workSync`（着手）と `sync`（期限）で種類別の結果を読める。

## Codex等からの呼出し

本人が認証したセッションcookieを権限600のローカルcookie jarへ用意し、JSONはUTF-8ファイルへ保存する。パスワードやcookieをコマンド本文、ログ、Issueに貼らない。既存のPOST /api/loginを使う場合も正しいOriginとパスワードの安全な受渡しが必要。

```sh
curl --fail-with-body \
  --cookie /private/path/session.cookies \
  --header 'Origin: https://your-task-control.example' \
  --header 'Content-Type: application/json' \
  --data-binary @/private/path/intake.json \
  https://your-task-control.example/api/intake
```

この例のホストを実際のAPP_ORIGINに置き換える。CLIからDBを直接書いて認証を迂回する経路は追加していない。400は不正な入力、401は未認証、403はOrigin不一致。期限や状態を任意に注入する余分なフィールドは拒否する。

作成APIのため同じリクエストを再送すると別課題になる。通信が切れて結果不明の場合は、まずGET /api/tasksで元文・作成日時を照合し、無条件に再送しない。今後自動取込adapterを作る際はsource IDと冪等キーを追加する。

今回の規則は全文の自然言語理解ではない。課題、締切、着手希望は「。」や改行で分けると認識しやすい。複雑な複数課題・取消表現・任意の相対表現は対応外で、保存結果を確認する。スクリーンショット・メール取得・LMSアクセスは今回のAPIに含まない。
