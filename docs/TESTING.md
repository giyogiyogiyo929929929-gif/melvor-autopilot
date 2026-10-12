# テスト計画

## 1. 自動テスト（実行可能）
Windows PowerShell:
```powershell
node --version
npm run check
npm test
```
現在の自動テストは `setup.mjs` のテスト専用アダプター・純粋候補生成とUIライフサイクルのモック検証。人工フィクスチャを使用し、実セーブは含まない。ゲームのロードや実際のAPIが動いた保証ではない。

PowerShellの実行ポリシーでnpm.ps1が拒否される環境では `npm.cmd run check` と `npm.cmd test` を使用する。

### P1-01 回帰テスト
- 5カテゴリ×Base/TotH/AoD/ItA、通常/abyssalのレベル分割、Baseのdemo/full名前空間、未解放・現在上限制約。
- 未所持DLCの除外、所有不明のblocked、通常/Hardcoreの戦闘拒否。
- 発見済みだが銀行にないアイテム、Completion除外フラグ、MOD項目の除外。
- 未知バージョン/モード、欠落/例外/不正な数値やフラグ/重複ID/集計不一致。例外本文を出力しない。
- 完全達成の人工データ、全スキル達成でも残る項目、部分取得、空データでの誤達成防止。
- 固定スナップショット/レジストリ順序変更の決定性、ゲームデータのfreeze下での無変更、外部オブジェクトの切り離し。
- 配布経路がゲームgetterに触れないこと、UI初期停止・二重開始防止・緊急停止・再読込後の停止維持。

### 今回の実行記録（2026-10-11）
- Windows / Node.js v24.18.0。
- `npm.cmd run check`: 成功。
- `npm.cmd test`: 24件成功、失敗0件。
- `npm` のPowerShellラッパーは実行ポリシーで拒否されたため、同じnpmスクリプトをnpm.cmdで実行した。ポリシーは変更していない。
- 実ゲーム、Creator Toolkitでのロード、Completion UIとの照合、実セーブ複製での無変更確認: 未実施。

## 2. 実機テスト（P0 UIのみ一部確認、ゲームAPIは未検証）
### P0導入準備/manifest修正（2026-10-12）
- Steam版v1.3.1。元/複製スロットの通常download出力をprivate領域へ退避、各35,812 bytesのローカルSHA-256比較は一致。内容/ハッシュ値は出力しない。
- `Melvor Autopilot Dev`で既存11MODをすべて無効化。ユーザー許可後に公式Creator Toolkit v1.3.0を導入し、複製スロット2をロード/同期。元スロット1は未ロード。
- 実機で`melvor`接頭辞namespaceの拒否を確認し、manifestを`autopilot`へ修正。ZIPはmanifest/setupの2件だけで、双方のソース一致を確認。古いFile参照のread errorは新しいZIP名で登録し直して解消。
- 修正後`npm.cmd run check`成功、`npm.cmd test`559件成功/失敗0件。ゲームのCompletion/資源getter、通常プレイ操作、P5受け入れは未検証・未実施。
- 実機のpre logは暗く読めず、色指定だけの更新でも改善を確認できなかった。最終ソースは明るい色のdivへ変更。既存登録のUpdate Modfile経路で反映を確認できなかったため、旧登録を無効化して最新ZIPを別登録。最新登録では初期化/開始/拒否理由/手動停止のログを視認できた。更新反映の原因は未確定として残す。
- Toolkit再読み込み後と通常アプリ終了→再起動→複製ロード後に解析非再開を確認。最新登録でも初期停止→開始→Completion API実機未確認→緊急停止を確認。停止操作は常に表示されていた。ゲームの通常行動を開始していない。
- ログ出力JSONを新規保存。app/version/logsのみ、4件のtimestamp/message、初期化→開始→runtime-adapter-unverified→手動停止の順序を検査し、`reports/p0-ui-2026-10-12.json`へコピー。保存dialogの編集fieldは操作機能がキャッシュ不可と返したため、既定ファイルが未存在と確認してAlt+Sで保存した。上書きなし。
- 最終ソースのcheck成功/test559件成功。`dist/melvor-autopilot-local-mod.zip`と実機登録用`melvor-autopilot-v0.1.0-log-fixed.zip`はmanifest/setupの2件だけでソース一致を確認。バックアップは含めない。最終UIは停止中。P1〜P5の実機受け入れは未完了。

- 正規Melvor Idle v1.3.1。**まず元セーブをエクスポートし複製**、専用MODプロファイルを使用。
- Mod ManagerのCreator Toolkitでルートの `manifest.json` を持つフォルダまたは配布用ZIPを読み込む。
- UI右下の `Melvor Autopilot — v0.1.0` を確認。
- `解析開始` を押して「Completion API実機未確認」/理由付きblockedが現れるか、ログをJSONで書き出せるかを見る。今回の配布経路では実ゲーム候補は生成しない。
- スキル経験値・在庫・GP・戦闘対象の変化が**発生しない**ことを確認。
- `緊急停止` 後、提案が更新されないことを確認。
- ゲームを再起動し、自動で解析/操作が始まらないことを確認。

## P2前提条件グラフの回帰試験（2026-10-11）
- `tests/prerequisites.test.mjs`: 直列/AND/OR、共通前提の重複防止、自己/相互循環と代替経路、探索経路ごとの判定、最短推定時間とID順の決定性。
- 不明事実/経路/時間/リスク/所持、Hardcore/不明モードの戦闘拒否、欠落ノード、重複ID、不正値、時間オーバーフロー。
- 深さ/ノード/経路/前提/探索回数/診断件数の上限。全探索不能な部分結果は破棄。
- Completion候補の自動接続、候補とグラフの達成/スコープ矛盾、候補数/総予算、個別予算切れ後の次候補への移行。
- 入力をfreezeしても解析でき、出力変更が入力へ反映されない。ゲームAPIを有効化せず、全計画のrunnableがfalse。
- 続行イテレーション: `npm.cmd run check` 成功、`npm.cmd test` **52件成功、失敗0件**（前回24件から追加28件）。最初の実行で不正値ケースのフィクスチャが既定値を使ってしまう問題を修正し、再実行で成功した。
- Windowsネイティブ操作機能に接続できず、接続ブラウザーもないため実機照合は未実施。これはゲーム内検証の代替ではない。

## P2純粋Plannerの回帰試験（2026-10-11）
- `tests/planner.test.mjs`: **27件追加**。手入力目標なしの候補/最初の前提作業の選択、効用の各項、同点/順序変更、共有前提の時間と消費の重複防止。
- 確認済みの人工見積りのみ使用。欠落/未確認/不正値/重複ID/経路変更後の古い見積り/合計Completion増分不正を拒否。信頼性下限と死亡確率上限の集計、安全性を効用で相殺しないこと、Hardcore/未知リスクのフォールバック。
- 候補数/総探索上限で部分順位を破棄、個別探索失敗では次候補を検討。現在作業への最小継続/クールダウン/ヒステリシス、閾値境界と負スコア、反復再評価、開始時刻の維持。
- 現在候補の達成/未知/危険時に継続制約を解除、前提作業完了後の次作業、別候補で同じ作業を継続するときの時刻維持、全候補不可で状態をクリア。時刻逆行・不正な設定と見積り件数上限を拒否。
- freeze入力の無変更、入力/選択/評価一覧の分離、例外内容の秘匿、既存配布アダプターがゲームgetterを参照せずblockedを維持すること。
- `npm.cmd run check`: 成功。`npm.cmd test`: **79件成功、失敗0件**。最初の実行は切替境界テストのみ失敗（0.55×100の丸め誤差）。ヒステリシス比較にスコア規模に応じた許容幅を追加し、全テストの再実行で成功。
- ゲームAPIの追加・有効化、実ゲーム/Creator Toolkitの試験、セーブ変更は行っていない。見積り精度・ゲーム内安全性・実プレイ進行は未検証。

## 3. 将来の操作機能の安全テスト
### P1-02資源観測（2026-10-11）
- `tests/resources.test.mjs` 18件追加。空/通常/満杯/超過銀行、在庫ロックと未所持ロックID、MOD/DLC在庫、小数通貨、複数セット、占有枠、active/paused/idle。
- 版/モード/Raidゲート、部分例外、不正数値/ID/boolean、重複ID、Map/Set/占有数矛盾、占有参照の欠落/循環/空root、コレクション上限、順序の決定性・freeze・入力/出力分離を検証。
- `npm.cmd run check` 成功、`npm.cmd test` **97件成功、失敗0件**。通常入口がゲームgetterに触れないことを検証。実機検証は未実施、型宣言/モックだけで有効化しない。

### P1-03木こり検証基盤（2026-10-11）
- `tests/executor.test.mjs` 23件追加。runtime拒否/既定停止/sessionゲート、3段階確認、同じ木のtoggle抑止、既存の手動行動を停止対象にしないこと、重複ID/対象競合/再開後のcheckpoint維持。
- 別行動/別木/一時停止/残る選択/未解放/不明資源/未知副産物/最悪銀行枠を拒否。readは最大2回、selectは最大1回。自然な在庫増加を許可し、通貨/装備/在庫減少/モード/解放変更を拒否。
- operation例外/timeout、停止中のpre読取りと遅延mutation、並行受付/再開拒否、遅延完了後の所有確認cleanup、別行動非干渉、stop不可/false/例外/事後失敗、checkpoint上限、入力/出力分離を確認。
- `npm.cmd run check` 成功、`npm.cmd test` **120件成功、失敗0件**。実ゲームのselectTree/stopは一切呼んでいない。テストportは人工fixtureだけを更新する。
- 実機環境の確認: Windows操作機能とSteamライブラリは利用可能。ユーザー入力検出により起動クリックは拒否され、ゲームwindowは未確認。ユーザー回答で複製セーブと開発プロファイルは未準備。入力を続行せず、実プレイ検証は未実施。

### P1-04進捗監視（2026-10-11）
- `tests/monitor.test.mjs` 26件とCompletion entries回帰1件を追加。AND終了条件、5カテゴリ/skillId/abyssalトラックの明示対象、部分/ゼロ/対象消失/集計/重複/missing矛盾を確認。
- 対象だけの進捗時刻、停滞/最長時間の境界、進捗逆行、必要素材/ロック/少数通貨/不明通貨/銀行新規枠、手動action/selection/装備/一時停止、時刻/session/モード/分母/仕様変更、offline復帰/観測空白、terminal非再開を確認。
- 共通資源ガードの不正supported入力、上限、freeze、checkpointの参照分離/余分なnestedデータ非コピー、例外内容の秘匿。木こり人工portとの接続で完了/停滞停止と手動別行動への非干渉を確認。
- `npm.cmd run check` 成功、`npm.cmd test` **147件成功、失敗0件**。配布の読取りは無効、実ゲームイベント/軽量観測/実セーブ試験は未実施。

### P2素材数量（2026-10-11）
- `tests/quantities.test.mjs` 20件追加。切上げ生産回数/余剰、既存在庫/合算需要、前提素材の一時予約と最終予約の保護、複数出力、OR前提時間/同点、失敗分岐の投影巻戻し。
- 循環/自己消費/未知根拠/未所持/未解放/リスク/変動コストの拒否、保護素材、少数通貨/不明通貨、確定消費後の空き枠、未保証副産物の非供給と後続の銀行枠保持。
- 不正数量/集計overflow/レシピshape/重複/各探索上限、全探索失敗の部分投影破棄、順序/freeze/入力と投影の分離を検証。
- `npm.cmd run check` 成功、`npm.cmd test` **167件成功、失敗0件**。数量計画のPlanner/監視接続と実ゲームのレシピ観測は未実施。
- 配布ZIPを更新し、entriesがmanifest.json/setup.mjsの2件だけで各SHA-256が現在のソースと一致することを確認。srcの監視/数量/操作モジュールは含めず、解析専用入口を維持。package.ps1は署名ポリシーで拒否されたため同じCompress-Archiveを直接実行し、システム設定は変更していない。

### P2数量Planner/監視接続（2026-10-11）
- `tests/quantified-planner.test.mjs` 21件とpossible銀行枠の不正値1件を追加。自動候補→graph→数量→効用→監視→木こりの所有確認停止を人工portで一貫検証。
- 実時間/コスト/信頼性の回数反映、素材不足/不明binding/資源効果/誤った最終需要の除外、追加生産/既存前提の省略、段階をまたぐ未保証副産物容量、ORの操作根拠拒否と別レシピへの移行。
- 総/個別数量探索とコンパイル上限、同じactionの継続時刻、planEpochによるtask IDと旧checkpoint拒否、固定消費後生産の監視容量、所持とCompletionの混同拒否、順序/freeze/選択と投影の分離/例外秘匿。
- 長い合成IDの試験で最初のfixtureが1024文字に達していないことを修正後、既存graphのnode ID上限に達する不整合を検出。node/target/前提IDを16384、元のroute/item/action IDを1024、監視/実行命令IDを16384に分離し、統合試験で確認。
- 最終 `npm.cmd run check` 成功、`npm.cmd test` **189件成功、失敗0件**。実ゲームcatalog/binding/コスト保存の保証、runtime controller、実機の動作とP5長時間検証は未実施。配布UI・実操作は引き続き無効。

### P3木こり/鍛冶カタログ（2026-10-11）
- `tests/production-catalog.test.mjs` 18件追加。nominal/観測時間/修正後コスト/少数通貨/保存/倍化を区別、DLC所有/不明/MOD除外/追加要件/ロックを確認。
- 未知版/context/Raid/モードの先行ゲート、個別/skill例外、空/重複/欠落/不正値/各上限、名前空間矛盾、順序/freeze/入力とdraftの参照分離を確認。
- reward/selectedRecipe/数量乱数helper/選択/create/consume/セーブ/認証getterを参照しないこと、保存/倍化ゼロでも効果を確定しないこと、生成draftの数量Planner拒否を確認。
- `npm.cmd run check` 成功、`npm.cmd test` **207件成功、失敗0件**。型宣言のみでは保証yield/全副産物/キャッシュ副作用/操作安全性を証明できない。実ゲームAPIは呼んでいない。
- liveアプリ一覧を読み取り確認したがMelvorのgame windowはなく、Steamのみ確認。画面入力・ゲーム起動・セーブ/プロファイル変更は行っていない。実機/長時間P5検証は未実施。

### P3効果境界（2026-10-11）
- `tests/recipe-effects.test.mjs` 17件とCompiler統合1件追加。固定/変動境界の整合性、未知証拠/欠落/ID矛盾/非有限/逆転/固定ラベルの不整合を拒否。
- 最大消費/保証最小出力の素材/通貨予約、upper投影、保存で空かない銀行枠、固定batchの途中容量不足、倍化余剰の供給非使用、依存/段階の上限引継ぎとOR代替を検証。
- 上限overflowと誤ったcontext、少数通貨最低消費、monitorの最大用意/最低枠解放、freeze/参照分離を確認。未保証の追加数量があるIDを数値upperItemsとして返さないことも確認。
- 最終 `npm.cmd run check` 成功、`npm.cmd test` **225件成功、失敗0件**。元の207件も成功。新規ゲームAPIなし、実際のmodifier/全副産物/上下限/通常操作とP5長時間検証は未実施。

### P2/P4候補窓とlocal graph（2026-10-11）
- `tests/candidate-window.test.mjs` 18件追加。2001候補/graphで従来上限を越える入力を窓化し、41窓以内に末尾の有効数量候補へ到達。5000件のgraph/binding/estimateでも必要部分だけを評価し、全Completionを保持することを確認。
- 固定集合の公平性/current保持と非飢餓/削除bookmark/順序、局所node上限後の次候補、完了/未確認/未所持/危険/Hardcore routesの非展開、共有/循環/深さ/欠落を確認。
- 不正/重複/集合/カーソルoverflow/局所制限、freeze/参照分離、unknown/空データで誤達成なし、scopeブロッカーの保持と256件のsanitize、総探索不足で部分plan破棄と窓位置の保持を確認。
- 最終 `npm.cmd run check` 成功、`npm.cmd test` **243件成功、失敗0件**（225件から18件追加）。実機/巨大catalog/長時間P5受け入れは未実施。配布・実操作のゲートは無効を維持。

### P3巨大catalog局所化（2026-10-11）
- `tests/local-catalog.test.mjs` 17件追加。5000件の不要レシピを除外して必要producerを使うこと、AND/OR/共有/循環、allowed範囲、未確認/未所持/未解放/危険/action未確認の非展開を確認。
- 無関係なコスト/time/action bodyのgetter非参照、関連例外の隔離/秘匿、未保証副産物の非供給、既存stockだけの需要充足、重複需要、不正stock、depth/recipe/global集合/producer調査上限、固定/上下限の維持、freeze/順序/DTO分離を検証。
- window付きCompilerで5001件のcatalog/action入力を処理し、別候補のlocal recipe上限後も有効候補を選ぶ統合試験を実施。
- 最終 `npm.cmd run check` 成功、`npm.cmd test` **260件成功、失敗0件**（243件から17件追加）。実ゲームの効果根拠・通常操作・P5長時間試験は未実施。配布とruntimeゲートは無効を維持。

### P4継続制御/checkpoint/journal（2026-10-11）
- 記録8件/controller24件、合計32件追加。runtime拒否、既定停止/session条件、候補→命令前保存→monitor→所有停止→新観測、未対応操作の事前除外、有効作業の継続と重複抑止を確認。
- 停止後/途中命令の別instance復元、epoch/watermark圧縮、offline復帰/session放棄/clock逆行/停滞/窓数/step上限、手動停止中のobserve/初期化/命令前保存/遅延mutation、store timeout後の書込順序を確認。
- store/observe/cleanup失敗、例外秘匿、schema/byte/sequence/duplicate/epoch、不明理由の拒否、ログ集約/回転とledger維持、余分なデータ非保存、出力分離を検証。
- 初回の統合で停止済みexecutorを次命令前に再開していない不整合を検出・修正。停滞fixtureは観測空白の境界を踏んでいたため中間観測を追加し、停滞と空白再評価を区別した。
- 最終 `npm.cmd run check` 成功、`npm.cmd test` **292件成功、失敗0件**。実環境storage/atomicity/Mod Context接続、他スキル・戦闘・P5長時間/全Completion受け入れは未実施。通常controllerも無条件拒否。

### P4戦闘観測/境界guard（2026-10-11）
- `tests/combat-risk.test.mjs` 18件追加。runtime/context/版/dirty先行ゲート、敵identity/部分例外/food/攻撃/効果のshapeと件数、setter/compute/攻撃/eat/保存非参照を確認。
- 完全な人工coverage、HP/thresholdの厳密境界、多段burst/DoT等不足、Hardcore/不明mode、stale/変更signature/敵/type、選択食料とhealing/frequency/horizon/packet上限、zero damageでもcoverage要求を検証。
- 根拠のないsafe combatのunknown化とnoncombat fallback、model-onlyなgraph判断、freeze/出力分離を確認。modelSafeでもactualDeathProbability=null、runtimeAllowed/runnable=false。
- 最終 `npm.cmd run check` 成功、`npm.cmd test` **310件成功、失敗0件**（292件から18件追加）。キャッシュ副作用/実際のAuto Eat/全攻撃効果/食料境界/実死亡確率/実戦とP5受け入れは未実施。

### P5全Completion監査/停滞report（2026-10-11）
- `tests/completion-report.test.mjs` とadapter/controller統合試験を追加。4スコープ×5カテゴリ、公式scope率、全達成のmock/実機未検証の区別、未所持getter非参照/所持不明/空/部分/重複/集計やmissing矛盾/通常・abyssal・mastery IDを検証。
- 進捗/閾値ちょうどの停滞、mode/分母/所有/逆行/offline/観測空白の基準更新、不正checkpoint、固定理由/secret非コピー、UTF-8容量にcheckpointも含むこと、freeze/決定性/元snapshot保持を確認。
- controllerの直近step理由を含むgetReport、再開/session変更時の基準破棄、記録codecへreportやsnapshotを保存しないことを確認。配布UI/実ゲーム/全Completion/実時間での長期受け入れは未実施。
- 最終 `npm.cmd run check` 成功、`npm.cmd test` **344件成功、失敗0件**（310件から34件追加）。新規ゲームAPI、セーブ操作、公開、pushなし。

### P5長時間の人工統合シナリオ（2026-10-11）
- `tests/controller.test.mjs`: 3件追加。240未達候補をwindow付き数量Plannerから自動選択し、命令前保存→対象監視→所有停止→再観測を反復。命令ID/対象各240件重複なし、epoch 1〜240を確認。
- 仮想offline7日間は停止/新規命令/報酬生成なし。人工fixtureが供給した復帰観測を再評価。60/120/180作業後に手動停止して別controllerへ復元し、3回とも明示start前は観測/操作しない。
- ledger上限3、journal上限12件/2048 UTF-8 bytesを反復し、retiredThrough>=237、journal dropped>0を確認。保存するのは狭いcontroller記録だけで、全snapshot/report/レポート用進捗checkpointは保存しない。各reportは65536 bytes以内、全未達数を保持。mock全達成でもactualComplete=false。
- 240件すべて見積り不明の6窓は有限停止、未達240/例100/省略140を維持。銀行5枠で5作業を完了後、残り7項目を保持して無操作停止。実ゲーム銀行整理/不足自動調達が実装済みという意味ではない。
- `npm.cmd run check` 成功、`npm.cmd test` **347件成功、失敗0件**。この実行のテスト全体は約21秒、仮想時間の7日超を実時間耐久性の証拠にしない。
- 実機準備の再確認: live app一覧にSteam、Melvor windowなし。Steam検索欄のclickはuser input検出で拒否、再観測は別appが前面。以降の画面入力を中止し、ゲーム起動/セーブ/プロファイル操作は行っていない。
- [受け入れ表](ACCEPTANCE.md) に準備状況と要件別の実機証拠を整理。実機/実時間/P5全体の受け入れは未実施。

### P3採掘/釣り/料理カタログ（2026-10-11）
- `tests/gathering-cooking-catalog.test.mjs` 19件追加。既定5スキル/人工subset、鉱石のHP/復活/レベル可否/店/mastery/gem、魚とareaの登録参照/所属/装備/秘密/POI/確率/時間範囲、料理station/upgrade/perfect/成功/cost/stockpileを確認。
- 不明/未所持/MOD対象の非展開、関連getter非参照、スキル間/recipe/passiveの例外隔離、不正scalar/chance/interval/collection/registry、frozen循環参照と順序/出力分離を検証。報酬/乱数/HP変更/選択/調理/収集/保存/timer bodyは参照しない。
- 成功100%でもdraftがquantity plannerに拒否される統合を確認。初回失敗は資源fixtureの通貨registryが空だったためで、GP観測を追加し前提がsupportedであることを検査して修正。HPと返却chanceを一度だけ読み、検査値と出力値が一致することも確認。
- `npm.cmd run check` 成功、`npm.cmd test` **366件成功、失敗0件**（347件から19件追加）。公式mainの宣言のみでv1.3.1実機は未検証。通常入口の無効、planningReady/runnable=false、draft unknownを維持。実ゲーム/セーブ操作なし。

### P3共通Artisanカタログ（2026-10-11）
- `tests/artisan-catalog.test.mjs` 18件追加。5追加スキルの基本コスト/修正値/category、Fletching代替コスト/multiplier/raw設定、Runecrafting subcategory/水combo、Herblore ordered potions/raw tierと製品不明、Summoning mark/素材候補/選択/候補別コストを検証。
- 既定10スキルの混在、未所持/MOD/不明DLCの非展開、関連categoryの登録/参照/所有、欠落/例外/不正scalar/集合上限、順序/freeze/DTO分離を確認。activeRecipe/選択/create/乱数/mark discovery/XP/保存は参照しない。
- HerbloreをunresolvedDraftsへ分離し、4 potionを同時出力にしない。Fletching/Summoning設定欠落はnullで、勝手な素材選択/既定0への補完はない。すべての数量/効果/操作根拠はunknownを維持。
- `npm.cmd run check` 成功、`npm.cmd test` **384件成功、失敗0件**（366件から18件追加）。実ゲームAPI呼出し、セーブ/プロファイル操作、公開/pushなし。v1.3.1実機/全出力/operation/P5受け入れは未実施。

### P3農業観測（2026-10-11）
- `tests/farming-observation.test.mjs` 20件追加。5 plot state、category/recipe/compost、種/区画解放の基本と修正コスト、selected/plantedの区別、複数timerとMap/Set/所属/状態の整合を検証。
- 未所持/MOD内容getter非参照、未知/所有/DLC/関連参照、部分例外/registry重複/不正数値/件数/UTF-8容量、禁止growth/plant/harvest/reset/compost/unlock/tick/XP/保存/銀行API非参照、順序/freeze/DTO分離を確認。
- excluded timerも所属metadataを照合し、plot観測が不明なら空timerから取得完了を推測しない。plotの秒とhelper raw値を分け、成熟/枯死/空から収穫数量・銀行・Completionを生成しない。
- `npm.cmd run check`（農業モジュールも含む）成功、`npm.cmd test` **404件成功、失敗0件**（384件から20件追加）。実環境のgetters/単位/副作用/成長・収穫・効果/操作/P5受け入れは未検証。実ゲームAPI/セーブ/プロファイル/公開/push操作なし。

### P3ショップ観測（2026-10-11）
- `tests/shop-observation.test.mjs` 18件追加。4価格形式のraw/quote、素材/小数通貨、購入回数とMap照合、limit0/Infinity/cap0、ShopPurchase/SkillLevel/AbyssalLevelとunknown要件を確認。
- 条件の充足と価格見積りを混同せず、empty allowlist/不明mode意味/未登録や未所持の要件参照からcanPurchaseをtrueにしない。未所持/MOD/Raidの内容getterと未知価格/要件のbodyを参照しない。
- 部分例外/不正/重複/件数/UTF-8容量、containsのitems/charges/pet/lootBox/bankTab/stat存在、順序/freeze/DTO分離を検証。参照の所有許可はレコードの観測成否で変えず、価格失敗と並替えから要件観測が変わらない。
- 初回2件失敗は並替え後のfixture配列位置で別purchaseを参照したため。先に対象object/要件参照を保持するようテストを修正し、全再実行で成功。
- `npm.cmd run check`（ショップも含む）成功、`npm.cmd test` **422件成功、失敗0件**（404件から18件追加）。買う/数量変更/価格式/銀行/通貨消費/通知/統計更新/保存は呼ばず、購入・在庫・Completionの投影なし。v1.3.1実機/API副作用/購入/P5受け入れは未検証。

### P2ショップ依存生成（2026-10-11）
- `tests/shop-prerequisites.test.mjs` 20件とshop adapter接続1件、計21件追加。自動roots/AND/直列/共有/回数threshold/通常abyssal、countとmetの矛盾・同一/単調skill条件の矛盾、unknown/要件集計矛盾/未登録/除外を検証。
- 自己/相互/枝が重なるSCC、取得済みcountが循環を切ること、関連要件/価格getterの非参照、2000購入/6000nodeの深い連鎖、queue/group共有、node/edge/要件/byte/diagnostic/入力形状の上限を確認。上限失敗は全graphを破棄。
- 順序/freeze/DTO分離、例外本文非出力、観測met=trueでもexisting Resolverがfact-unconfirmedで拒否することを確認。Game API/価格/在庫/銀行/operationへ変換しない。
- 初回2件の失敗はテスト期待値（辺8に対して実際11、拒否理由node-unconfirmedに対して既存fact-unconfirmed）。コードと既存契約を確認してテストを修正。要件数超過はlocal unknownへの置換ではなく全graph拒否へ修正して再実行。
- `npm.cmd run check`（shop-prerequisitesも含む）成功、`npm.cmd test` **443件成功、失敗0件**（422件から21件追加）。API実機確認/通常操作/P5受け入れは未実施。

### P2生産カタログからの調達構造（2026-10-11）
- `tests/production-prerequisites.test.mjs` 21件とproduction adapter接続1件、計22件追加。未達itemsの自動roots、OR/AND/共有、nominalとobservedコスト、zero rows、通常/abyssal/access、発見済み≠所持、Fletching/Summoning代替を検証。
- 未確定potion/partial副産物の非供給、未所持/blocked body非参照、owned DLC、無関係なコスト非展開、partial item集計/skill/recipe、scope/version/mode/ID/不正/各集合と予算上限を確認。
- 2000段階のqueue/SCC、閉路に非循環ORを残すこと、1000文字raw IDに対する短い決定的route ID、順序/freeze/DTO分離、既存Resolverの拒否、投影/操作なしを確認。共通SCC化後のショップ20件も成功。
- 初回1件は不正collectionをlimitと同じreasonにして全graph拒否したため。形状不正はrecipe保留、集合超過は全graph拒否に分けて修正。
- `npm.cmd run check`（共通SCC/生産依存も含む）成功、`npm.cmd test` **465件成功、失敗0件**（443件から22件追加）。実機/保証効果/数量/操作/P5受け入れは未検証。新規ゲームAPI、セーブ変更、公開/pushなし。

### P2生産/ショップOR統合（2026-10-11）
- `tests/item-acquisition.test.mjs` 15件とshop adapter接続1件、計16件追加。生産と直接購入のOR、素材のshop seller、支払素材から別shop、生産/店をまたぐcycleと非循環代替を検証。
- 既購入countが正でも新規operation/item-supplyは未完了。nominal/quoteの分離、unknown quote/cost body例外のopaque blocker、lootBox/charges/pet/tab/stat非供給、未所持内容非参照を確認。
- 同一version/mode、関連closure/無関係な価格getter非参照、欠落条件、node/edge/route/byteの合計上限、freeze/順序/DTO分離、既存Resolver拒否、観測adapterからAPI再呼出しなしを確認。
- `npm.cmd run check` 成功、`npm.cmd test` **481件成功、失敗0件**（465件から16件追加）。price/数量/効果/通常購入/在庫/P5実機受け入れは未検証。新規ゲームAPI、セーブ、公開/push操作なし。

### P1統合観測フレーム（2026-10-11）
- `tests/observation-frame.test.mjs` 14件追加。5 stage成功→全Completion監査/調達解析、資源/生産/農業の部分取得、shop欠落時の明示fallback、所有不明/context固定を確認。
- 通常入口/invalid context/版/raidの先行gate、前後mode/Raid変化、途中だけ異なるmodeヘッダー、stage成功と解析/operation許可の分離、secret/extra/保存/操作/clock非参照、UTF-8全frame上限、freeze/DTO分離を検証。
- 共通人工contextで呼んだことから原子的観測を推測しない。atomicObservation/actualComplete/planningReady/runnable=false。取得不可をゼロ在庫や既知scopeに補完せず、全scope/カテゴリの未検証をauditへ残す。
- `npm.cmd run check`（observation-frameも含む）成功、`npm.cmd test` **495件成功、失敗0件**（481件から14件追加）。実機/副作用/原子性/イベント/通常操作/P5受け入れは未検証。ゲーム/セーブ/公開/push操作なし。

### P4観測phase分離（2026-10-11）
- frame4件/controller3件、計7件追加。monitoring時のproduction/shop/farming getter非参照とanalysis=null/deferred、offlineでも新資源/Completionを観測、planning復帰の新評価を確認。
- invalid phase/offline/context、監視中の部分資源データ、controllerのplanning→monitoring→完了後planning、activeなし/ありのoffline復帰、旧flag非固定、graph/model/estimatesのない監視frameで二重発行しないことを検証。
- 初回1件は通貨DTOを配列として直接参照したテスト誤り。既存data.currencies配列へ修正。runtime factory拒否、停止/timeout/epoch/再読込/長時間の既存回帰も成功。
- `npm.cmd run check` 成功、`npm.cmd test` **502件成功、失敗0件**（495件から7件追加）。production/shop/farming/graphを省略するが全Completionと資源registry、controller report監査は残る。実機局所観測/イベント/cache/パフォーマンス/P5受け入れは未検証。

### P1対象Completion限定観測（2026-10-11）
- target reader11件、monitor2件、frame/controller各1件、計15件追加。5カテゴリ、standard/TotH offset/abyssal、mastery skill/action、発見≠所持、対象値とカテゴリ最大数、同カテゴリ分母1回を確認。
- allObjects/currentCount/getPercentの非参照、ignore/MOD/未所持/unknown/lookup mismatch/未登録の非展開、不正scalar/track/cap/重複/件数/DTO全体UTF-8/例外秘匿を検証。empty/all targets achievedでもfullCoverage/achieved=false。
- target-only monitorで完了/分母変化replan、mixed/duplicate/mode/locked/未知/未観測の拒否、controllerの凍結active条件→frame ID lookup→partial DTO、全体auditの保留、freeze/DTO分離を確認。
- 初回1件は標準trackの値を壊したケースで標準trackをテスト対象にしていなかったため。対象条件を追加して修正。`npm.cmd run check`（completion-targetsを含む）成功、`npm.cmd test` **517件成功、失敗0件**（502件から15件追加）。
- 実機 lookup/分母/読み取り副作用/原子性/資源局所観測/P5受け入れは未検証。通常入口拒否、実操作/セーブ/公開/pushなし。

### P1対象資源限定観測（2026-10-11）
- reader/monitor/guard13件、frame/controller各1件、計15件追加。対象ゼロ/正量/lock、全bank items/locked iteration/currency registry非参照、未観測占有数、少数通貨/必要ID coverageを確認。
- 容量はglobal occupiedを使用、固定の既知最小消費だけ枠を解放し、bounded保存で空きが出ない場合は拒否。全resource consumer/quantity planner/pre-postはpartialを拒否、monitorだけ専用guardで受ける。
- lookup/例外/不正量/slots/gear/action/DTO整合/件数/UTF-8/通常入口/秘密/禁止銀行・通貨・保存API、順序/freeze/出力分離を確認。task-derived resourceTargetsを凍結し、部分monitorとfull executor pre/postを分離して完了を検証。
- 初回controller接続で通貨不要の空subsetをfull registryと同じ検証で拒否した問題を修正。targetedかつ要求通貨なしだけ許可し、full用途の拒否は維持。
- `npm.cmd run check`（resource-targetsを含む）成功、`npm.cmd test` **532件成功、失敗0件**（517件から15件追加）。実機getQty/slots/lock/原子性/パフォーマンス/P5受け入れは未検証。実操作/セーブ/公開/pushなし。

### P1現在行動の選択観測（2026-10-11）
- reader12件、frame/monitor各1件、計14件追加。active/idle/paused/選択のみ/別行動、wantedと複数木、Set/registry同一参照/ID/所有/MOD/不正flag/未登録を確認。
- context/version/Raid/件数/UTF-8全結果、idleでskill body非参照、select/start/stop/XP/reward/random/save/秘密非参照、順序/freeze/DTO分離を検証。outputsEvidence unknownに対しexisting executorがselectせず拒否する。
- frame/controllerのexpected action/tree IDsから現在選択を観測し、手動tree切替はaction-selection-changedとしてreplan。初回の不整合テストは同じactive objectのisActiveも変わるため、明示的な別active objectの矛盾へ修正。
- `npm.cmd run check`（action-selectionを含む）成功、`npm.cmd test` **546件成功、失敗0件**（532件から14件追加）。実機Set/状態/stop/cached helper/全副産物/操作/P5受け入れは未検証。実操作/セーブ/公開/pushなし。

### P1追加selector/variant監視（2026-10-11）
- selector8件、monitor4件、frame1件、計13件追加。9追加skill、area/fishとstation/recipe、raw alt index/素材、inactive/paused、未選択/不正Map/登録参照/所有/上限、禁止dynamic getter/操作/報酬/保存を確認。
- recipe ID不変のvariant切替、plannerが明示したvariantとの差、狭い署名、legacy variant-free checkpoint互換、任意extra/不正checkpoint署名の拒否を検証。frameとCooking action metadataの整合、freeze/DTO分離も確認。
- Miningが対応済みになったため既存の未対応actionケースをThievingへ更新。型のindex対応/既定素材/出力/価格/操作を保証へ昇格しない。
- `npm.cmd run check`（noncombat-selection/selection-variantを含む）成功、`npm.cmd test` **559件成功、失敗0件**（546件から13件追加）。実機状態/mapper/getter副作用/選択/通常操作/P5受け入れは未検証。実操作/セーブ/公開/pushなし。

### 今後の操作試験

- 初期値: 不明API、未達unlock、素材不足、銀行満杯、ショップ購入不可、通信途切れ、モード制約、Hardcore戦闘。
- 各操作の pre/post snapshot を保存し、操作前提が崩れた場合は拒否する。
- リトライの上限、重複購入防止、進捗のないループ防止。
- 単一のアダプターを1つずつ試験し、全エージェントへ連結するのはその後。

## 4. Completion受け入れ試験
- Base Game、所有DLC、ゲームモードを正確に分離。
- アイテムを所持しているだけで他カテゴリ100%と誤判定しない。
- 既に全スキル上限でも他Completion未達なら残作業を探す。
- ランダムドロップ、マスタリー、ペット、ダンジョン等を含む長期進捗。
- P1-01の有効化前には `docs/API_EVIDENCE.md` の照合手順を使う。所持DLC・起動中バージョン取得は現在未実装。型宣言とフィクスチャの一致だけでAPIを有効化しない。
- UI照合でID/分子/分母/率/ロック理由を記録する。セーブ文字列や認証情報を記録・外部送信しない。照合は未実施であり、実ゲーム由来の比較フィクスチャもまだない。

## 不具合報告テンプレート
Melvorバージョン / Browser or Steam / MODバージョン / 他に有効なMOD / ゲームモード / 再現手順 / 期待結果 / 実結果 / エラーログ（秘密情報は削除）
