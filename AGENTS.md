# AGENTS.md — Melvor Autopilot

## 0. プロジェクトの最終目的（最優先）
Melvor Idle のキャラクターを**プレイヤーが個別目標を指定しない**状態で観測し、必要な行動を自ら判断し、正規ゲームプレイの操作によって Completion 100% を目指す自律型MODを開発する。開始・停止・緊急停止・ログの閲覧は許可される。目標の手入力を前提にしないこと。

**最終目的を既に実現したと表明してはならない。** 現在の配布コード v0.1.0 は、目標選択の読み取り専用プロトタイプであり、ゲーム内操作は未実装。未検証のAPIを呼んでプレイヤーデータを書き換えないこと。

## 1. 最初に読む文書（必須順）
1. `README.md` — 現状・起動方法・制約。
2. `docs/REQUIREMENTS.md` — 最終機能要件・非機能要件・受け入れ基準。
3. `docs/ARCHITECTURE.md` — 責務と安全境界。
4. `docs/ROADMAP.md` — 実装の優先順位と未解決タスク。
5. `docs/API_EVIDENCE.md` — 検証済みAPIと推測を区別。
6. `docs/TESTING.md` — 実ゲームテストの方法。

## 2. ドキュメント駆動開発ルール
- 実装前に対象ユースケースと受け入れ基準を `docs/REQUIREMENTS.md` / `docs/ROADMAP.md` に明記する。
- ゲームAPI呼び出しの前に `docs/API_EVIDENCE.md` に **関数/プロパティ名、ソースURLまたは実ゲームでの検証方法、対象v1.3.1、検証日、例外時の挙動** を記録する。
- 推測だけでAPIに依存してはいけない。公式Wikiと公式型定義を優先し、次に利用許諾を確認したMODや実環境の観測を使用する。
- 仕様変更は該当するテスト、ドキュメント、コードを同じ作業単位で更新する。
- 1イテレーションごとに `npm run check && npm test` を実施する。ゲーム環境での未実行は未検証と明示する。
- 変更ごとに `docs/ROADMAP.md` のステータスを更新し、次にCodexが取りかかるタスクを具体的に1つ残す。
- ユーザーへの完了報告は `実装済み/テスト済み/ゲーム内未検証/未実装` に分ける。

## 3. 自律動作の基本要件
- ユーザーに「次は何を育てる？」「どのダンジョン？」などの質問を繰り返さず、目的関数に基づき自律判断する。初期設定は開始ボタンのみ。
- Completionを *Base Game* と各DLCに分け、ゲーム内の現在の所持DLC・モード・解放状況を読み取り対象スコープを決定する。未取得DLCを無理に取得しない。
- ゲーム内Completion Logを**正**とし、推測した全スキル99や全アイテム所持を100%の代替定義にしない。
- 解放条件/必要素材/生産レシピ/必要スキル/戦闘条件/ショップ購入/銀行枠/通貨を前提条件グラフとして表現し、循環を検出して別経路を探す。
- 戦略は「Completion進捗増加、将来の作業短縮、所要時間、消費素材、戦闘死亡リスク、信頼性」を評価する。探索にコスト上限を付け、既知の前提条件が確かならLLM不要の決定的プランナーを優先。
- 現在行動が有効なとき、微小な効率差で停止/切替を繰り返さない。クールダウン・ヒステリシスを導入。
- 戦闘の死亡確率を推定できない場合、強敵に自動突入させず非戦闘の代替目標を選択する。Hardcore等の死亡損失が大きいモードは原則戦闘を別途検証する。
- オフライン進行はゲーム機構を利用し、MOD独自のタイマーで報酬を生成しない。復帰時に再評価する。
- 不明な操作は `blocked` にして理由をログへ記録し、次候補へ移る。無限ループしない。

## 4. 安全境界（破ってはいけない）
- 経験値・GP・アイテム・クリアフラグ・Completion数値・セーブ内容の直接改変、チート的な報酬付与を禁止。ゲームが提供する通常のアクションだけを使用する。
- セーブ上書き/削除、Cloudアカウント操作、課金、mod.io公開、GitHub pushはユーザーが明示的に許可するまで実行しない。
- **実プレイの検証前には複製セーブを用意し、開発専用MODプロファイルを使用する。** 別のMODと競合する場合は中止してログを残す。
- MODはデフォルト停止。実行中は常に `停止` 操作が見えること。ユーザーが止めたら再起動しても勝手に再開しない。
- 書き込み操作には `precondition -> operation -> postcondition` の3段階チェックが必要。失敗時は再試行上限を設け、状態があいまいなら停止。
- DOMクリックをAPIに優先しない。既存の公開APIとゲームの通常操作関数を優先し、検証が必要なDOMのセレクタは隔離する。
- 外部へセーブ/認証情報を送らない。ログに認証情報やセーブ文字列を含めない。
- v0.1.0 は**解析のみ**。実行に見えるボタン名、README、リリース名で誤認させない。

## 5. アーキテクチャの変更目標
`GameAdapter(read only) -> StateSnapshot -> CompletionScanner -> CandidateGenerator -> PrerequisiteGraph -> Planner -> RiskGuard -> ActionExecutor -> ResultVerifier -> Journal`。

- `GameAdapter` が外部の `game` グローバルを扱い、ドメイン層に外部オブジェクトをそのまま渡さない。
- `Planner` は純粋関数。固定したスナップショットに対して常に同じ結果を返すこと。
- `ActionExecutor` は明示的な許可済み操作だけを行い、未検証操作を既定で拒否する。
- 再実行に強い（idempotent）タスクID、チェックポイント、長時間進行ログを持つ。
- パフォーマンス: 進行確認の重い全探索を毎tickで実施しない。観測を軽量にし、局所再評価とキャッシュを用いる。
- 追加依存は必要最小限。ローカルGPU、LLM API、サーバーを必須にしない。Windows + Node.jsで開発可能。

## 6. 最初の実装タスク
**`docs/ROADMAP.md` の P1-01（Completion Log読み取りアダプター）** から開始する。ゲーム環境を持たない場合は、公式型定義/実例を調査し、モックテストを追加したうえで「実機未検証」を残し、推測コードを有効化しない。

完成したときの定義: Base Game/DLCの各Completionカテゴリの未達成項目をゲームの実データから列挙でき、その取得可否がテスト可能で、既存セーブを変更しないこと。

## 7. 参考資料
- Melvor Idle Mod Creation（公式Wiki）: https://wiki.melvoridle.com/w/Mod_Creation
- Mod Context API（旧案内、公式Wikiへの移転告知あり）: https://mod.io/g/melvoridle/r/mod-context-api-reference
- Melvor公式型定義: https://github.com/GamesByMalcsPtyLtd/Melvor-Typing-Project
- Modサンプル: https://github.com/CherryMace/melvor-mod-fatebreaker
- Progression Guide: https://mod.io/g/melvoridle/m/progression-guide
- Action Queue: https://mod.io/g/melvoridle/m/action-queue
- Queue-o-Matic: https://mod.io/g/melvoridle/m/queue-o-matic
- Melvor source / MCP helper（非公式・導入任意）: https://github.com/lbr88-labs/melvor-game-source-tools
- 外部GPLコード等をコピーする場合は著作権表示・ライセンス義務を事前確認。不要なまるごとコピーは禁止。
