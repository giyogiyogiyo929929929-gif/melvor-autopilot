# Melvor Autopilot

Melvor Idleを「目標指定なし」で自動判断し、ゲームの通常の進行を通じてCompletion 100%を目指すMODプロジェクト。

> **現在のv0.1.0は完成品ではありません。** 解析専用プロトタイプです。Completionの読み取りと未達候補の生成はモックで検証済みですが、v1.3.1実機未検証のため配布UIからのゲームAPI読み取りは無効です。解析開始時は理由付きで `blocked` を表示します。プレイ操作と100%自動クリアは未実装です。

## ファイル
- `AGENTS.md` — Codexに与える作業規約。ドキュメント駆動・安全性・目標・開発順序。
- `docs/REQUIREMENTS.md` — 最終機能と検証条件。
- `docs/ROADMAP.md` — 優先実装タスク。**P1-01から開始**。
- `docs/ARCHITECTURE.md` — 完成時の設計、現在の範囲。
- `docs/API_EVIDENCE.md` — API出典と実機確認ステータス。
- `docs/TESTING.md` — モックテストと実ゲームテスト。
- `docs/ACCEPTANCE.md` — P1〜P5の受け入れ表、実機準備の状況と必要な証拠。
- `manifest.json` / `setup.mjs` — MelvorのMOD原型（read-only）。
- `tests/completion.test.mjs` / `tests/ui.test.mjs` — Completion・候補生成・停止UIのモックテスト。
- `src/prerequisites.mjs` / `tests/prerequisites.test.mjs` — 前提条件のAND/OR分解・代替経路・循環検出・探索上限の純粋ロジック。人工データ専用で配布UIには未接続。
- `src/planner.mjs` / `tests/planner.test.mjs` — 人工見積りで候補を評価する純粋Planner。前提作業の選択、信頼性/死亡リスク判定、クールダウン/ヒステリシスをモック検証。配布UIには未接続。
- `src/resources.mjs` / `tests/resources.test.mjs` — 在庫/ロック/通貨/銀行枠/全装備セット/現在と一時停止の行動を切り離したスナップショットにするモック専用アダプター。配布UIは未接続。
- `src/executor.mjs` / `tests/executor.test.mjs` — 木こりの3段階検証・二重操作拒否・停止/timeout競合を人工portで試験する基盤。実ゲーム操作入口は無条件拒否、配布UIは未接続。
- `src/monitor.mjs` / `tests/monitor.test.mjs` — 作業終了・対象の停滞・素材/通貨/銀行不足・手動介入・オフライン復帰を判断する純粋監視器。木こりの所有確認停止とモックで接続。
- `src/snapshot-validation.mjs` — 資源観測のフラグと実データの形/集計を検査する共通ガード。
- `src/quantities.mjs` / `tests/quantities.test.mjs` — 人工レシピの生産回数/素材予約/通貨/銀行容量を計算する純粋基盤。実ゲームのレシピ構築は未実装。
- `src/quantified-planner.mjs` / `tests/quantified-planner.test.mjs` — Completion候補/前提グラフ/数量/効用/監視を人工bindingで接続。数量不足の候補を除外し、生産作業と終了条件を自動生成。配布UIと実ゲームは未接続。
- `src/production-catalog.mjs` / カタログ各テスト — 木こり/鍛冶/採掘/釣り/料理と5種のArtisan生産を観測するモック専用adapter。基礎値・修正値・代替素材・ポーション段階・召喚markを分ける。Herbloreの製品対応は未検証として保留し、保証効果/全副産物は未確認なので生成draftはPlannerが拒否。
- `src/farming-observation.mjs` / `tests/farming-observation.test.mjs` — 農業の区画/作物/種/肥料/成長timer所属を切り離すモック専用reader。選択と植付、基礎/修正コストを分け、成長・成熟・枯死から報酬や銀行在庫を生成しない。通常入口は無効。
- `src/shop-observation.mjs` / `tests/shop-observation.test.mjs` — 購入回数/要件/価格形式/数量制限/1回分quoteを分けるモック専用reader。未知条件を購入可能とせず、購入・銀行容量・在庫・Completionを投影しない。通常入口は無効。
- `src/shop-prerequisites.mjs` / `tests/shop-prerequisites.test.mjs` — shop観測から購入回数・スキル条件・AND依存を生成する純粋変換。観測矛盾と現在未達の循環を検出し、全evidenceをunknownにして操作へ昇格しない。
- `src/production-prerequisites.mjs` / `tests/production-prerequisites.test.mjs` — 未達Completion itemsと生産観測から、製品のOR経路/素材とスキルのAND構造を生成。代替素材とnominal/observedコストを分け、所持・保証収量・回数・時間を補完しない。共通の反復SCCで閉路を診断する。
- `buildItemAcquisitionGraph` / `tests/item-acquisition.test.mjs` — 生産と通常itemのshop入手経路を統合。新規購入はcount条件と別ノードにし、購入済みでも在庫へ足さない。条件/支払素材から関連経路を展開し、全operation evidenceはunknown。
- `src/observation-frame.mjs` / `tests/observation-frame.test.mjs` — 既存5 readerを同じ人工contextで束ね、ヘッダーの整合、部分失敗、Completion監査、調達構造をまとめる。原子的観測を保証せず、通常入口は無条件拒否。
- 観測フェーズ: planning時に5 readerと重い解析、monitoring/offline時は資源とCompletionを観測。taskのtargetsがある場合はCompletionも対象に限定する。未走査stageはdeferred/nullで、旧解析は再利用しない。実機の観測/イベント/cacheは未接続。
- `src/completion-targets.mjs` — active taskのCompletion条件をID lookupで読むモック専用reader。monitoring frameへtargetsを渡した場合は全Completionを走査せず、別DTOとして対象/カテゴリ最大数を監視する。部分観測から全体100%は判定しない。
- `src/resource-targets.mjs` — taskの素材/出力/在庫条件/通貨だけをID lookup/getQty/lock membershipで観測するモックreader。全銀行の枠数と部分在庫を分け、monitor専用guardへ接続。数量planner/操作pre/postの全観測には流用しない。
- `src/action-selection.mjs` — active/paused/idleと木こりの対象集合を別に観測し、手動選択変更のmonitorへ接続。primary productだけの出力証拠はunknownで、executorの安全確認へ昇格しない。通常入口は無効。
- `src/noncombat-selection.mjs` — 採掘/釣り/料理と6 Artisanのraw選択を観測。area/stationとrecipe、Fletching/Summoning variantを分離し、同じrecipeの代替変更もmonitorで検出。追加skillの操作許可はない。
- `src/recipe-effects.mjs` / `tests/recipe-effects.test.mjs` — 保証収量/最大収量・最低/最大消費・時間の境界を検査する純粋モデル。数量計画/監視の素材予約と最初の1操作の銀行ピークに接続。境界の実機証拠は未取得。
- `src/candidate-window.mjs` / `src/local-graph.mjs` / `tests/candidate-window.test.mjs` — 全Completionを維持し、公平な候補窓と必要な前提だけの局所graphを作る。数量Plannerへの接続を2001/5000件の人工データで検証。
- `src/local-catalog.mjs` / `tests/local-catalog.test.mjs` — 大きなcatalogから許可された需要/素材producerだけを取り出す。5001件の人工catalog、OR/循環/局所上限後の次候補を検証。実ゲームの効果根拠は未取得。
- `src/controller.mjs` / `src/controller-record.mjs` — 計画/木こり命令/監視/停止/再観測を人工portで継続する制御と、再開しないcheckpoint/固定理由journal。保存遅延/timeout/停止競合をモック検証。実環境controller/storage接続は無効。
- `src/combat-observation.mjs` / `src/combat-risk.mjs` — 戦闘telemetryのモック読取りと、完全な人工damage/food境界がある場合だけの条件付きguard。実際の死亡確率は不明、実戦は無効。
- `src/completion-audit.mjs` / `src/completion-report.mjs` — 全スコープ/カテゴリの整合監査と、未達・取得失敗・停滞・固定理由の容量制限付きレポート。人工controllerの観測に接続し、全達成のモックでも実機100%を表明しない。配布UIには未接続。
- `CODEX_START.md` — Codexへの最初の指示。

## Codexで開発を始める
1. このフォルダを展開し、VS Codeで開く。
2. Codexをこのフォルダをワークスペースとして起動する。
3. `CODEX_START.md` をCodexに渡す（または下のコマンドを引用）。
4. 変更ごとに `npm run check && npm test` を確認させる。
5. 実ゲームへのMOD導入・テストには自身のMelvor環境が必要。

```text
AGENTS.mdを最初に読み、CODEX_START.mdの指示で開発を始めて。勝手にセーブ編集・公開・pushはしないこと。実ゲームで未確認のAPI呼び出しは無効のままにする。
```

## v0.1.0の試用（任意）
- 先にMelvorセーブのバックアップと複製セーブを用意し、開発専用MODプロファイルでCreator Toolkitを使用する。
- フォルダ/ZIPをローカルMODとして登録し、必要なら再起動。
- ゲーム内右下に「Melvor Autopilot — v0.1.0」が出れば初期化成功。
- `解析開始` → 実機確認待ちの理由を表示、`緊急停止` → 解析停止、`ログ出力` → JSON保存。
- **2026-10-12、Steam版v1.3.1の複製スロットで解析専用UIの起動・初期停止・実機確認待ち表示・緊急停止を確認しました。** Completion読取りAPI/通常プレイ操作は未検証で、読み取りAPIの検証が済むまで「Completion API実機未確認」と表示します。
- `readCompletionForTesting(gameFixture, context)` はテスト専用です。versionとDLC所有情報は人工データで供給します。実ゲーム向けの有効化設定や目標入力はありません。
- Completion候補から前提作業を分解し、人工見積りで次候補と最初の作業を選ぶロジックもモックで検証済みです。素材数量/予約/銀行容量の計算基盤と終了/停滞監視も人工データで検証しています。ゲーム由来の素材数量・レシピ・経路・見積りの自動構築とゲーム操作は未実装です。
- 木こりの命令検証は人工portでのみ確認済みです。テスト用の `operationsVerified` 等をtrueにしても、実環境の操作APIが検証済みになるわけではありません。通常入口では設定に関係なく操作を拒否します。

## 前提
- Node.js 20以降（開発時のテスト用。MOD実行時には不要）。
- Windowsの一般的なPCで構築可能。GPU/LLMや有料APIは不要。
- 公式のMelvor Idle / Mod Manager / Creator Toolkit。

## テスト
```powershell
npm run check
npm test
```

PowerShellで `npm.ps1` が実行ポリシーにより拒否される場合は `npm.cmd run check` / `npm.cmd test` を使用できます。システム設定の変更は不要です。

## 設計の重要点
- ユーザーが個々の目標を指定する機能に依存しない。
- 100%達成判定はゲーム内Completion Logに従う。
- 直接経験値や通貨を増やすなどのチートはしない。
- 未確認の書き込みAPIは無効。戦闘の死亡リスクを抑える。
- 実用的な自律進行はP1以降の開発課題である。
