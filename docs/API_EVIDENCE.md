# APIエビデンス台帳

この表の「実機確認: NO」の項目を本番書き込み処理に使ってはいけない。

## P1集計プローブの呼出し前台帳（2026-10-12、対象v1.3.1、実機確認NO）
- 開発専用ZIPの手動1回観測でのみ次の名前を使う。公式main宣言と実機UIの版はv1.3.1だが、メソッドの副作用/返値はまだ検証していない。配布入口の有効化ではない。
- `gameTitle`、`loadingOfflineProgress`: [main.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/main.d.ts)。完全一致/booleanを検査。未知/例外は固定理由で中止、文字列の原文を出力しない。
- `currentCharacter`、`characterSelected/isLoadingSave/isCreatingSave`: [save.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/save.d.ts)。スロットindexだけを観測し、save文字列/headers/Cloud/storage/key/GUID/export/import/保存関数は参照しない。UIスロット2=index1は照合仮説、違えばCompletionを呼ばず中止。
- `game.currentGamemode.id/isPermaDeath/isGolbinRaid/isPaused/activeAction/pausedAction/completion/bank/skills/currencies/combat.player`: [game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts)、[gamemode.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/gamemode.d.ts)。Raid/活動中/部分ヘッダーは中止。後段でmode/context/参照が変われば結果破棄。
- `Completion.skillProgress/masteryProgress/itemProgress/monsterProgress/petProgress/totalProgressBaseGame`、`CompletionProgress.currentCount/maximumCount/getPercent`、`CompletionMap.getCompValue`: [completionLog.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/completionLog.d.ts)。Base/D/Fだけを診断。欠落/不正/例外は該当カテゴリの固定理由、再試行なし。update/render/setVisible/encode/decodeは呼ばない。
- 前後比較: `Bank.items/lockedItems/occupiedSlots/maximumSlots`とBankItem.item/quantityは[bank2.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/bank2.d.ts)。`NamespaceRegistry.allObjects`は[namespaceRegistry.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/namespaceRegistry.d.ts)、`Currency.id/amount`は[currency.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/currency.d.ts)、`Skill.id/xp/abyssalXP`は[skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts)。上限/未知/例外なら観測中止。数値/IDを局所比較し、全リストを出力しない。
- 装備比較: `Player.equipmentSets/selectedEquipmentSet`は[player.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/player.d.ts)、`EquipmentSet.equipment/equippedArray`とEquippedItem.slot/item/quantity/isEmpty/occupiedByは[equipment.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/equipment.d.ts)。欠落/例外/未知参照は中止。装備/銀行/経験値の変更関数は未採用。
- 実機検証方法: 専用profileの有効MODを確認し複製2だけをロード、UI数値を先に記録。手動観測→数値/固定理由と前後比較フラグをローカル出力→UIの5カテゴリと照合。全セーブ/RNG/他モード/DLCまで検証したと表明しない。

## 起動UIの観測（2026-10-12、対象: v1.3.1）
- Steam版キャラクター選択画面でv1.3.1表示を確認。`game`の関数/プロパティは呼んでいないので、下表のAPI実機確認はすべてNOを維持。
- 通常のローカルsave download UIでスロット1/2を別ファイルへ退避し、ローカル比較の一致だけを確認。セーブ内容とハッシュ値は出力しない。失敗/既存保存先なら上書きせず中止する。
- 開発プロフィールの全11MOD無効状態と再読み込み後のactive名をUIで確認。複製への関連付け、読取りgetterの副作用、Completion UI/API照合は未検証。
- ローカルsaveロード確認にCloud上書き警告が出たためキャンセル。警告の意味を推測して確定しない。
- その後ユーザーが複製スロット2のロード/同期を明示許可。profile mismatch選択で開発用（1 mod enabled）を選び、複製をロードした。元スロット1は未ロード。
- Creator Toolkit v1.3.0のmanifest検証でnamespace `melvorAutopilot`を拒否。「英数字/underscoreのみ、melvorで開始不可」の実機エラーを確認。これはmanifestの受理条件の証拠であり、setup hook/Completion getterの動作確認ではない。登録失敗時はMOD未ロードを維持し、修正ZIPで再試験する。
- ログ表示診断では`document.getElementById('melvor-autopilot-panel')`配下だけを対象とし、`lastElementChild.tagName/style.color`と`getComputedStyle(...).color`を読取り確認する。DOM標準APIの出典: https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle 。対象v1.3.1/検証日2026-10-12。対象が無ければnull、例外/不明なら診断中止。game/セーブ/storage/認証情報は参照せず、DOMを書き換えない。これはGameAdapter許可の根拠にはしない。
- 上記DOM診断は未実行。Steamクライアントで開発ツール用ショートカットを試したが対象windowは現れず、コード入力は行っていない。ToolkitのUpdate Modfile後も表示が変わらず、更新反映の証拠は未取得。通常アプリ終了/再起動も確認する。
- 最終結果: Update Modfileとアプリ再起動だけではログ修正の反映を確認できず。旧local登録を無効化し、同じnamespace `autopilot`の最新ZIPを別のlocal登録として追加すると、divの明るいログを視認できた。原因/更新APIの保証は未確認。重複有効化はしていない。
- `setup(ctx)`/`ctx.onInterfaceReady(callback)`の実機検証方法: v1.3.1で複製スロット2を開発profileへ関連付け、最新解析専用ZIPを読み込み、パネル/初期化logを確認（2026-10-12）。開始時の実機確認待ち、緊急停止、再読込/再起動後の停止、固定JSON4件を確認。context欠落/イベント例外の実機再現は未実施。UI初期化不可でも通常操作は実装されておらず、GameAdapter入口は無条件拒否を維持する。

| 機能 | 実装に使う形 | 根拠 | 実機確認 | 備考 |
|---|---|---|---|---|
| MODエントリ | `manifest.json` 内 `setup` → `export function setup(ctx)` | Melvor公式Mod Context API (mod.ioの旧案内)・Fatebreakerサンプル、下記実機記録 | UI起動のみ確認 | 2026-10-12 v1.3.1、namespace autopilot、複製スロット2。game APIの許可ではない |
| UI準備 | `ctx.onInterfaceReady(callback)` | Melvor Mod Creationのガイド例、下記実機記録 | UI callback確認 | 2026-10-12 v1.3.1、初期停止パネル表示を確認。例外/他イベントは未検証 |
| スキルレジストリ | `game.skills.allObjects` | 下記P1-01台帳で型宣言を確認 | NO | 配布経路は無効、モック専用 |
| スキル状態 | `skill.id`, `.name`, `.level`, `.isUnlocked`, `.currentLevelCap` | 下記P1-01台帳で型宣言を確認 | NO | 旧 `.levelCap` 仮説は撤去 |
| Completion | 下記P1-01台帳を参照 | 公式型宣言を調査 | NO | 実機照合までモック専用 |
| アクション実行 | 未採用 | 調査必須 | NO | allowlistでゲートする |
| 戦闘計算 | 未採用 | Myth Combat Simulator等を参考に設計 | NO | 既存の数値だけで生存保証しない |

## 優先確認ソース
1. https://wiki.melvoridle.com/w/Mod_Creation （公式Wiki）
2. https://mod.io/g/melvoridle/r/mod-context-api-reference （公式Wikiへ移転と記載）
3. https://github.com/GamesByMalcsPtyLtd/Melvor-Typing-Project （公式型定義）
4. https://github.com/CherryMace/melvor-mod-fatebreaker （公開サンプル）
5. https://mod.io/g/melvoridle/m/progression-guide （進行計画参考）
6. https://mod.io/g/melvoridle/m/action-queue （前提条件の実行計画参考）
7. https://mod.io/g/melvoridle/m/queue-o-matic （作業キュー参考）

## 実機調査手順（Codexへ）
- Melvorの起動バージョンを記録し、Creator ToolkitでこのMODを複製セーブにロード。
- ゲームのdevtoolsを利用できる場合、**読み取りだけで** `game.skills` と `game.completion` のプロパティを確認。
- スキルID、レベル、完成率を実際のUIと照合し、型・列挙手順・例外をここに追記。
- 書き込みAPIは別の複製セーブで操作直前後の状態差分を確認し、ガードを実装してから有効化。
- ゲームソースのコピーをリポジトリに入れない。ライセンスを確認する。

## P1-01 調査台帳（調査日: 2026-10-11、対象: Melvor Idle v1.3.1）

すべて **型宣言確認 / v1.3.1実機未検証 / 配布経路無効**。以下の読取りは `readCompletionForTesting` のモック専用入口に限定する。宣言だけでは内部副作用やCompletionの計算規則を証明できない。

| 関数/プロパティ | 公式出典 | 例外・不明時の扱い |
|---|---|---|
| `game.completion`, `.skills`, `.masterySkills`, `.items`, `.monsters`, `.pets`, `.stats`, `.petManager`, `.currentGamemode` | [game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts) | 必須データ欠落は該当カテゴリblocked。モード不明は全体blocked |
| `Completion.skillProgress/masteryProgress/itemProgress/monsterProgress/petProgress`, `currentCount/maximumCount.getCompValue(namespace)`, `getPercent(namespace)`, `totalProgressBaseGame/TotH/AoD/ItA` | [completionLog.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/completionLog.d.ts) | 非有限値・範囲外・列挙結果との不一致はblocked。`update*`, `render`, `setVisibleCompletion` は呼ばない |
| `NamespaceRegistry.allObjects`, `NamespacedObject.id/namespace/isModded` | [namespaceRegistry.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/namespaceRegistry.d.ts) | 配列以外、重複ID、名前空間不明はblocked。MOD名前空間は今回の対象外 |
| `Skill.level/abyssalLevel/currentLevelCap/currentAbyssalLevelCap/isUnlocked/levelCompletionBreakdown/abyssalLevelCompletionBreakdown/hasAbyssalLevels`, `SkillWithMastery.actions/masteryLevelCap/getMasteryLevel(action)/isMasteryActionUnlocked(action)` | [skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) | レベルのbreakdownを順に割当てる解釈は仮説。集計と照合、実機で要確認。欠落/例外はカテゴリblocked |
| `Item.ignoreCompletion` | [item.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/item.d.ts) | boolean以外はblocked |
| `Monster.ignoreCompletion` | [monsters.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/monsters.d.ts) | boolean以外はblocked |
| `Pet.ignoreCompletion`, `PetManager.isPetUnlocked(pet)` | [pets.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/pets.d.ts) | 取得例外/boolean以外はカテゴリblocked |
| `Statistics.itemFindCount(item)`, `monsterKillCount(monster)` | [statistics.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/statistics.d.ts) | 発見数/討伐数を0/1に変換するCompletion規則は実機照合待ち。銀行数量から代用しない |
| `Gamemode.id/isPermaDeath` | [gamemode.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/gamemode.d.ts) | 不明時はblocked。Hardcoreの戦闘候補は拒否 |

### 証拠の限界・採用しないAPI
- [CHANGES.md](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/CHANGES.md) の最新記載はゲームV1.2。一方、現在の型宣言にはItA/abyssalがある。mainの内容をv1.3.1向け確定資料と断言できず、タグ/ビルドの対応も未確定。
- Base (`melvorD`, `melvorF` → `melvorBaseGame`) / TotH (`melvorTotH`) / AoD (`melvorAoD`) / ItA (`melvorItA`) のスコープ対応はテスト用仮説。型はnamespaceをstringとして許容するが、この対応の意味は実機で確認する。
- DLC所有APIと起動中バージョン取得APIは未採用。Cloudオブジェクトやセーブを調べない。`lastLoadedGameVersion` は保存された過去のバージョンであり、起動中バージョンの代用にしない。テストのversion/ownershipを実ゲームの観測結果と混同しない。
- 公式Wiki [Mod Creation](https://wiki.melvoridle.com/w/Mod_Creation) は今回403で本文取得不可。再確認を残す。
- [Fatebreaker setup](https://raw.githubusercontent.com/CherryMace/melvor-mod-fatebreaker/main/setup.mjs) と [リポジトリ](https://github.com/CherryMace/melvor-mod-fatebreaker) を確認。MITの公開例はエントリ形式の参考のみで、Completion証拠やコード流用には使わない。
- 公式型定義リポジトリはGPL-3.0表記。型定義/ゲームソース/他MODをコピー・同梱せず、公開API名を参考に独自実装する。
- 例外は固定の理由コードに変換し、例外本文は記録しない（秘密情報混入防止）。一部のカテゴリが失敗しても他のカテゴリは観測可能。呼出しの自動再試行なし。

### 有効化前に必要な照合
1. 複製セーブ・開発専用MODプロファイルを用意し、起動中のv1.3.1ビルドと所有DLC、モード、他MODを記録する。
2. 上記APIの型/返り値を読取りのみで確認する。通常/abyssalのbreakdown、マスタリーの全アクション（未解放を含む）、除外フラグ、Base集計の名前空間をCompletion UIと照合する。
3. 各カテゴリの分子/分母/率と未達IDをUIで照合する。Baseのみ・各DLC・Hardcore・上限制限モード・全達成/未達のセーブで、未知/部分取得がblockedになることを確認する。
4. 観測前後にXP/GP/在庫/装備/行動/セーブがMODによって変更されないことを確認する。別MOD競合があれば中止する。
5. 認証情報を読まない所有判定API、起動中バージョン判定APIの証拠を追記してから、実機確認済みの読取り経路を別作業で導入する。今回のUIには有効化スイッチを追加しない。

### 続行時の環境確認（2026-10-11）
- Windows Computer Useの `sky.list_apps()` は `native pipe is unavailable / os error 2` で利用できなかった。ブラウザーインベントリはapps/browsersとも空で、接続可能なMelvor環境を確認できなかった。
- ゲームの起動、セーブの読み込み/変更、MODプロファイル変更、ゲームAPI呼出しは行っていない。P1-01の実機確認は引き続きNO。
- P2前提条件グラフは人工事実のみを扱う純粋モジュールとして追加。新たなゲームAPIの採用・有効化はない。

### P2純粋Planner（2026-10-11、対象ゲーム: v1.3.1、実機未検証）
- `src/planner.mjs` は人工スナップショット/グラフ/見積りのみを扱い、新たなゲーム関数/プロパティは採用・呼出ししない。既存のAPI台帳の実機確認ステータスは変更しない。
- `selectCompletionPlan` の効用重み・時間閾値・確率集計は独自の解析モデル。ゲームAPIの値・ゲーム内安全性・収益の実証ではない。実ゲームからこれらの見積りを取得するAPIは未採用。
- 未確認の読取り経路は引き続きblocked。配布UIと操作には接続せず、例外本文を固定理由に変換する。実機確認前の複製セーブ/専用MODプロファイル要件は維持する。

## P1-02 調査台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式main型宣言確認のみ。v1.3.1のビルド対応とgetter副作用は未検証。採用はテスト専用入口に限り、通常UIから呼ばない。型定義をコピー・同梱しない。

| 関数/プロパティ | 公式出典 | 例外・不明時の扱い |
|---|---|---|
| `game.bank/currencies/combat/currentGamemode/activeAction/pausedAction/isPaused/isGolbinRaid` | [game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts) | 未知版/モード/Raidは全体blocked。欠落・例外は該当カテゴリblocked |
| `Bank.items/lockedItems/occupiedSlots/maximumSlots`, `BankItem.item/quantity` | [bank2.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/bank2.d.ts) | Map/SetとID、数量、占有数を検査。集計矛盾でbank blocked。超過枠は観測して空き0 |
| `NamespaceRegistry.allObjects`, `Currency.id/amount` | [namespaceRegistry.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/namespaceRegistry.d.ts)、[currency.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/currency.d.ts) | 重複ID/空レジストリ/不正額/例外はcurrencies blocked。所有判定には使わない |
| `CombatManager.player`、`Player.equipmentSets/selectedEquipmentSet` | [combatManager.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/combatManager.d.ts)、[player.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/player.d.ts) | 選択番号不正/セット取得失敗はequipment blocked |
| `EquipmentSet.equipment`, `Equipment.equippedArray`, `EquippedItem.slot/item/quantity/isEmpty/occupiedBy`, `EquipmentSlot.id` | [equipment.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/equipment.d.ts) | 空/占有枠はプリミティブで区別、数量/重複/占有先矛盾はequipment blocked。空枠と占有枠の具体的挙動は実機照合待ち |
| `GatheringSkill.isActive/activeSkills`、`CombatManager.activeSkills`、関連スキルの`id` | [skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts)、[combatManager.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/combatManager.d.ts) | activeAction/pausedActionの実体に同形がある仮説。未知アクション/非配列/不正IDはactivity blocked。起動/停止は呼ばない |

実機照合: 複製セーブと専用MODプロファイルで銀行のロック/満杯/超過、少数通貨、全セットと二刀/両手装備、活動中/停止/一時停止/オフライン復帰をUIと比較する。観測前後の数量/通貨/装備/行動が変化しないことを確認するまで有効化しない。`getSnapShot`/`getSnapshot`やセーブencode/decode、資源add/remove/set、装備変更、アクションstopは未採用。

## P1-03 調査台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
- [woodcutting.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/woodcutting.d.ts) に `Woodcutting.activeTrees/isTreeUnlocked/selectTree`, `WoodcuttingTree.product/randomProducts`（productはSingleProductRecipeから継承）が宣言される。[skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) に `GatheringSkill.isActive/stop/canStop`、[baseManager.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/baseManager.d.ts) に `BaseManager.isActive/activeSkills` が宣言される。
- selectTreeは通常選択callbackだがtoggle/開始/停止の実機意味は未確認。副産物はtree.randomProductsだけでなくskill側のdefaultRandomProducts/randomProducts/randomJewelry等も考慮が必要。型だけで新規スタック上限を計算しない。
- モックexecutorは外部gameを扱わず、人工port `observe/selectTree/stop` を使用する。実ゲームadapter・allowlistは空、通常入口は無条件拒否。例外やtimeoutは固定理由で停止、操作の自動再試行なし。
- 環境確認: Windows操作機能は今回は接続でき、SteamのMelvorライブラリを確認。起動クリックはユーザー入力検出で拒否された。再観測で別アプリが前面にあるため入力を続行していない。ゲームwindow/API/バージョンは確認していない。ユーザーから複製セーブ/専用プロファイル未準備と回答（本チャット）。セーブの読込/複製/変更やMOD切替は行っていない。
- 有効化前: バックアップと複製、専用プロファイル、v1.3.1を確認し、通常UIとselectTreeの前後でactiveTrees/isActive/activeAction、XP/GP/在庫/装備を照合する。既選択/別木/複数木/銀行満杯/停止不可/例外を確認し、全副産物上限とstopの所有判定を記録する。

## P1-04監視（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIは採用しない。P1-01の既存列挙結果を `entries` として切り離した出力にも残す。集計との照合に失敗した場合はentries/missingとも空でsupported=false。既存APIの実機確認は引き続きNO。
- 純粋監視器に渡すactionSelection/sessionId/offline/nowMsは人工データ。実環境のイベントや起動中セッションからの取得経路は未採用。offlineLoopEntered/offlineLoopExitedの型宣言が存在しても、今回subscribeやゲーム停止を実行しない。
- モックの監視判断をテストexecutorのstopへ渡す試験は実APIの副作用/安全性の実証ではない。配布入口のblockedを維持する。

## P2素材数量（2026-10-11、対象: v1.3.1、実機未検証）
- 既存資源スナップショットと人工レシピの純粋計算だけ。新規ゲームAPIは採用/呼出ししない。保証出力/固定コスト/消費後生産/全副産物の根拠は人工fixtureのラベルであり、実際のゲームレシピを確認した意味ではない。
- ゲーム由来の収量・コスト保存・副産物・解放・ショップ在庫/価格・行動時間の読取りは未採用。実機の通常操作と照合する前に人工モデルを実環境に接続しない。

## P2接続（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。graph/recipeとaction/監視条件のbindingは人工フィクスチャだけを使用する。confirmedラベルは実環境の操作を許可しない。
- 生産の投影は内部計算用で、GameAdapterの観測結果として配布UIや操作portへ渡さない。最終監視条件は既存P1-01の明示Completion entriesを使用。実環境のrecipe/action bindingの構築は別途証拠確認を要する。

## P3カタログ台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式main型宣言確認のみ。v1.3.1ビルド/副作用/収量規則は未検証。テスト専用入口以外は無効。

| 関数/プロパティ | 公式出典 | 例外/意味の未確認時 |
|---|---|---|
| `game.woodcutting/smithing/currentGamemode/isGolbinRaid` | [game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts) | 版/人工context/モード/Raidゲート失敗は全体blocked |
| `Skill.actions.allObjects/id/isUnlocked/level/abyssalLevel/rareDrops`, `BasicSkillRecipe.level/abyssalLevel/baseExperience/baseAbyssalExperience` | [skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts)、[namespaceRegistry.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/namespaceRegistry.d.ts) | registry/skill形状不正はskill blocked。各actionの欠落/不正は個別blocked |
| `WoodcuttingTree.product/baseInterval/requirements/randomProducts`, `Woodcutting.defaultRandomProducts/randomProducts/randomJewelry/isTreeUnlocked/getTreeInterval/getTreeMultiplier` | [woodcutting.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/woodcutting.d.ts) | interval/multiplierを観測。multiplierから保証数量を推測しない。副産物IDは部分情報 |
| `Smithing.baseInterval/isMasteryActionUnlocked`, `SingleProductArtisanSkillRecipe.product/baseQuantity/itemCosts/currencyCosts`, `ArtisanSkill.getRecipeCosts` | [smithing.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/smithing.d.ts)、[artisanSkill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/artisanSkill.d.ts) | 基礎コストと修正後を別記。mastery解放を全操作条件の保証としない |
| `Skill.modifyInterval/getPreservationChance/getDoublingChance`, `Costs.getItemQuantityArray/getCurrencyQuantityArray` | [skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) | finite/range検査、例外は固定理由。保存/倍化/キャッシュの実機意味は未確認 |

- `getMinimumPrimaryProductBaseQuantity` の宣言は保証基礎数量の計算を示すが、query/追加数量/他rewardとの合成を実機で確認できていないため未採用。`modifyPrimaryProductQuantity`、random quantity helper、actionRewards、roll*、consumeCosts、選択/create callbackは呼ばない。
- 静的副産物にはrealm/gamemode条件があり、共通modifierの追加出力やmastery tokenを完全に列挙した証拠はない。カタログdraftはevidence=unknown。getRecipeCostsがキャッシュを更新し得ることを含め、実機でXP/GP/在庫/装備/行動/RNGに影響しないことを確認する必要がある。
- 型/ソースのコピー・同梱はしない。公開API名を参考に独自に実装。実機検証前の複製セーブ/専用プロファイル要件と配布のblockedを維持する。
- 今回のliveアプリ一覧確認ではSteam windowだけで、Melvorのgame windowは見つからなかった。入力/ゲーム起動/セーブ/プロファイル変更は実施していない。型宣言→モックの確認であり、実機確認NOを維持する。

## P3効果境界（2026-10-11、対象: v1.3.1、実機確認: NO）
- 新規ゲームAPIなし。収量/消費/時間の境界は確認済みというラベルを持つ人工入力のみ。保存率20%を消費80%へ換算したり、baseQuantityを保証下限へ昇格させない。
- 既存catalog draftは引き続きevidence=unknown。本作業は数値境界の純粋モデルであり、v1.3.1の実レシピ・modifier・RNG・全副産物の証明ではない。配布と実操作は無効。

## 作業窓（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。既存Completion snapshotと人工graphから候補の窓を作るだけ。全Completion集計/entries/ownershipを変更しない。部分窓の状態からゲームの100%を算出/宣言しない。
- カーソルはローカルの探索位置であり、ゲーム行動やセーブのcheckpointではない。実機読取り/操作のゲートを有効化しない。

## レシピ局所化（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。人工catalogのID/出力/素材関係をindex化し、効果根拠を検査する。観測catalogのpartial/unknownをconfirmedへ変換しない。実機境界/操作/全副産物の証拠は未取得。

## P4制御/保存（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPI/storage APIは採用しない。observe/executor/storeは人工portのみ。実環境controller factoryはport/getterを参照せず無条件拒否。ctxのゲーム保存やCloud、characterStorageへの接続は未実装。
- checkpointはMODの計画記録であり、ゲームのセーブをencode/decode/上書きするものではない。JSON storeの実ブラウザー/Mod Contextへの接続とクラッシュ耐久性は別途検証が必要。

## P4戦闘台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
| 関数/プロパティ | 公式出典 | 不明/例外時 |
|---|---|---|
| `CombatManager.player/enemy/selectedMonster/paused`, `BaseManager.isActive/fightInProgress` | [combatManager.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/combatManager.d.ts)、[baseManager.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/baseManager.d.ts) | 敵不一致/boolean不正はblocked。selection/startFight/stop等は呼ばない |
| `Character.hitpoints/damageType/activeEffects/availableAttacks`, `CharacterCombatStats.dirty/maxHitpoints/maxHit/attackInterval/getResistanceByID` | [character.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/character.d.ts) | dirtyならgetter数値取得を保留。statsの内部cache更新と単位/ダメージ規則は実機未確認 |
| `Player.autoEatThreshold/autoEatHPLimit/autoEatEfficiency/food`, `EquippedFood.selectedSlot/slots`, `FoodData.item/quantity`, `FoodItem.healsFor` | [player.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/player.d.ts)、[equippedFood.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/equippedFood.d.ts)、[item.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/item.d.ts) | raw値を観測、healsForから修正後healingを算出しない。autoEat/consume/equip/set等は未採用 |
| `Enemy.monster` | [enemy.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/enemy.d.ts) | 未選択を無害な敵とみなさない |

- [attacks.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/attacks.d.ts) にはHP/反射/状態依存damage rollやDoTがある。getMaxDamage/getDamageRoll/damageReducerは今回未採用。攻撃件数/通常maxHitだけで全incoming damageの上限を証明しない。attacks2.d.tsはfetch不可で未採用。
- envelopeの完全coverage/最短間隔/軽減後burst/healing最小は人工データの証拠だけ。実機効果/食料/Auto Eat timingを照合するまで実戦の安全性を表明せず、v0.1.0のruntime操作は無効を維持する。

## P5監査（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。既存P1-01 snapshotのentries/missingと公式scope集計を照合。独自の総率や手動目標を追加しない。actualComplete=falseを固定し、mock整合の達成を実機100%へ昇格しない。
- 停滞reportはMODの観測/理由記録だけ。セーブやgame globalを読み書きしない。lockedだけでは到達不能の証拠がないため未達/条件不明として報告する。

## P3採掘/釣り/料理台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式mainの宣言確認のみ。コード全体はコピーせず、関数/プロパティの契約を参照した独自adapterを追加する。テスト用のみ、通常APIは無効。`mining.d.ts` / `mining2.d.ts` は404で、GitHub contents一覧から `rockTicking.d.ts` を特定して取得した。

| 関数/プロパティ名 | 公式ソースURL | 例外時/意味が未確認の挙動 |
| --- | --- | --- |
| `game.mining/fishing/cooking` | [game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts) | 共通version/context/mode/Raidゲート後のみ。skill欠落は個別blocked |
| `MiningRock.product/baseQuantity/baseRespawnInterval/totalMasteryRequired/hasPassiveRegen/giveGems/shopItemPurchased/category/currentHP/maxHP/isRespawning`, `Mining.baseInterval/coalItem/runestoneItem/isMasteryActionUnlocked/canMineOre/getRockGemChance/getRockSuperiorGemChance/getRockAbyssalGemChance` | [rockTicking.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/rockTicking.d.ts) | 欠落/形状/数値不正は個別blocked。HP/復活はraw観測のみ。gem/副産物全体/通常採掘の保証を補完しない |
| `Fish.product/strengthXP/baseMinInterval/baseMaxInterval/area`, `Fishing.areas.allObjects/junkItems/secretAreaUnlocked/isMasteryActionUnlocked/getMinFishInterval/getMaxFishInterval/getAreaChances`, `FishingArea.fish/requiredItem/isSecret/poiRequirement/fishChance/junkChance/specialChance`, `FishingAreaChances.fish/junk/special` | [fishing.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/fishing.d.ts) | area registry重複はskill blocked、魚/area参照矛盾や不正chance/intervalは個別blocked。special tables/contest等は未採用。秘密/POI/装備条件の充足をmastery可否で代替しない |
| `CookingRecipe.category/perfectItem/discoveredItems/baseInterval`, `CookingCategory.upgradeRequired/upgradeOwned`, `Cooking.categories.allObjects/isMasteryActionUnlocked/getRecipeCookingInterval/getRecipePassiveCookingInterval/getRecipeSuccessChance/getRecipePerfectChance/getRecipeCosts/passiveCookTimers/stockpileItems/activeCookingCategory` | [cooking.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/cooking.d.ts) | recipe例外は個別blocked、passive state失敗は別DTOでblocked。stockpileをbankへ合算しない。成功100%でも保証数量はunknown |
| 共通recipe `level/abyssalLevel/baseExperience/baseAbyssalExperience/product`、skill `modifyInterval/getDoublingChance/getPreservationChance`、Costs読取り2関数 | [skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts)、[artisanSkill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/artisanSkill.d.ts) | 基礎/修正後コストを分け、例外本文を出さない。query/cache副作用は実機照合待ち |

- getActionRewards/乱数/HP更新/選択/採掘/調理/受動開始停止/stockpile収集/consume/encode/decodeは未採用。v1.3.1複製セーブでUIとの照合と読取り副作用の確認が済むまで、効果/operation証拠はunknown・planningReady/runnable=falseを維持する。

## P3共通Artisan台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式main型宣言をWeb/GitHub読取りで確認。独自adapterだけを実装し、型コードのコピー/ゲーム操作/実ゲームAPIの有効化はしない。

| 関数/プロパティ名 | 公式ソースURL | 例外時/意味が不明な場合 |
| --- | --- | --- |
| `game.crafting/fletching/runecrafting/herblore/summoning` | [game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts) | 共通ゲート後のみ、欠落skillは個別blocked |
| 共通 `categories.allObjects/baseInterval/isMasteryActionUnlocked/getRecipeCosts`、recipe `category/itemCosts/currencyCosts`、single-product recipe `product/baseQuantity` | [artisanSkill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/artisanSkill.d.ts)、[skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) | 関連category参照を照合。Herbloreにproduct/baseQuantityを要求しない。既存のmodifier/Costs読取りに実機証拠を追加したわけではない |
| `CraftingRecipe.subcategory` | [crafting.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/crafting.d.ts) | optional IDだけ。category/関連IDの不正は個別blocked |
| `FletchingRecipe.subcategory/alternativeCosts[].itemCosts/quantityMultiplier`, `Fletching.setAltRecipes` | [fletching.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/fletching.d.ts) | 基礎と代替を分離。設定indexはraw値、対応/既定値を推測しない。非Map/件数/数値/素材不正はblocked |
| `RunecraftingRecipe.subcategories`, `Runecrafting.doesRecipeMakeWaterComboRunes` | [runecrafting.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/runecrafting.d.ts) | ID集合/booleanだけ。追加runeの全出力を証明しない |
| `HerbloreRecipe.potions`, `Herblore.getPotionTier` | [herblore.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/herblore.d.ts) | 4段階IDと非負raw tierを観測。0/1始まりの実証がないのでproductId/baseQuantityはnull、数量draftに同時4出力を入れない |
| `SummoningRecipe.nonShardItemCosts/tier/skills/maxMarkLevel`, `Summoning.selectedNonShardCosts/getAltRecipeCosts/getMarkCount/getMarkLevel` | [summoning.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/summoning.d.ts) | 選択素材は候補内の参照を確認、設定なしはnull。markを自動発見/既知ゼロへ補完しない。個別例外/不正はrecipe blocked |

- selectedRecipe/activeRecipe/actionItem/unmodifiedActionQuantity/actionRewards/乱数/代替選択/create/consume/discoverMark/rollMarks/XP付与/保存は未採用。getter/cacheの副作用とtier/alt index対応は複製セーブでの実機照合待ち。

## P3農業台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式mainの宣言だけを確認し、独自のモック専用readerを追加。実機版/読取り副作用/効果境界は未確認で通常入口は無効。

| 関数/プロパティ名 | 公式ソースURL | 例外/不明時の挙動 |
| --- | --- | --- |
| `game.farming` と共通SkillのID/namespace/isModded/isUnlocked/level/abyssalLevel/actions.allObjects | [game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts)、[skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) | 共通context/version/mode/Raidゲート後のみ、skill形状不正は全体blocked |
| `Farming.categories/plots/composts.allObjects`, `FarmingCategory.returnSeeds/scaleXPWithQuantity/harvestMultiplier/masteryXPDivider/giveXPOnPlant`, `FarmingRecipe.category/product/baseInterval/baseQuantity/seedCost/level/abyssalLevel/baseExperience/baseAbyssalExperience` | [farming2.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/farming2.d.ts) | registry不正/重複はsection破棄。個別欠落/例外はrecord blocked、関連参照/所有も照合 |
| `Farming.isMasteryActionUnlocked/getRecipeSeedCost/getRecipeInterval` | [farming2.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/farming2.d.ts) | 基礎と修正値を分離。interval/helper単位は未実証としてraw、不正値はrecord blocked |
| `FarmingPlot.category/level/abyssalLevel/itemCosts/currencyCosts/state/plantedRecipe/selectedRecipe/compostItem/compostLevel/growthTime`, enum `Locked=0/Empty=1/Growing=2/Grown=3/Dead=4`, `Farming.getPlotUnlockCosts/canUnlockPlot/getPlotGrowthChance/getPlotGrowthTime` | [farming2.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/farming2.d.ts) | lockedのみ解放helper、growingのみ成長helper。state不明/参照矛盾はrecord blocked。growthTimeは宣言にseconds、helper単位を同一と推測しない |
| `Farming.growthTimers/growthTimerMap`, `FarmingGrowthTimer.plots` | [farming2.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/farming2.d.ts) | Set/Map/所属/重複/件数矛盾でtimer section blocked。timer body/ticks/残り時間を参照しない |
| `CompostItem.compostValue/harvestBonus/disableSeedRefund/compostAllCost`, Costsのitem/currency配列読取り | [item.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/item.d.ts)、[skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) | raw基礎値と区画量を分離。収量/費用/返種の完全保証はunknown、例外はrecord blocked |

- plant/harvest/reset/clearDead/compost/unlock/growPlots/passiveTick/createGrowthTimer/乱数/報酬/XP/tempCompostQuantityModifier/encode/decodeは未採用。空区画・成熟・枯死を在庫へ投影せず、planningReady/runnable=falseを維持する。

## P3ショップ台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式main型宣言だけを確認。rawの価格/要件/制限と関数の観測値を分離し、ゲームへの購入操作は行わない。

| 関数/プロパティ名 | 公式ソースURL | 例外/未知時の挙動 |
| --- | --- | --- |
| `game.shop`, `Shop.categories/purchases.allObjects/buyQuantity/upgradesPurchased/getPurchaseCount/isUpgradePurchased/isPurchaseAtBuyLimit/capPurchaseQuantity/getPurchaseCosts` | [shop.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/shop.d.ts)、[game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts) | 共通gate後のみ。quoteは数量1/capまで、UI数量変更なし。Mapに値がある場合countを照合。raw/quoteの不正や例外は個別blocked |
| `ShopCategory.isGolbinRaid/allowedGamemodes`, `ShopPurchase.category/allowedGamemodes/allowQuantityPurchase/getBuyLimit/unlockRequirements/purchaseRequirements/costs/contains` | [shop.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/shop.d.ts) | category登録/所有を照合しRaidは除外。allowed modesの空集合/limit0の意味は未実証、購入可能へ昇格しない |
| `ShopCost.items/currencies`, price `type/cost/initial/scaling`（Fixed/Linear/BankSlot/Glove）、contains `items/itemCharges/pet/lootBox/bankTab/stats` | [shop.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/shop.d.ts) | 価格構造と修正quoteを分離。未知価格typeはunknownとしてquoteを保留し、bodyは読まない。統計効果/全出力/銀行容量/在庫/Completionは投影しない |
| `GameRequirement.isMet`, `ShopPurchaseRequirement.type/purchase/count`, `SkillLevelRequirement.type/skill/level`, `AbyssalLevelRequirement.type/skill/level` | [requirements.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/requirements.d.ts) | 3種だけ狭い構造を観測。参照が未登録/未所持/MOD/不明ならisMetを呼ばずunverified。他の型はbody/通知非参照。未知をmet=trueへ補完しない |
| Costs `getItemQuantityArray/getCurrencyQuantityArray` | [skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) | quoteの返り値を切り離し、finite/数量/ID/重複を検査。消費/所有チェックは呼ばない |

- buyItemOnClick/quickBuy/updateBuyQuantity/getCurrencyCost/銀行価格関数/computeProvidedStats/removePurchasesAboveLimit/requirement.check/notifyFailure/consumeCosts/encode/decodeは未採用。cache/価格/allowed modes/limit特殊値/要件の実機意味は照合待ちで、canPurchase=null、planningReady/runnable=falseを維持する。

## P2ショップ依存変換（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。切り離したshop snapshotの購入回数・要件DTOだけを純粋graphへ変換し、Graph evidence=unknownを維持する。価格quote/在庫/銀行/ゲーム状態を書き換えない。
- 充足済み回数は観測上のcompletedフラグにするが、APIの実機検証やoperation証拠に昇格しない。prototype graphは既存Resolverに安全な確認済み経路として扱われない。

## P2生産依存変換（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。Completion item観測と生産catalogのDTOだけから依存構造を生成。nominal/observed costsは構造の情報であり、保証効果・時間・操作・収量の証拠にしない。
- partial output IDs/potion候補を同時・保証出力として使わず、GameAdapter/既存evidenceの実機未確認状態を維持する。複数snapshotの時刻同一性は未証明、stock/報酬/Completionの投影なし。

## P2入手経路統合（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。既存shop/production DTOの通常item、条件、nominal/quote costを依存構造として接続。購入回数を新規入手へ変換しない。shop-operationは常に未完了/unknown。
- containsのpartial効果、quote、価格形式から銀行/在庫/必要回数/保証供給を計算しない。通常入口・operation許可は引き続き無効。

## P1統合観測（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。既存5 readerと共通currentGamemode/isGolbinRaidのヘッダーをモック専用入口で照合する。原子的観測/時刻同一性や実機API検証の代替にしない。
- 正常入口は無条件拒否。統合frame/監査/調達構造は実行許可、player state、報酬、セーブを生成しない。read-only helper/cacheの実機副作用は照合待ち。

## P4観測フェーズ（2026-10-11、対象: v1.3.1、実機未検証）
- 新規ゲームAPIなし。モックobserver/controllerのphaseで既存readerとdomain解析の実行頻度を分ける。監視でもresources/全Completionの観測は行うが、生産/店/農業/graphはdeferredとする。
- offlineは呼出し元の現在flagを記録するだけでゲーム時間/報酬を進めない。実機イベント・原子性・cache・normal操作を検証した意味ではない。

## P1対象Completion台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式main型宣言の存在を確認しただけで、normal入口は無効。既存progress定義を対象ごとに使う独自readerをモックで検証する。

| 関数/プロパティ名 | 公式ソースURL | 例外/未知時 |
| --- | --- | --- |
| `NamespaceRegistry.getObjectByID`（game.skills/masterySkills/items/monsters/pets、mastery skill.actions） | [namespaceRegistry.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/namespaceRegistry.d.ts) | 未登録はundefined、返却ID/namespace/MOD不一致は対象blocked。dummy生成/全件配列は使わない |
| `Completion.*Progress.maximumCount.getCompValue(scope namespace)` | [completionLog.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/completionLog.d.ts) | 対象max以上の正safe integerを要求。scope/categoryごとに1回。全current/percentを推測しない |
| skillの`level/abyssalLevel/currentLevelCap/currentAbyssalLevelCap/levelCompletionBreakdown/abyssalLevelCompletionBreakdown/hasAbyssalLevels/isUnlocked`、masteryの`masteryLevelCap/getMasteryLevel/isMasteryActionUnlocked` | [skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) | scope/track/offsetを照合、不正/欠落/例外は固定理由。Completion既存定義の対象値であり実機保証ではない |
| collectionの`ignoreCompletion`、`stats.itemFindCount/monsterKillCount`、`petManager.isPetUnlocked` | [item.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/item.d.ts)、[statistics.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/statistics.d.ts)、[pets.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/pets.d.ts) | 既存P1定義を対象だけに適用。ignore/MOD/未所持は値helperを呼ばない。所持/報酬/Completion改変なし |

- allObjects/全registry/currentCount/getPercent/セーブ/報酬/操作は未採用。coverage=targets-onlyとして全体auditに使わず、モード/対象/分母の実機照合を終えるまで有効化しない。

## P1対象資源台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式main型宣言確認のみ。bank/currency対象lookupと既存equipment/activity readerをモック入口で共用し、通常入口は無効。

| 関数/プロパティ | 公式ソースURL | 例外/未知時 |
| --- | --- | --- |
| `game.items/currencies.getObjectByID`、`Currency.amount` | [namespaceRegistry.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/namespaceRegistry.d.ts)、[currency.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/currency.d.ts) | 返却ID一致を検査。未登録/不正はカテゴリblocked、量ゼロへ補完しない。MOD/DLC inventoryは所有の証拠ではない |
| `Bank.getQty/lockedItems/occupiedSlots/maximumSlots` | [bank2.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/bank2.d.ts) | getQtyは非負safe int、lockはSet.has対象のみ、cached slotsと対象正量数を照合。全items/locked iterationなし |
| 既存equipment/player selectedEquipmentSet/equipmentSets、activity active/paused/isPaused | [player.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/player.d.ts)、[game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts) | 既存P1共通readerの上限/形状/例外検査を再利用。全装備セット/現在行動は部分bankとは別に観測 |

- bank追加/消費/売却/移動/lock変更/通貨add/remove/保存/報酬は未採用。副作用とslots/getQtyの実機意味は未確認、partialをfull予測・実行へ使用しない。

## P1行動選択台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式main型宣言の存在確認のみ。read-only helperをモックで観測し、normal入口/operationは無効。

| 関数/プロパティ名 | 公式ソースURL | 例外/未知時 |
| --- | --- | --- |
| `game.activeAction/pausedAction/isPaused/currentGamemode/isGolbinRaid`、ActiveAction `id/isActive` | [game.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/game.d.ts)、[skill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/skill.d.ts) | 未定義はidle、null/不正/状態矛盾はblocked。IDだけで選択や所有を推定しない |
| `Woodcutting.activeTrees/isUnlocked/isActive/canStop/actions.getObjectByID/isTreeUnlocked`、WoodcuttingTree `id/namespace/isModded/product` | [woodcutting.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/woodcutting.d.ts)、[namespaceRegistry.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/namespaceRegistry.d.ts) | Set/ID/同じregistry参照/所有を照合。activeTree集合とisActiveは別に保持。primary IDだけでは全副産物/安全な出力を証明しない |

- selectTree/start/stop/onStop/XP/actionRewards/乱数/保存は未採用。全出力/cache副作用/通常操作の実機証拠はなくoutputsEvidence=unknown、runnable=falseを維持する。

## P1追加選択台帳（2026-10-11、対象: v1.3.1、実機確認: NO）
公式mainの宣言だけを確認し、モック専用観測を追加。normal/operation許可なし。

| 関数/プロパティ | 公式ソースURL | 例外/未知時 |
| --- | --- | --- |
| `Mining.selectedRock/actions.getObjectByID` | [rockTicking.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/rockTicking.d.ts) | selected objectとregistry参照を照合。activeRock/HP更新/選択は呼ばない |
| `Fishing.activeFishingArea/selectedAreaFish/areas.getObjectByID`、`Fish.area`、`FishingArea.fish` | [fishing.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/fishing.d.ts) | area/fish/所属を照合、欠落Map/不正はblocked。activeFish/contest/選択/乱数は未採用 |
| `Cooking.activeCookingCategory/selectedRecipes/categories.getObjectByID`、recipe.category | [cooking.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/cooking.d.ts) | stationとrecipeを分け、未登録/所有/参照不一致を拒否。activeRecipe/passive/収集操作は未採用 |
| `ArtisanSkill.selectedRecipe/actions.getObjectByID`、`Fletching.setAltRecipes`、`Summoning.selectedNonShardCosts/nonShardItemCosts` | [artisanSkill.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/artisanSkill.d.ts)、[fletching.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/fletching.d.ts)、[summoning.d.ts](https://raw.githubusercontent.com/GamesByMalcsPtyLtd/Melvor-Typing-Project/main/src/gameTypes/summoning.d.ts) | raw selectionだけ。設定なしはnull、番号対応/既定素材を推測しない。動的getter/create/consume/discovery/保存は未採用 |

- selection variantは観測された狭い値の変更検出だけで、製品/価格/コスト/operationを検証済みにしない。通常入口とexecutor allowlistは変更しない。
