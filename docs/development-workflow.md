# 開発運用

GitHub Issueに目的・判断・詰まり、PRに変更と検証、docsに設計を記録する。公開リポジトリへ個人情報や本番設定を転記しない。

作業branch → PR → CI → merge。default branchへの直接push・force push・管理者bypassは使わない。3回の意味ある試行で未解決ならIssueへ仮説・検証・結果と再開条件を記録しBlockedにする。

## 導入状態（2026-09-08）

- AGENTS.md / CLAUDE.md：導入。
- Issue / PR templates：導入。
- CI：lint・型・自動テスト・build・ブラウザーテスト・本番依存監査を `CI / verify` に定義。初回の実行結果はPRで確認する。
- branch保護：初回CIの実績確認後、PR必須・実際のチェック名必須・force push/削除禁止を設定しreadbackする。未確認段階を設定済みと扱わない。
- Project：既存の開発ProjectへIssueを登録。進捗はIssue/PRでも確認できる。
- ローカル検証コマンドはAGENTS.mdとpackage.jsonを正本とする。

サーバー配置や外部サービスへの実データ書き込みは、GitHubへのソース公開と別の操作。利用者の設定・許可を確認する。
