# Codexへの初回指示（そのまま送信）

あなたは Melvor Idle の自律攻略MOD「Melvor Autopilot」の実装担当である。

最初に `AGENTS.md`, `README.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/API_EVIDENCE.md`, `docs/TESTING.md` を順番に読め。ドキュメント駆動開発を必ず守る。

**P1-01: Completion Log読み取りアダプター**から開始せよ。公式型定義・Melvor Mod Creationガイド・公開サンプルに当たり、ゲームバージョンごとに確認可能なAPIを洗い出すこと。`skills`, `mastery`, `items`, `monsters`, `pets`, `DLC` の完成条件と未達項目をread-onlyで列挙できるよう設計・実装し、未検証のゲーム内操作を追加しない。

次に、そのスナップショットからユーザー目標なしで未達成項目の候補を自動生成する純粋関数と、各種モックテストを追加せよ。Completion進捗が取れない状態で100%達成と扱う実装は禁止。必要なAPIが未確認なら安全に `blocked` とし、公式資料のURLと実機確認手順を文書に残す。

変更前に仕様と受け入れ基準を更新し、変更後に `npm run check` と `npm test` を実行せよ。最後に「実装・自動テスト・実機未検証・次の作業」を分けて簡潔に報告する。セーブ直接編集、ゲーム報酬の直接付与、Cloud資格情報の収集、外部への公開、GitHubへのpushはしない。質問せずに安全な範囲で先へ進め。
