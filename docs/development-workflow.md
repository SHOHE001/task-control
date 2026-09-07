# 開発運用

GitHub Issueに目的・判断・詰まり、PRに変更と検証、docsに設計を記録する。公開リポジトリへ個人情報や本番設定を転記しない。

作業branch → PR → CI → merge。default branchへの直接push・force push・管理者bypassは使わない。3回の意味ある試行で未解決ならIssueへ仮説・検証・結果と再開条件を記録しBlockedにする。

## 導入状態（2026-09-08）

- AGENTS.md / CLAUDE.md：導入。
- Issue / PR templates：導入。
- CI：lint・型・自動テスト・build・ブラウザーテスト・本番依存監査の `verify` が[初回実行](https://github.com/SHOHE001/task-control/actions/runs/34137815917)で成功。
- main保護：APIで設定後にreadback済み。PR必須、GitHub Actions（app 15368）の `verify` 必須、最新baseとの同期必須、未解決会話の解決必須、管理者にも適用、force push/削除は禁止。個人開発のため他人の承認人数は0。
- Project：既存の開発Projectへ[Issue #1](https://github.com/SHOHE001/task-control/issues/1)を登録し、担当CodexとReview状態をread/write。変更・CIは[PR #2](https://github.com/SHOHE001/task-control/pull/2)で追跡。
- ローカル検証コマンドはAGENTS.mdとpackage.jsonを正本とする。

サーバー配置や外部サービスへの実データ書き込みは、GitHubへのソース公開と別の操作。利用者の設定・許可を確認する。
