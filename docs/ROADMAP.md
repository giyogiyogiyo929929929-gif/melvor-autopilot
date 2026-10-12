# ロードマップ / Codex作業キュー

ステータス: [x] 確認済み（モック/実機の種別は各項目に記載）、[ ] 未実装、[~] 部分実装/確認待ち。

## P0 — 安全な最小プロトタイプ（現在）
- [x] マニフェスト + `setup(ctx)` の起動構造。
- [~] 従来の推測スキル観測は無効化。配布UIは実機確認済みアダプターができるまでblocked。
- [x] 目標指定なしの純粋なCompletion候補生成（モック用、通常のゲーム読み取り経路は無効）。
- [x] 開始/停止UI、解析ログのJSON書き出し、異常で停止。
- [x] Node.jsモック単体テスト。
- [x] Melvor Idle v1.3.1 のCreator Toolkitで解析専用UIを実機確認（2026-10-12）。初期停止、開始時の実機確認待ち、緊急停止、再読み込み/アプリ再起動後の非再開を確認。最終登録で可読logとJSON4件の固定ログを書き出した。ゲームAPIの検証ではない。
- [x] 実機準備/namespace/ログ修正（2026-10-12）: 元/複製backup一致、専用プロフィール、既存11MOD無効、許可済みToolkit導入/複製スロット2ロード。非予約namespace `autopilot`と明るいdiv logを採用。既存登録の更新反映は未確認のため旧登録を無効化し、最新ZIPを新規登録して視認性を確認。check成功/test559件成功。読取り/通常操作は未許可。

## P1 — Completion観測と安全な操作アダプター
- [~] **P1-01 モック実装済み (2026-10-11)**: 公式型定義を調査し、テスト専用read-onlyアダプター、5カテゴリ×4スコープ、ロック/モード/abyssal、取得失敗/集計照合、純粋候補生成を実装。型定義とv1.3.1実機の一致・DLC所持と起動中バージョンの自動取得は未確認のため、配布UIの読み取り経路はblockedのまま。実機照合まで完了扱いにしない。
- [~] 開発集計プローブ（2026-10-12）: Base集計だけの手動1回観測を開発ZIPへ分離して準備。版/複製index/ロード/行動ゲートと前後の観測量比較、秘密/書込み非参照をモック/実機で確認する。通常配布とDLC所有検証は未接続。
- [~] P1-02（2026-10-11 モック実装済み）: 公式型宣言を台帳に記録し、`src/resources.mjs` に在庫/ロック/小数通貨/銀行容量/全装備セット/実行中と一時停止の行動を実装。部分失敗・無変更・上限等18件追加、全97件成功。実機照合と配布経路有効化は未実施。
- [~] P1-03（2026-10-11 モック検証基盤実装済み）: `src/executor.mjs` に人工portの3段階検証・二重操作拒否・checkpoint・停止/timeout/遅延完了の所有確認cleanupを実装。23件追加、全120件成功。実環境allowlistは空。ユーザー確認で複製セーブ/専用プロファイル未準備、通常APIの実証は未実施。
- [~] P1-04（2026-10-11 モック実装済み）: `src/monitor.mjs` と共通資源ガードを追加。Completion全項目の照合、終了条件/停滞/素材不足/手動介入/オフライン復帰、木こりexecutorの所有確認停止を27件追加で検証、全147件成功。実ゲームイベント接続と実機試験は未実施。
- [~] 統合観測フレーム（2026-10-11）: `src/observation-frame.mjs` で既存5 readerを固定contextで束ね、pre/postとstageヘッダー、部分失敗、audit/調達解析を14件追加で確認。全495件成功。原子的観測/実機/通常入口/操作は未検証・無効。
- [~] 対象Completion限定観測（2026-10-11）: `src/completion-targets.mjs` のID lookup、5カテゴリ/track/分母とmonitor/frame/controllerを15件追加で確認、全517件成功。全registry/current/percentを走査せず部分DTOを監視。全体audit/通常入口/実機は未検証・無効。
- [~] 対象資源限定観測（2026-10-11）: `src/resource-targets.mjs` とmonitor専用guardで量/lock/全枠/coverage、容量/最小消費を15件追加で検証、全532件成功。task-derived対象をframe/controllerへ接続し、full planner/pre-postはpartial拒否。通常入口/実機は未検証・無効。
- [~] 現在行動選択観測（2026-10-11）: `src/action-selection.mjs` でidle/active/paused/選択のみと木こりSet/停止可能状態を分離。手動switch/frame/controller/executor unknown拒否を14件追加で確認、全546件成功。通常入口/他skill selector/実機は未検証・無効。
- [~] 追加selector/variant監視（2026-10-11）: 9追加skillのraw選択、area/station/recipe、alt index/素材variantを13件追加で検証、全559件成功。variant署名/旧checkpoint互換/任意payload拒否をmonitorへ接続。通常入口/他skill操作/実機は未検証・無効。

## P2 — 本当の自己決定
- [x] 未達Completion候補生成（skills/mastery/items/monsters/pets、純粋関数をモックで検証。経路調達と操作は未実装）。
- [~] 生産素材とレベル要件グラフ、入手経路、依存閉路検出（2026-10-11 続行）: AND/OR・数量/予約/消費競合に加え、`src/quantified-planner.mjs` で段階投影とPlanner/監視を接続。素材不足候補の棄却、実生産回数の効用、最終Completion条件を人工bindingで検証、全189件成功。実ゲームcatalog/binding構築は未実装。
- [~] ショップ観測からの依存生成（2026-10-11）: `src/shop-prerequisites.mjs` にcount条件/AND/通常abyssal条件、観測矛盾、反復SCC、取得済み依存の非展開を追加。2000連鎖/共有/循環/上限とadapter接続を21件追加で検証、全443件成功。evidenceはunknown、実機/操作/bindingは未実装。
- [~] 生産観測からの調達構造（2026-10-11）: `src/production-prerequisites.mjs` で未達items→OR producer→AND素材/通貨/スキル/accessを生成。Fletching/Summoning variants、2000連鎖/閉路と代替/長ID/関連だけ展開を22件追加で確認、全465件成功。nominal/observedは非保証、在庫/数量/操作/bindingは未実装。
- [~] 生産/ショップOR統合（2026-10-11）: `buildItemAcquisitionGraph` で通常item購入を生産ORへ加え、支払素材/通貨とshop条件を接続。新規操作と既購入countを分離し、関連closure/統合cycle/例外/上限を16件追加で検証、全481件成功。数量/効果/実操作は未実装。
- [~] 行動時間・収益・解放効果の推定、継続/切替閾値（2026-10-11 モック実装済み）: `src/planner.mjs` にCompletion増分・解放効果・前提時間・消費コスト・信頼性・死亡リスクの評価、次候補/最初の前提作業の決定、クールダウン/ヒステリシスを実装。人工見積りで27件を追加検証。実データ推定と配布経路への接続は未実装。
- [~] ゴール指定なしの「次の目標→必要作業→監視/停止」を人工bindingと木こりportで一貫検証。runtime controller/実機操作は未実装。
- [x] 大規模候補/graphの公平な作業窓と局所化（モック）: current保持と他候補の非飢餓、個別closure失敗後の次候補、2001/5000件の候補/graph/bindingで数量Planner接続を18件追加で検証。全243件成功。巨大recipe catalogとcontrollerは未実装。

## P3 — 非戦闘完全自動化
- [~] 生産観測: `src/production-catalog.mjs` に木こり/鍛冶のread-onlyテストadapterを追加。基礎値と修正後コスト/時間/保存率/倍化を18件追加で検証、全207件成功。実機の効果保証と通常操作は未実装。
- [~] 採掘/釣り/料理の観測（2026-10-11）: 同adapterを5スキルへ拡張し、鉱石HP/復活/店/mastery、魚とarea対応/条件/chance/interval範囲、料理station/upgrade/成功/perfect/cost/passive/stockpileを19件追加で検証。全366件成功。実機/完全出力/保証効果/通常操作は未実装。
- [~] 共通Artisan観測（2026-10-11）: Crafting/Fletching/Runecrafting/Herblore/Summoningを追加。カテゴリ参照、代替素材/設定番号、potion段階、summoning mark/素材別コストを18件追加で検証し、全384件成功。既定10スキル、Herbloreの製品対応はunresolvedとして数量draftから除外。実機/保証効果/通常操作は未実装。
- [~] 農業観測（2026-10-11）: `src/farming-observation.mjs` でcategory/recipe/plot/compost/timerを分離。全5状態、基本/修正コスト、選択と植付、所属整合/未所持非参照/上限を20件追加で検証、全404件成功。成長/収穫/在庫の投影と実操作は未実装。
- [~] ショップ観測（2026-10-11）: `src/shop-observation.mjs` で購入回数/要件/価格4種/cap/quote/containsを分離。unknown/limit0/Infinity/未所持/Raid/順序を18件追加で検証、全422件成功。canPurchase=null、実機・購入・効果/投影は未実装。
- [~] 効果境界: `src/recipe-effects.mjs` で保証最小/最大出力、最低/最大消費/時間を検査し、数量Planner/監視へ接続。最初の1操作の銀行ピークと段階上限引継ぎを18件追加で検証、全225件成功。実機の境界証拠は未取得。
- [x] 巨大catalogの局所化（モック）: `src/local-catalog.mjs` をwindow付きCompilerに接続し、5001件の入力、素材/OR/循環/局所失敗と次候補、不要getter非参照を17件追加で検証。全260件成功。実機catalog/bindingは未確認。
- [ ] 10スキルの実機観測/通常操作、農業・その他非戦闘・銀行・ショップ・装備の未対応観測/操作。
- [ ] 調達経路候補の最適化（自力生産/店/戦利品）。
- [ ] 材料枯渇と銀行不足に自動対応。

## P4 — 戦闘と耐久性
- [~] 戦闘観測/条件付きguard（モック）: `src/combat-observation.mjs` でdirty stats/部分失敗を保留し、`src/combat-risk.mjs` で全damage/食料/timingの人工境界を検査。未知/Hardcoreを拒否、非戦闘代替を18件追加で確認、全310件成功。実機model/Simulator/実死亡確率/実戦APIは未実装。
- [ ] 敵・ダンジョン・スレイヤー・食料補給・装備更新。
- [~] タスク継続/記録（モック）: `src/controller.mjs` と記録codecで自動候補→木こり→monitor→所有停止→再観測、再読込非再開、epoch/watermark、offline/session/遅延IOを32件追加で検証。全292件成功。実環境controller/storage・イベント/キャッシュ接続は未実装。
- [~] 観測phase分離（2026-10-11）: mock frame/controllerでplanning時だけ5 reader/重い解析、monitoring/offlineは資源と全Completionの現在観測。deferred/null、完了とoffline/no-active復帰のfresh観測を7件追加で確認、全502件成功。対象限定観測/実機イベント/cacheは未実装。

## P5 — Completion制覇
- [~] 全Completion監査/停滞report（2026-10-11 モック実装済み）: 4スコープ×5カテゴリの全観測を照合し、未達/未検証/除外/観測上の全達成を分離。進捗/停滞/観測空白/容量制限とcontrollerのgetReportを34件追加で検証、全344件成功。実機100%判定と配布UIへの接続は未実装。
- [ ] 最低1つのゲームモードでBase Game全カテゴリを検証。
- [ ] DLCスコープ対応、エンドゲーム・希少ドロップ・ペット。
- [ ] 長時間再現テスト、所要時間と失敗理由のレポート。
- [x] P5長時間の人工統合シナリオ（2026-10-11）: 240作業、7日間の仮想offline、3回の停止/復元、ledger/journal反復回転、全窓blocked/銀行不足を3件追加で検証。全347件成功。実時間・実ゲームの長期試験とは区別し、P5全体は未完了。

## 作業完了時テンプレート
- 対応要件 / 変更ファイル:
- 実装済み:
- Node test:
- 実ゲーム検証（実施 / 未実施）:
- セーブ安全の検証:
- 確認したAPIと出典:
- 未解決 / 次タスク:

## 次にCodexが取りかかるタスク（1つ）
**P1-01 Completion集計の実機照合用プローブ**: 複製スロット2/開発専用profileで公式型宣言と既存API台帳に基づく読取り専用プローブを準備し、ゲーム内Completion Logのカテゴリ集計と照合する。版/モード/所有contextを確認し、出力は必要な数値/ID/固定理由だけに限定する。関数ごとの副作用/例外/一致を記録するまでは配布読取り入口を有効化しない。通常プレイ操作は行わない。

今回の自動検証: 2026-10-11、`npm.cmd run check` 成功、`npm.cmd test` 24件成功。実機検証は未実施。セーブ変更・公開・pushは実施していない。

続行イテレーション: 同日、check成功・test52件成功。Windows操作機能の接続エラーと空のブラウザーインベントリにより実機環境は確認できず、P1-01は実機未検証のまま。接続可能な複製セーブ/開発専用プロファイルが用意できたら、API台帳の実機照合を優先し、読み取り経路はそれまでblockedを維持する。

Plannerイテレーション: 同日、`npm.cmd run check` 成功・`npm.cmd test` **79件成功、失敗0件**。切替閾値の浮動小数点境界を回帰試験で検出し修正。新たなゲームAPI呼出し・セーブ操作・公開・pushなし。実ゲーム未検証、Completion 100%自動達成と通常プレイ操作は未実装。

資源観測イテレーション: 同日、check成功・test97件成功。公式型宣言に基づくモック入口だけを追加し、通常読取りは無効。実機・セーブ複製での照合は未実施。

木こり検証基盤イテレーション: 同日、check成功・test120件成功。SteamのMelvorライブラリまで確認したが、ユーザー回答で実機検証用セーブ/プロファイルは未準備。実際のゲームAPI/操作は未実施。本チャットのP5まで継続する目標はactiveであり、モック実装をP1/P3/P5の実機受け入れ完了と扱わない。

進捗監視イテレーション: 同日、check成功・test147件成功。Completionの照合済みentriesを追加、監視を木こりの人工シナリオに接続。新規ゲームAPIなし、実機検証/セーブ操作なし。数量計算・実環境統合とP5受け入れは引き続き未完了。

数量計画イテレーション: 同日、check成功・test167件成功。二重消費防止、OR投影分離、固定副産物と未保証副産物の銀行枠、固定消費後の容量を人工データで検証。Planner/監視接続と実機検証は未実施。

数量Planner接続イテレーション: 同日、check成功・test189件成功。段階在庫/副産物枠の引継ぎ、実回数の効用、監視条件自動生成、Completion確認、木こりportの所有停止を統合。長い合成IDの境界試験で既存graph上限の不整合を検出・修正。新規ゲームAPI/セーブ変更/公開/pushなし。P3/P4/P5の実機受け入れは未完了で、P5の継続目標はactiveのまま。

生産カタログイテレーション: 同日、check成功・test207件成功。公式型宣言を調べてテスト専用reader/draftを追加し、効果未確認のdraftが拒否されることを検証。ライブアプリ一覧はSteamのみ、Melvorのゲームwindowは確認できず。セーブ/プロファイル準備の完了情報はなく、実機検証は未実施。P5目標は未完了。

効果境界イテレーション: 同日、check成功・test225件成功。固定batchで途中だけ素材/製品の2枠が必要になるケースを修正し、変動効果の上下限を数量Planner/monitorへ接続。未保証の数量は数値上限/供給として表明しない。新規ゲームAPI/セーブ操作/公開/pushなし、P3/P4/P5実機受け入れは未完了。

候補窓イテレーション: 同日、check成功・test243件成功。2001件で41窓以内に末尾の有効候補へ到達し、5000件のglobal graph/binding/estimateでも局所planを評価。Completionは切り詰めず、窓から100%を表明しない。新規ゲームAPI/実操作/セーブ/公開/pushなし、P5目標は未達成。

catalog局所化イテレーション: 同日、check成功・test260件成功。5001件の入力から必要producerだけを使い、別候補のlocal上限失敗を隔離。全入力を最適/検証完了と扱わず、未保証供給を補完しない。新規ゲームAPI/実機操作/セーブ変更/公開/pushなし、P5実機受け入れは未実施。

継続制御イテレーション: 同日、check成功・test292件成功。作業停止後に次命令へ進めない不整合を修正し、命令前保存/再開拒否/epoch圧縮/遅延IO直列化/停止競合を人工portで検証。storageはfixtureのみで実ゲーム保存と無関係。新規ゲームAPI/セーブ変更/公開/pushなし、P5目標は未達成。

戦闘guardイテレーション: 同日、check成功・test310件成功。公式型宣言の調査台帳とmock telemetry/境界guardを追加。stats/最大hitだけを安全とせず、実死亡確率はnull、runtime禁止を維持。実機/実戦/全CompletionとP5長時間受け入れは未実施。

Completion監査イテレーション: 同日、check成功・test344件成功。全項目/missing/集計/所有/観測フラグを照合し、部分観測とoffline/空白は停滞の根拠にしない。容量制限にcheckpointも含め、直近stepの固定理由をレポートに接続。新規ゲームAPI/セーブ変更/公開/pushなし、P5実機受け入れと継続目標は未完了。

長時間人工統合イテレーション: 同日、check成功・test347件成功。240命令のID/epoch単調性、3回の明示再開、仮想offline7日、記録回転と未達report保持を確認。`docs/ACCEPTANCE.md` に全P1〜P5の実機証拠と未実施状態を整理。Steamの検索入力はuser input検出で拒否、再観測は別appが前面だったため追加入力を中止。ゲーム起動/セーブ/プロファイル/API操作なし。実機Completion制覇とP5全体は未達成。

採掘/釣り/料理イテレーション: 同日、check成功・test366件成功。公式repo contentsから採掘宣言がrockTicking.d.tsであることを確認し、5スキルの分離DTOとpartialな条件/効果を追加。統合fixtureの空通貨registryが不正だったためGP観測を追加し、実際のdraft効果拒否を確認。HP/返却chanceを一度だけ読んで同じ値を検査/出力する試験も追加。新規ゲームAPIの実環境呼出し/セーブ/公開/pushなし。P3通常操作とP5実機受け入れは未完了。

共通Artisanイテレーション: 同日、check成功・test384件成功。公式型宣言から5スキル固有の観測を追加し、10スキル混在を確認。Herbloreの未知tier mappingは製品/基礎量をnullとしてunresolvedDraftsへ分離。代替選択やmarkの既定値を捏造しない。新規ゲームAPIの実環境呼出し/セーブ/公開/pushなし。P3/P5の実機受け入れは未完了。

農業イテレーション: 同日、check成功・test404件成功。公式enum/plot秒表記とraw helper値を区別し、並行timer所属と全plot stateをread-onlyで観測。観測不明を成長/収穫/銀行/Completionの投影で埋めず、既定1MiBの出力上限を追加。通常入口は無効。実ゲームAPI/セーブ/プロファイル/公開/push操作なし、P3/P5実機受け入れは未完了。

ショップイテレーション: 同日、check成功・test422件成功。公式main型宣言からraw価格/回数/条件/制限と1-unit quoteを分離。所有許可indexを固定して参照先の価格失敗/registry順序による依存観測の差を防止。初回の並替え試験でfixtureの配列index参照が変わる問題を修正し、再実行で成功。通常入口は無効、購入/通貨/銀行/通知/保存APIなし。P3/P5実機受け入れは未完了。

ショップ依存イテレーション: 同日、check成功・test443件成功。count thresholdと要件metの矛盾、skillの単調性、opaque AND条件、未達SCCを解析。2000購入/6000nodeの連鎖を反復で処理し、共有groupを再構築せず予算内に保持。テスト期待値の辺数と既存拒否理由を修正、要件数超過で全graphを破棄する挙動を確認。新規ゲームAPI/操作なし、P2/P3/P5実機受け入れは未完了。

生産依存イテレーション: 同日、check成功・test465件成功。関連producerのみのwork queueと共有SCC、variant/OR/AND、未確定出力/所持非補完、2000段階/長IDdigestを追加。不正collectionと超過limitのreasonが混ざり局所失敗を全体拒否にした問題を分離して修正。新規ゲームAPI/実操作なし、P2/P3/P5実機受け入れは未完了。

入手経路統合イテレーション: 同日、check成功・test481件成功。shop-operationをcount条件から分離し、通常item sellerと価格/支払素材の構造を生産closureへ統合。購入済み回数から新規在庫を作らず、lootBox等の効果は供給へ補完しない。unknown/cost例外/版mode/関連限定/合計上限/共有/統合cycleを確認。実ゲームAPI/購入/セーブ/公開/pushなし。P1/P3/P5実機受け入れは未完了。

統合観測イテレーション: 同日、check成功・test495件成功。固定contextで5 reader→audit/調達graphを接続し、途中/前後mode/Raid不一致は全frame拒否。個別取得失敗は部分情報と固定理由を保持し、shop不可は生産解析へのfallbackを明示。atomicObservation=false、actualComplete/planningReady/runnable=false。実ゲームAPI/操作/セーブ/公開/pushなし、P1/P3/P5実機受け入れは未完了。

観測phaseイテレーション: 同日、check成功・test502件成功。monitoring/offlineで3 readerと解析をdeferred/nullにし、controllerへ凍結phase requestを接続。activeなしoffline復帰は新planning観測待ちとし、旧flag/解析を継続根拠にしない。通貨DTOのテスト参照位置を既存schemaへ修正後成功。全Completion/資源走査とcontroller report監査はなお残り、実機の軽量化完成とは扱わない。ゲーム/セーブ/公開/pushなし。

対象Completionイテレーション: 同日、check成功・test517件成功。ID lookupで全5カテゴリを対象だけ観測し、context/分母/track/所有を監視へ接続。sourceTestで標準trackの壊れた値を要求しない誤りを修正。DTO全体byteを検査し、full snapshot混在/未観測/partial全体達成を拒否。通常入口は無効、資源全走査は残る。実ゲームAPI/操作/セーブ/公開/pushなし、P1/P3/P5実機受け入れは未完了。

対象資源イテレーション: 同日、check成功・test532件成功。ID数量/lock/枠を部分DTOへ分け、専用guardとglobal occupiedによる容量を監視へ接続。auxiliary gear/action readerを共用し、full資源用途はpartial拒否。通貨不要taskの空subsetを全通貨未取得と混同する問題をtargeted guardで修正。実ゲームAPI/操作/セーブ/公開/pushなし、P1/P3/P5実機受け入れは未完了。

行動選択イテレーション: 同日、check成功・test546件成功。木こりの対象Set/実行/一時停止/停止可能性を分離し、registry/所有/identityとobserverヘッダーを検査。currentAction/actionSelection/woodcuttingをframeへ追加し、手動tree変更をmonitorへ接続。primary出力unknownのままexecutor拒否を確認。共有active objectのテスト変化を明示した不整合へ修正。実ゲームAPI/操作/セーブ/公開/pushなし、P1/P3/P5実機受け入れは未完了。

追加selectorイテレーション: 同日、check成功・test559件成功。9 skillのraw選択とcanonical registry参照、map/所有/状態、Fletching/Summoning variantの狭い署名を追加。recipeが同じでもvariant変更をreplanとし、任意checkpoint payloadを拒否。Cookingのcatalog action metadataをstation+recipeへ整合。旧未対応Miningテストは未対応Thievingへ変更。実ゲームAPI/操作/セーブ/公開/pushなし、P1/P3/P5実機受け入れは未完了。
