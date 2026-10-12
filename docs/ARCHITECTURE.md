# アーキテクチャ

## P0の実機導入（2026-10-12）
- manifestのnamespaceは非予約の`autopilot`。Creator Toolkitで登録するZIPはmanifest/setupの2件のみ。srcのモックcontroller/操作基盤とprivate backupは含めない。
- UI bootstrapの成功とGameAdapterの許可は独立。複製スロット2でUIが動いても通常の読取り/操作入口の無条件拒否を維持する。
- log欄は通常divに明るい文字色とpre-wrap/最大高さ/scrollを明示し、ゲームのpreタグ向けスタイルを避ける。ログpayloadと容量制限は変更しない。

## ゴール形
```text
Melvor's game object (read-only)
         |
         v
 GameAdapter / Mode & DLC detection
         |
         v
 StateSnapshot  ----->  CompletionScanner
         |                     |
         +----------+----------+
                    v
 CandidateGenerator + DependencyGraph
                    |
                    v
 Planner (utility / time / unlock / risk)
                    |
                    v
 SafetyGuard (version / save / mode / resource / combat)
                    |
                    v
 ActionExecutor (allowlisted commands only)
                    |
                    v
 ResultVerifier -> EventJournal -> Next snapshot
```

## 実装状況
- `setup.mjs`: `setup(ctx)` + 解析専用UI + 10秒ごとの状態確認。実機確認済みの読取り経路がないので、通常の `readSnapshot` はゲームオブジェクトを参照せずblockedを返す。以前の推測スキル読取りと最低レベル提案は置き換えた。
- ゲームAPIを利用する書き込み処理は **存在しない**。
- `readCompletionForTesting` はモック専用GameAdapter。所有スコープ・モードを分離し、カテゴリ別に公式集計と未達列挙を照合する。例外や不一致は固定理由のblockedで部分失敗を表現する。
- `generateCompletionCandidates(snapshot)` はプリミティブのみのスナップショットから候補とブロッカーを返す純粋関数。配布UIの `chooseNextGoal` はID順の最初の候補を提示するだけ。独立した `src/planner.mjs` に人工見積り用Plannerを実装したが、配布UIには接続しない。すべて実行不可。
- 単一ESMファイルにしているのは、ロード時の相対モジュール解決を未検証なため。後でビルドツールで1つの配布物にまとめてもよい。

## 状態モデル（将来）
```ts
type Snapshot = {
  version: string;
  mode: { id: string; hardcore: boolean; dlc: string[] };
  skills: SkillState[];
  bank: Record<string, number>;
  currencies: Record<string, number>;
  combat: { fighting: boolean; hp: number; maxHit?: number };
  completion: {
    scopes: Record<string, {
      percent: number | null;
      missing: CompletionTarget[];
      supported: boolean;
    }>;
  };
};

type Task = {
  id: string;
  category: string;
  target: string;
  amount: number;
  prereqs: string[];
  costEstimateMs: number | null;
  risk: 'safe' | 'uncertain' | 'dangerous';
  executionStatus: 'ready' | 'blocked' | 'unverified';
};
```

## 今回の観測モデル
- `version`, `mode: { id, hardcore }`, `dataAvailable`, `completion: { supported, status, reason, achieved, scopes }`。
- スコープは `id`, `ownership: boolean|null`, `status: observed|blocked|excluded`, `percent: number|null`, `supported`, `achieved`, `categories`。所持不明をfalseに変換しない。
- カテゴリは `current`, `maximum`, `percent`, `supported`, `reason`, `entries`, `missing`。entriesは達成済みを含む照合済み全項目。各項目はID・名称・current/maximum・解放状況・skillId・通常/abyssalトラック等のプリミティブだけ。entriesとmissingのオブジェクトを分離し、未知API時は両方空にしてsupported=false。
- 集計と全項目の分子/分母が一致した場合のみカテゴリをsupportedとする。失敗したカテゴリの部分リストは破棄し、他の観測可能なカテゴリは残す。
- `completion.achieved` はモック内の照合結果であり、実ゲームの100%達成を表明するものではない。所有不明、部分失敗、全カテゴリ分母ゼロではfalse。
- 配布ファイルは引き続き単一ESM。テスト専用入口は配布UIの呼出し経路に接続せず、実ゲーム向けの有効化スイッチも用意しない。

## 資源観測モデル（2026-10-11 / P1-02モック専用）
`src/resources.mjs` の `readResourcesForTesting(gameFixture, { version: 'v1.3.1' })` は、`bank/currencies/equipment/activity` ごとに `{ supported, status, reason, data }` を返す。未取得のdataはnull、全体のsupportedは全カテゴリの論理積。IDと数量/booleanだけを保持し、外部のMap/Set/ゲームオブジェクトは出力しない。通常入口 `readResourceSnapshot` はgetterを参照せずblockedを返す。setup/配布ZIPに接続しない。

- bank: `{ items: [{ id, quantity, locked }], lockedIds, maximumSlots, occupiedSlots, freeSlots, overCapacity }`。在庫Mapの実スタック数とoccupiedSlotsを照合。ロックされた未所持IDも保護情報として保持し、ロックを消費許可やCompletion達成とみなさない。超過銀行は空き0。
- currencies: `{ currencies: [{ id, amount }] }`。少数通貨を整数に丸めない。登録IDは所持DLCの根拠ではない。空/重複レジストリは未取得として扱う。
- equipment: `{ selectedSet, sets: [{ index, slots: [{ slotId, itemId, quantity, empty, occupiedBySlotId }] }] }`。セット順は意味があるので維持、枠順はIDで整列。空枠のitemIdはnull、占有参照は同じセットの非空rootへ限定。銀行へ装備数量を加算しない。
- activity: `{ isPaused, active: { id, isActive, skillIds }|null, paused: 同形|null }`。宣言上undefinedのアクションのみnullへ変換。isActiveとisPausedを保持し、未知形を「停止済み」と推測しない。行動開始/停止は呼ばない。
- 版/モード/Raidのゲート失敗は全体blocked。部分失敗はそのカテゴリだけ破棄。各コレクションに上限、数値/ID/占有参照に検査を設ける。実機ではMap/Setのrealm、空/占有枠、idle/pausedの表現を照合する必要があり、実機未検証。

## 前提条件グラフ（2026-10-11 / ドメイン層のみ）
`src/prerequisites.mjs` はゲームAPIを呼ばず、既存の純粋候補生成を利用する独立モジュール。配布用setupからimportせず、ZIPにも含めない。実データのグラフ構築ができるまでNodeで検証する。

```ts
type PrerequisiteNode = {
  id: string; // Completion終点は候補IDと一致。中間ノードは安定した事実/作業ID。
  scopeId: 'base' | 'toth' | 'aod' | 'ita';
  evidence: 'confirmed' | 'unknown';
  completed: boolean;
  routes: {
    id: string;
    requires: string[]; // AND。routesの間はOR。
    evidence: 'confirmed' | 'unknown';
    kind: 'noncombat' | 'combat';
    risk: 'safe' | 'unknown' | 'dangerous';
    durationMs: number | null;
  }[];
};
```

- `resolvePrerequisites(graph, targetId, context, limits)` は `satisfied` / `planned` / `blocked`、前提順のsteps、推定時間、探索量、棄却理由を返す。`planned` は理論上の作業分解であり、`runnable` は常にfalse。confirmedは入力事実の根拠状態であり、実行APIへの許可ではない。
- 現在の探索経路だけで循環を判定する。ある経路で失敗したノードを全経路で不可とキャッシュしない。経路はID順に探索し、合計推定時間、手順数、安定IDで選ぶ。
- 共有ノードの同じ経路は一度だけ。共有ノードに異なる経路が必要な組合せはblockedにする。各部分問題のローカルな選択なので、大域最短経路や全ての可能な組合せの発見は保証しない。
- 既定上限: ノード512、経路/ノード16、前提/経路32、深さ24、探索回数1000、棄却理由64。上限値にはハード上限も設け、Infinityや文字列を拒否する。
- Completion候補を含む合成node/target/前提IDは最大16384文字、元のroute IDは最大1024文字。コンパイルしたoperation/task IDにも16384文字上限を設け、それを超える組合せは理由付きで拒否する。
- `planCompletionCandidates(snapshot, graph, options)` は個別目標の入力なしで候補を処理する。既定の候補数50、総探索回数2000。個別の探索失敗はブロッカーにして次候補へ進み、総予算不足なら部分計画を破棄する。Completionのスコープ/未達状態とグラフ終点の矛盾も拒否する。
- このbooleanグラフ自体は素材量・生産回数・同じ在庫の消費競合を扱わない。数量計算を伴う接続には下記 `selectQuantifiedCompletionPlan` を使い、各段階の需要を再計算する。従来の `selectCompletionPlan` は資源未評価の解析用であり、実行判断に使わない。
- 効用評価・ヒステリシス・現在行動の継続判断は以下の独立Plannerで人工データをモック検証。実データからのCompletion増分・解放効果・信頼性の推定は未実装。

## 純粋Planner（2026-10-11 / ドメイン層のみ）
`selectCompletionPlan(snapshot, graph, estimates, { nowMs, current?, policy?, planning? })` は `planCompletionCandidates` が返した安全な前提経路を評価する。ゲームAPI・時計・乱数・ストレージを利用せず、配布setupからimportしない。最短時間で分解された経路間の候補選択であり、効用による経路の再探索や大域最適化は行わない。

- 見積り: `{ stepId, evidence, completionGain, unlockValue, consumptionCost, reliability, deathProbability }`。`stepId` はグラフの `JSON.stringify([nodeId, routeId])`。全数値必須、`evidence: confirmed` は人工事実の根拠であり実ゲームの検証/操作許可を意味しない。経路が変われば別IDとなり、見積り不足ならblocked。
- Completion増分はスコープ内の割合（0〜1）。異なるスコープの同じ割合は同じ重みで評価する人工モデルで、ゲームの総Completion率を再計算しない。解放効果/消費は人工の共通単位（0〜1e9）。見積りは最大4096件。重複/不正IDは全体をblocked、値や根拠の不備はその候補をblockedにして次へ進む。
- 共有前提を一度だけ集計し、信頼性下限は `max(0, 1 - Σ(1-reliability))`、死亡確率上限は `min(1, Σ(deathProbability))`。独立性は仮定しない。既定では信頼性0.5以上、死亡確率0のみ。非戦闘の死亡確率は必ず0、Hardcore/モード不明の戦闘はグラフ段階で拒否。既知の安全性を効用で相殺しない。
- 固定スコア: `100*completionGain + 10*unlockValue - 0.01*durationSeconds - consumptionCost - 100*(1-reliability) - 1000*deathProbability`。Completion増分合計が0/1超過なら拒否。スコアの内訳を返し、同点は候補ID順。実際の所要時間/収益の予測としては未検証。
- `current` は `{ candidateId, stepId, startedAtMs, lastSwitchAtMs, evaluatedAtMs }`。すべて呼出し元が供給する解析状態。時刻は非負safe integer、`lastSwitchAtMs <= startedAtMs <= evaluatedAtMs <= nowMs`。逆行/欠落をblockedにし、システム時計変更後は呼出し元の明示的な状態リセットが必要。永続化やゲームの自動再開は行わない。
- 現在候補の最初の作業が再評価後も安全なら30秒の最小継続、60秒の切替クールダウンを適用。その後、改善幅が `1 + 0.05*abs(currentScore)` を超えると切替。同点や境界は継続し、浮動小数点誤差にはスコア規模に応じた16 ULP相当の許容幅を設ける。`policy` でこれらの人工評価設定を変更可能だが、未知キー/不正値/24時間超の待機時間は拒否。
- 現在候補が達成済み/危険/未確認、最初の作業が変化した場合は継続制約を解除。安全な代替がなければblocked、`nextCurrent: null`。別候補でも最初の作業IDが同じなら作業の継続とし、開始/切替時刻を維持する。
- 戻り値は `selected|continue|switch|blocked`、固定理由、選択と評価内訳、最初の前提作業、次の継続状態、候補別ブロッカー、探索量。`runnable` は全階層false。総探索上限なら部分順位を破棄し、不読入力の例外本文を返さない。

## 木こり命令の検証基盤（2026-10-11 / P1-03モック専用）
`src/executor.mjs` の `createWoodcuttingExecutorForTesting({ observe, selectTree, stop }, options)` は人工portのtransaction protocol。ゲームオブジェクトや通常APIadapterは受け取らず、setup/ZIPから接続しない。`createWoodcuttingExecutor` はすべての実操作を無条件拒否し、ゲームやoptionsのgetterにも触れない。既存配布UIは解析専用のまま。

- 初期stopped。`start` の版/複製セーブ/開発プロファイル/互換性/操作検証フラグはテスト用の人工事実。本番allowlistの代わりに使えない。開始/停止状態はメモリ内で、再起動時に自動再開しない。
- 入力命令は `{ id, kind: woodcutting-start, treeId }` のみ。スナップショットは `{ resources: P1-02出力, woodcutting: { supported, skillId, unlocked, isActive, canStop, activeTreeIds, trees: [{ id, unlocked, outputIds, outputsEvidence }] } }`。木こり部分は人工データで、ゲームからのreaderは未実装。全副産物outputIdsの根拠不足は拒否する。
- 前提は全資源観測、未解放/一時停止/別アクション/曖昧なidle選択の拒否、全possible outputの最悪新規銀行枠数。既に同じ木だけ稼働中ならcallbackを呼ばない。これはプレイヤーが始めた既存行動として観測し、executorの停止対象に新たに採用しない。
- 操作後は同じ木だけ稼働、版/モード/解放状態、通貨/全装備不変、銀行数量の非減少を確認。自然な採集増加は許可。実ゲームでは他のpassive処理等との照合方針を検証する必要があり、現在の保守的な検査が通常プレイに適する保証はない。
- メモリcheckpointは命令ID/対象/phaseだけ、最大1000件（テスト設定で縮小可能）。attemptedをcallbackより先に記録。二重命令/ID流用/並行操作/限界到達を拒否し、失敗した操作を再試行しない。readだけ最大2回。pending操作があればsession再開を拒否。
- 各portは既定5秒、最大30秒のtimeout。停止は世代tokenを即座に更新し、停止前のread結果から新しい操作を開始しない。Promiseのtimeoutは実操作のcancelではないので、遅延callbackのsettlementを追跡し、停止後の遅延稼働も所有確認付きでcleanupする。
- cleanupは自分が開始を試みた単独の木こりのみ。未知観測/停止不可/別行動/停止失敗は理由を返し手動確認を要求する状態へ固定。未確定のmutation中にidleを観測しても所有記録を捨てない。失敗は固定理由だけ、port例外本文は出力しない。
- 実環境adapterでは前提観測から通常操作までの最終チェックを同期的に行う必要がある。現在の人工port検証は、別MODやプレイヤー操作による実機の競合の証明ではない。進捗監視は下記のモック専用実装。checkpoint永続化、全スキルの操作、実機allowlistは未実装。

## 進捗監視（2026-10-11 / P1-04ドメイン層）
`monitorTask(task, snapshot, checkpoint, { nowMs, sessionId, offline?, stopRequested? })` は `continue/complete/blocked/replan/suspended/stopped`、固定理由、stopRequired、次checkpoint、経過/停滞時間を返す純粋関数。すべてrunnable=false。setupからimportせず、API操作/時計/タイマー/永続化を行わない。

- taskはPlanner由来の安定id、`action: { id, selectionIds }`、ANDの`endConditions`、`requirements`、時間bounds。終了条件は `{ type: inventory, id, quantity }` または `{ type: completion, scopeId, category, id, skillId?, track? }`。requirementsは次の1操作に必要なitems/currenciesと全possible outputIds/outputsEvidence。ゲーム由来の生成はまだ未実装。
- snapshotはP1-02の`resources`、必要に応じてP1-01の`completionSnapshot`、人工の`actionSelection: { supported, actionId, selectionIds }`。Completion対象はentriesから明示的に照合し、分子/分母の和・率・missingとの一致・対象存在を検査。欠落を達成済みとみなさない。カテゴリの検査結果を同じ評価内で再利用する。
- `resourceSnapshotProblem` はフラグだけでなく、在庫/ロック/容量、通貨、装備セット/占有参照、活動状態を検査する共通ガード。executorも同じガードを使用し、偽のsupportedフラグで不正データを通さない。
- 終了条件最大16、素材128、通貨64、副産物256、選択64、Completion entries/カテゴリ20000。時間は既定停滞60秒、最長1時間、観測空白60秒、上限30日。個別条件の順序は正規化し、仕様変更/時刻逆行/進捗逆行/分母変更を拒否する。
- checkpointはtask仕様signature、session/mode、開始/最終観測/対象進捗時刻、各終了条件のcurrent/maximum/denominator、現在装備セットsignatureだけ。余分な入力フィールドをコピーしない。対象currentのみで停滞時刻を更新し、無関係なドロップは無視する。
- 完了は操作の終了条件を満たしたことを意味し、Completion 100%の達成宣言ではない。未達なら一時停止、別action/selection、現在装備の変更、素材/通貨不足、保護素材、銀行枠不足、最長時間/停滞を判定する。完了/拒否/replan/停止はterminalで自動継続しない。
- offline中はsnapshotを参照せずsuspended、stopRequired=false。初回offlineなら未観測mode=nullのcheckpointを返す。復帰/session変更/観測空白ではreplanし、古い状態から操作を再開しない。明示的停止はtask/snapshot/checkpointを参照せず返す。
- 木こりの人工シナリオで完了/停滞判断をexecutor.stopへ渡し、所有確認後の停止を確認。手動で別スキルに変わった場合は他行動を止めない。実ゲームイベント接続・軽量な局所観測/キャッシュ・監視の永続化は未実装。

## 数量計画（2026-10-11 / P2人工レシピ）
`planResourceDemand(resources, demands, recipes, context, limits?)` はP1-02資源を共通ガードで検査し、需要を満たす人工レシピをAND/ORで調べる。`planned/satisfied/blocked`、生産手順/回数/素材/通貨/所要時間、投影在庫と予約、探索量/固定理由を返す。すべてrunnable=falseで、投影はゲームの報酬やセーブへの書込みではない。

- demandsは `{ id, quantity }` の配列、同じIDは合算する。レシピは安定id/scopeId、confirmed根拠、unlocked、安全非戦闘、固定コスト根拠、消費後生産順序、保証outputs、itemCosts/currencyCosts、possibleOutputIds、1回のdurationMs。保証収量/コスト保存/副産物/ゲーム内順序の実環境観測は未実装。
- 実在庫と予約を分離。最終需要を予約し、前提の素材も1つずつ一時予約して別の前提が奪わないようにする。レシピ消費時は一時予約だけを解除し、最終予約を保護する。ロックされたアイテムは消費不可、保有終了条件には使える。装備は在庫へ加算しない。
- 生産回数は不足÷保証収量を切り上げる。複数の保証副産物も投影する。未保証副産物は数量や収益に加算せず、possibleOccupiedIdsとして最悪銀行枠だけを後続手順にも持ち越す。確定消費で解放される枠と新規枠を分ける。
- 各経路の投影を複製し、失敗した経路の素材/通貨/予約/手順を巻き戻す。在庫不足の循環を検出し、直接の自己消費は未確認として拒否する。代替は合計前提時間、安定IDでローカルに選ぶ。複数最終需要の大域最適/全組合せや合法的な循環再利用は未対応。
- 既定上限: レシピ512、需要128、深さ24、総探索2000、手順1000、合計生産回数100000、理由64。各レシピは保証出力32/素材128/通貨64/possible出力256。数量/時間safe integer、少数通貨は有限/MAX_SAFE_INTEGER以下、上限設定にもhard ceiling。総探索不能なら部分投影を破棄する。
- 所有不明/未所持スコープ、未解放、不明リスク/戦闘/効果境界/銀行順序は拒否。証拠のある変動効果は下記の境界モデルで扱う。通貨不足はblockedで、通貨を稼ぐ経路の生成は未実装。未知資源を0として補完しない。
- booleanグラフ/Planner/監視へは下記の人工bindingで接続。ゲームからのカタログ構築と実環境接続は未実装。今回の投影を根拠に実プレイを開始しない。

## 数量Planner接続（2026-10-11 / ドメイン層）
`selectQuantifiedCompletionPlan(snapshot, graph, estimates, resources, model, options)` は自動Completion候補と安全な前提手順をコンパイルする。`model: { steps, recipes, recipeActions }` は機械由来の人工事実、stepsのキーはgraph step ID、recipeActionsのキーはrecipe ID。配布setup/ZIPには接続しない。

- production bindingはconfirmed、demandsとallowedRecipeIds。neutral bindingはconfirmed、resourceNeutral=true、Completion終了条件と資源コスト/出力が空のmonitor task。全graph手順にbinding/estimateが必要。未確認効果/監視条件や戦闘は拒否し、別候補へ進む。
- 各production段階で在庫/通貨を投影し、次段階に引き継ぐ。段階内の需要予約を終了時に解放して、その在庫を後段で消費できる。共有前提で不足する量は再調達。未保証副産物のpossibleOccupiedIdsは段階をまたいで維持する。投影は内部数量計算用で、観測済みGameAdapter出力として外に渡さない。
- recipe actionはconfirmedのaction/selectionIds、costPerBatch、reliabilityPerBatch。不明なactionのレシピは候補経路から拒否する。使ったレシピの回数×固定評価単位、回数×失敗確率を評価。元graphのproduction時間/消費を置き換え、元のCompletion増分/解放効果/追加の不確実性は段階末尾に一度だけ計上する。
- `selectPreparedCompletionPlans` にコンパイル後のprimitive stepsと候補別estimateを渡し、既存Plannerと同じ順位/ヒステリシス/クールダウンを使う。数量段階を通さない従来入口と違い、銀行/素材/通貨不足を評価前に除外する。資源中立以外の効果が不明なら補完しない。
- 監視条件は保証された出力ごとの絶対在庫数量、次の1操作のitem/currencyコスト、possible出力と固定消費後生産順序。段階の最終操作には元のCompletion対象もANDで追加。最終需要が既存在庫だけで満たされた場合は再観測待ちblockedとし、所持を発見済みの代用にしない。
- monitorはconfirmed fixed消費後生産の条件だけ、次の1操作で消費しきるスタックが空ける枠を検査する。既存監視条件は従来の保守的容量判定。コスト保存や順序不明では空き枠を推定しない。
- action step IDはgraph手順/recipe/出現回数で、生産回数が変わっても同じactionなら継続時刻を維持する。task IDはstep IDとplanEpochで、最大16384文字をmonitor/executorで扱う。監視仕様が変われば旧checkpointは拒否。epochはcallerが終了/再計画時に更新する責務で、同じepochの同じ命令はexecutorが再実行を拒否する。
- optionsは既存Planner設定に加えquantityLimits、総数量探索4000（上限20000）、候補内コンパイル手順512（上限4096）、planEpoch、monitorBounds。総探索不足は部分順位を破棄。個別失敗は理由付きで次候補を検討する。生成した監視/選択/評価/投影を相互に分離する。
- 戻り値は既存Plannerの選択にnextTask、quantityExpansions、候補別resourceProjectionを追加。全階層の計画/監視はrunnable=false。資源投影から報酬を生成せず、後続操作前は実データを観測し直す。現在の最短数量経路を効用で再探索する大域最適、runtime controller、実ゲームcatalog/bindingは未実装。

## 生産カタログ観測（2026-10-11 / P3モック専用）
`readProductionCatalogForTesting(gameFixture, { version, observationId, ownership })` はwoodcutting/smithingのcatalogをprimitiveに変換する。通常入口 `readProductionCatalog` はゲームgetterに触れずblocked。setup/配布ZIPへの接続、実機の効果保証、catalogから確認済みbindingの自動構築は未実装。

- rootはversion/observationId/mode/origin/supported/status/reason/skills/plannerDrafts/recipeActions/runnable。originはmock-only、planningReadyは常にfalse。観測supportedは効果やAPI操作を保証しない。
- skillはskillId/level/abyssalLevel/isUnlocked、entries。各entryは安定catalogId（skillId/actionIdの組）、actionId/scopeId、supported/status/reason/data。MOD/未所持actionはexcluded、所有不明はblockedで、効果getterを呼ばない。空/重複/未知registryはskillごと、個別例外はrecipeごとに隔離する。
- dataはproductId/必要レベル/追加要件数、nominal、observed、observedOutputIds/outputCoverage/effectEvidence。nominalには基礎数量/時間/XP/素材/通貨、observedには解放のboolean/修正後時間/コスト/保存/倍化を保持。木こりの基礎収量はnull、treeMultiplierを保証数量に変換しない。smithingのbaseQuantityも修正後yieldと区別する。
- static出力はtree/default/random/jewelry、共通rare dropのitem/altItemのIDを整列する。mastery token/realm/gamemode条件/全modifier追加出力は網羅できていないためcoverageはpartial。無料/出力0/全条件解放済みなどを推測で補完しない。
- draftsは観測コストと時間/action IDを持つが、yield/全possible output/効果順序/コスト保証/リスク/資源価値はunknown/null。保存/倍化が0でもconfirmedへ昇格しない。数量Plannerで拒否されることを回帰試験する。
- 上限はaction/skill1024、素材128、通貨64、静的出力512、rare drop/追加条件128。例外本文と任意の追加フィールドを出力せず、セーブ・認証・reward/選択/create/消費・乱数helperを参照しない。実機ではgetter副作用と型/namespace対応を照合する必要がある。

## 採掘/釣り/料理の観測追加（2026-10-11 / モック専用）
- production catalogは既定5スキルを観測し、人工contextのskillsで既知対象に限定できる。通常入口の拒否は変えず、手動ゲーム目標や実環境の有効化設定は追加しない。
- 採掘の現在/最大HP・復活・canMine・必要mastery/店、釣りのarea登録/魚所属・装備/秘密/POI・確率/時間範囲、料理のstation登録/upgrade・perfect/discovered出力・成功/時間/コストを狭いプリミティブDTOへ切り離す。
- cookingのpassive timerはcategoryキーだけを観測し、timer body/乱数/収集APIは参照しない。stockpileは銀行へ加算せず別DTOに保持。passive形状の失敗はstockpileを破棄し、recipe観測は残すがskill全体はblocked。
- 関連area/categoryの未知/未所持/登録不一致を通常の解放扱いしない。mastery eligibilityは一部条件だけで全アクセス証明ではない。釣りはintervalMs=null、最短/最長を別記し、recipe actionはarea IDとfish IDを持つunknown draft。
- HP/確率100%/基礎quantity/修正chanceが観測できても、全出力・消費・時刻・収量の境界証拠は未取得。plannerDraftsの効果/operation evidence=unknown、planningReady/runnable=falseを維持する。

## 共通Artisanの観測追加（2026-10-11 / モック専用）
- catalogは既定10スキル、人工subsetは既知kindに限る。追加5スキルもcategory registry/参照/所有を照合し、基礎コストと修正後コストを同じ共通ガードで切り離す。
- FletchingのalternativeCosts/multiplier/setAltRecipesは基礎値・raw indexとして保持し、設定欠落を既定0に置換しない。Runecraftingのsubcategory集合と水combo判定は追加出力の保証ではない。
- HerbloreRecipeにはproduct/baseQuantityの宣言がない。4 potion IDとraw tierは観測するがindex対応の実証がないためproductId/baseQuantity=null。未確定製品のレシピは `unresolvedDrafts` に固定理由を残し、plannerDrafts/recipeActionsから除外する。他の有効なdraftを無効IDで汚染しない。
- Summoningは候補素材ID、selectedNonShardCostsの現在参照、getAltRecipeCostsの候補別コスト、mark count/levelとmax/tierを分離する。選択なしはnull。代替ID/mark/関連skillに上限と一意性検査を持つ。
- activeRecipe/actionItem/unmodifiedActionQuantity/乱数/選択/製作/mark discovery/XP/保存を参照しない。観測できても製品・コスト・全副産物・operationの実機保証は別で、planningReady/runnable=falseを維持する。

## 農業の観測（2026-10-11 / モック専用）
- `readFarmingForTesting` はversion/人工観測ID/所有/mode/Raidを先に検査し、外部objectをcategory/recipe/plot/compost/timerの狭いDTOへ変換する。`readFarmingSnapshot` はゲームgetterを参照せず無条件拒否。
- registryはidentity/重複/件数を先に確認し、未知所有はblocked、未所持/MODは内容を読まずexcluded。個別例外は固定理由にし、レコード/sectionの部分失敗を残す。category→recipe→plotの登録参照/所有/categoryを照合する。
- plotは公式enumの5状態、selected/planted/compostのID、基礎解放コストとlockedだけの修正コストを保持。growingだけchance/time helperを観測。秒とraw未確認単位を混ぜず、remainingTimeMs/guaranteedHarvestはnull。
- 成長timerはSet/Map/plotsの所属を照合し、excluded plotでもmetadataの対応を検査する。timer内部のtick/時刻/進行処理は参照せず、所属の欠落/二重/状態矛盾はtimer section blocked。plot観測が部分ならtimer全体も検証済みとしない。
- 件数/所属edgeに上限、UTF-8出力既定1MiB/最大4MiB。超過は部分snapshotを出さず固定理由で拒否。plan/収穫/銀行/Completionの投影はなく、planningReady/runnable=falseを維持する。

## ショップの観測（2026-10-11 / モック専用）
- `readShopForTesting` はcategory/purchaseのidentity/所有を先にindex化し、通常modeのmetadata/購入回数/要件/価格/数量を狭いDTOへ変換する。`readShopSnapshot` は外部getterに触れず無条件拒否。Raid category/未所持/MODは内容を読まず除外。
- 解放と購入要件を分離し、ShopPurchase/SkillLevel/AbyssalLevelだけ構造とisMetを観測。他の型・未登録/未所持の参照はpartial/met=null。参照の所有許可はimmutable indexとして持ち、別recordの価格取得失敗や順序に要件観測が依存しない。
- Fixed/Linear/BankSlot/Gloveのnominal構造とgetPurchaseCostsの修正quoteを分ける。quote対象は数量1、cap0/unknown priceは計算しない。UI buyQuantityを変更せず、getCurrencyCost/銀行枠価格/手袋割引の式を再実装しない。
- limit0はrawのまま、Infinityは明示タグ。purchased/count/atBuyLimit/capとmode allowlistは独立した観測。所有Mapにある値はcountと照合し、canPurchase=null/operationEvidence=unknownを維持する。
- containsのitems/charges/pet/lootBox/bankTab/stat存在は部分効果の情報だけ。銀行容量/在庫/Completion/購入結果を作らない。件数とUTF-8出力に上限、例外は固定理由で個別保留。実機cache/価格/条件/操作保証は未確認。

## ショップ依存の純粋変換（2026-10-11）
- `buildShopPrerequisiteGraph` はshop DTOだけから全購入のcount>=1 rootsを生成し、要件から必要回数ごとのcountノードと通常/abyssal skill条件を作る。解放と購入要件は各ANDノードで分離し、同じノードと依存は共有する。
- 観測上取得済みの回数には経路を展開しない。countと要件metの矛盾、同じskill条件の真偽矛盾、高levelだけ充足する矛盾はobservedMet=nullへ戻す。unknown/未登録/取得失敗/除外はstubまたはAND内のopaque blockerへ残す。
- count/work queue、共有group、反復DFSと逆グラフのSCCを使い、深い連鎖と重複を有限のnode/edge予算内で処理する。現在充足済みのノードを除いて循環を報告する。全循環の経路列挙や到達不能の証明は行わない。
- graphは既存Resolverのnode/route形状を満たすが、すべてevidence=unknown・risk=unknown・durationMs=null。completedはsnapshot内の観測だけで、Resolverはfact-unconfirmedとして拒否する。price/効果/在庫/銀行/operationを補完しない。
- node20000/edge100000、各要件群128、diagnostic256、出力既定4MiB/最大8MiB。集合/予算/出力上限を超えた場合はgraphを破棄し、全体成功に部分結果を含めない。外部API/I/O/時計/乱数を使わず、出力は切り離したプリミティブ。

## 生産観測からの調達構造（2026-10-11）
- `buildProductionPrerequisiteGraph` はCompletion itemsをcategory単位で照合し、所持スコープの未達item候補を自動rootsへする。スコープ/版/modeとcatalogヘッダーを検査し、未所持内容は参照しない。他カテゴリの未検証を100%の根拠にしない。
- catalogの既知primary productだけをindex化し、work queueで関連producerと素材のclosureを展開する。未確定potionやpartial output IDsを供給へ使わず、無関係なコストbodyへ触れない。失敗skill/recipeは固定理由で保留する。
- itemのOR producerをrecipe variantノードへ接続し、素材/通貨/通常・abyssal skill/accessをANDにする。nominal/observedコストを別に保存して構造を保持。FletchingとSummoningの代替は未確認variantで、選択対応やmultiplierを保証へ変換しない。
- primary discoveryと所持は別ノード。Completionの発見済みアイテムからstockを作らず、全node completed=false/evidence=unknown。price/収量/回数/時間/銀行占有のprojectionはない。既存Resolverはfact-unconfirmedで拒否する。
- 長いcatalog/variant IDは短い決定的digestへ写像し、衝突は全graph拒否。同じ入力の順序変更/追加によって既存route IDを配列位置で変えない。node/edge/variant/route/byte上限を超えたら部分結果を返さない。
- `graph-components.mjs` の反復SCCをshopと共有する。OR代替がある場合も閉路の存在を診断し、全経路の到達不能とは断定しない。出力はanalysis-only/modelOnlyで操作と分離する。

## 生産/ショップOR統合（2026-10-11）
- `buildItemAcquisitionGraph` は同じversion/modeのshop DTOを生産構造へ追加する。ショップの通常nominalItemsだけをseller indexへ入れ、lootBox/charges/pet/tab/statからitem供給を作らない。未所持/除外recordの内容を読まない。
- shop依存builderのincludeOperationsはcount rootsと別のshop-operationを生成する。新規操作は常にcompleted=falseで、既に購入回数が正でもitem供給を完了扱いしない。観測済みcountは解放条件に限る。
- item work queueから関連shop operationのclosureだけを取り込み、nominal/quoted支払素材と通貨へAND依存を追加する。素材から生産/別shopへ進み、共有と統合後のSCCを解析する。未確認quote/不正costはopaque blockerにする。
- 合計node/edge/route/要件/byte予算を検査し、超過時は全graphを拒否。shop全体の条件構造は先に有界解析するが、無関係な価格bodyは参照せず、graphへ無関係なoperationを持ち込まない。
- all evidence=unknown、必要購入数/価格/効果/在庫/銀行の保証はない。metadataのcostObservationsは観測の記録のみ。通常API・Player state・stock・Completionを変更しない。

## 統合観測フレーム（2026-10-11 / モック専用）
- `readObservationFrameForTesting` は人工version/観測ID/nowMs/所有/subset/byte上限を先に検査し、狭いcontextを固定して既存5 readerを各1回呼ぶ。`readObservationFrame` はgame getterへ触れず拒否する。
- pre/postのmode/Raidと各snapshotヘッダーを照合する。途中の既知mode不一致や終了時の変化なら全frameを拒否。context固定と照合は原子的観測/キャラクター同一性/時刻同一性の証明ではなくatomicObservation=falseを維持する。
- Completion/resources/production/shop/farmingの成功と部分取得をstageごとに残し、source snapshotを補完しない。stage supportedとaudit/graph supportedを区別。shop取得不能時は生産解析だけを残してfallback理由を明示する。
- frameをCompletion auditとitem acquisitionへ自動接続する。監査の全観測や解析上のgraphが成功しても、actualComplete/planningReady/runnable=false。controller/保存/通常操作への実環境接続は未実装。
- UTF-8 JSON全体の既定8MiB/最大16MiB、超過時は全frame破棄。任意extra/例外本文/秘密/全セーブをコピーしない。報酬/時刻進行/stock/セーブを書き換えない。

## 観測フェーズと重い解析の分離（2026-10-11）
- mock frameのcontext.phaseはplanning/monitoring、現在offline flagも狭いbooleanとして検査する。planningかつonlineのみproduction/shop/farming/audit/graphを実施。他stageはsupported=null/status=deferred、snapshot/analysis=nullとして観測していない事実を残す。
- monitoringでもCompletion/resourcesとヘッダーを新しく取得し、byte/mode/Raid/部分失敗を検査する。全Completionと資源registryの走査は残るため、対象だけの局所観測や実機パフォーマンスが完成したとは扱わない。
- controllerのobserveへphase/nowMs/sessionId/現在contextのofflineだけを凍結したrequestとして渡す。active監視中はgraph/model/estimateがないframeでも継続でき、完了/cleanup後は次stepで新planningを要求する。
- offlineからactiveなしで戻る場合はfresh-observation-requiredを返して次のplanning観測を待つ。旧offline statusを現在offline flagとして固定しない。activeありは既存monitor/replanと所有停止を保つ。
- 解析cacheやauto-resumeは追加しない。通常factory拒否、epoch/停止競合/再読込非再開、atomicObservation/actualComplete/planningReady/runnable=falseを維持する。

## 対象Completion限定観測（2026-10-11 / モック専用）
- `readCompletionTargetsForTesting` は最大16のplanner条件を検査してgetObjectByIDで対象だけを引く。collection/mastery/skill trackを既存P1の定義で読み、カテゴリ最大数はscope/categoryごとに1回。全配列/集計current/percentを参照しない。
- DTOはversion/mode/ownership/観測ID、各条件とcurrent/maximum/categoryMaximum/accessibleだけ。coverage=targets-only/fullCoverage=false/achieved=false。通常 `readCompletionTargets` は外部getterを参照せず拒否する。
- monitorはcompletionTargetsを全snapshotとは別経路で検証する。混合入力、duplicate、不正値/分母/所有/mode、未観測/locked条件を拒否し、分母の変更はreplanにする。対象DTOからcategory集計や全体auditを作らない。
- controllerはactive.taskのcompletion条件だけを凍結request.targetsへ渡す。monitoring frameはcompletionSnapshot=null/completionTargets=DTO、inventoryだけのtaskは空targetsで全体達成を推測しない。planningは従来の全観測で再評価。
- 監視中のcontroller reportは全snapshotがない場合、全観測不明として監査を保留する。対象/時刻の実機意味は未確認、資源registryの全走査は残る。通常API/操作/報酬/セーブを変更しない。

## 対象資源限定観測（2026-10-11 / モック専用）
- `readResourceTargetsForTesting` は最大512 item/64 currency IDを検査し、registry ID lookup、bank.getQty、lockedItems.hasで対象だけ読む。全bank.items/locked iteration/currencies.allObjectsは参照しない。通常入口は外部に触れず拒否。
- equipment/activityの既存readerはonlyAuxiliaryモードで共用。bank/currencyの量0も明示的なlookup結果として保持し、未登録/例外はカテゴリデータを破棄して固定理由を残す。全銀行のoccupied/max/free/超過と対象positive countを照合する。
- 全resource guardはcoverage=targets-onlyを拒否。monitorだけが専用guardでtaskの必要ID/quantity一覧/positive items/lock/currency coverageを検査する。通貨不要なら空subsetを許すが、全currency registry取得とは扱わない。
- 容量は全occupied slotsから既知の最小消費で消える対象stackだけを減らす。partial items.lengthを全占有にしない。知らない既存stockを出力所有/消費後の枠解放へ補完しない。
- controllerはtaskからresourceTargetsを自動生成し、monitoring frameに接続。planning/full pre/post/quantity solverは従来の全観測。UTF-8/件数/既存gear/action上限、readonly/unknown/normal拒否を維持する。

## 現在行動の選択観測（2026-10-11 / モック専用）
- `readActionSelectionForTesting` はcurrent active/paused/isPausedとexpected actionを照合し、idle/no expectationではskill bodyを読まない。木こり以外はaction-selector-unverifiedとして返す。通常入口はgetterに触れず拒否。
- Woodcutting activeTreesのID/所有/MOD/重複、actions registryの同一参照、wanted/active treesを検査。isUnlocked/isActive/canStopと集合を別DTOへ保持し、paused/selected-inactiveを実行中へ補完しない。
- actionSelectionのselectionIdsをmonitorへ渡し、手動切替をreplanとする。controllerはactive.task.actionからexpectedActionId/treeIdsを凍結して要求し、frameのpre/postヘッダー照合へ含める。
- treeのprimary output IDは部分観測。outputsEvidence/operationEvidence=unknown、runnable=falseを維持する。既存executorはunknownを拒否し、select/start/stop/報酬/XP/保存を呼ばない。
- active/wanted各64、trees128、UTF-8全結果64KiB（最大1MiB）。不正/未所持/未登録/状態矛盾/例外は固定理由。複数snapshotの原子性や全skillのselection対応は未実装。

## 追加非戦闘selectorとvariant監視（2026-10-11）
- `noncombat-selection.mjs` はbase namespaceの既知9 skillだけをdispatchし、selectedRock/activeFishingArea/activeCookingCategory/selectedRecipeを直接観測する。ID/所有/登録参照を照合し、全件配列や動的active getterは使わない。
- fishingはarea+fish、cookingはstation+recipe、summoningはrecipe+設定素材をselectionIdsへ保持。Fletching/Summoningのraw代替値は別variant DTO。設定なしはnull、番号対応/既定素材/時間/数量/operationは推測しない。
- `selection-variant.mjs` は閉じたprimitive schemaだけを署名化する。monitor taskの明示variantと現在variantの不一致、checkpointのbaselineからの変化をreplanにする。recipe IDが同じでも切替を見逃さない。
- checkpoint selectionSignatureはcanonicalな狭いJSONのみ。任意extra/不正値は拒否し、古いvariant-free checkpointは互換。offline復帰/時刻/session/停止/terminal規則を維持する。
- frameに新selectorを自動接続し、cookingのcatalog action metadataもstation+recipeへ整合。controller/normal executorは木こり以外を引き続き拒否し、観測成功を操作や効果保証に昇格しない。

## 効果境界（2026-10-11 / P3人工データ）

`normalizeRecipeEffects` は固定または上下限のある効果を検査してprimitiveを返す。`normalizeConsumptionBounds` は同じ素材/通貨の境界検査をmonitorでも共用する。確率から量を推定せず、P3 catalog draftのunknownをconfirmedへ変換しない。

- fixedは従来のoutputs/itemCosts/currencyCosts/durationMs。上下限が明示されていても同じ値だけを許し、矛盾する値はfixed-effects-conflict。
- boundedはcostEvidence=bounded/rangeEvidence=confirmedに加え、outputs（保証最小）、maximumOutputs、itemCosts/currencyCosts（最大消費）、minimumItemCosts/minimumCurrencyCosts、durationMs（最大）/minimumDurationMsが必須。同じIDを持ち、0≤最低消費≤最大、0<保証収量≤最大、0≤最低時間≤最大を検査する。未保証だけの収量を前提資源へ使うモデルは未対応。
- 数量計画はstock/currencies下限で供給と予約を決め、最大消費を引き、保証最小出力を加える。upperStock/upperCurrenciesは最低消費と最大出力で更新。段階間のcontext.upperItems/upperCurrenciesを検査して引き継ぎ、実物の数量を書き換えない。
- 銀行容量は最初の1操作の最低消費を在庫上限から引いた受入集合と全possible出力で検査。入力と保証出力は異なるIDに限定しているため、出力集合が出そろった後は入力集合が減るだけで、この集合が全batchのピークを保守的に覆う。最後のbatchだけで空く枠を先取りしない。
- 未保証の追加数量があるIDはpossibleOccupiedIdsに保持し、数値上限を断言しない。projection.upperItemsにはそのIDを含めず、次段で既知の下限だけを再構成して不明占有を維持する。観測し直すまでは供給や確定空き枠に使わない。
- projectionは保証items/currencies、数値境界があるupperItems/upperCurrencies、最終予約、最悪占有集合を返す。operationは保証outputs/maximumOutputs、最大/最低コスト、最大/最低時間。Compilerは時間上限とコストの安全側評価、保証最小出力の終了条件、次の1操作の最大/最低コストをmonitorへ渡す。
- monitorのbounded requirementsはminimumItems/minimumCurrencies/rangeEvidenceを持ち、最大消費の用意を確認。容量解放には最低消費だけを使用。固定の場合は同じ消費を最低/最大とする。実環境の上下限取得、確率的な希少ドロップ目標、未知副産物の完全列挙は未実装。

## 大規模候補の作業窓（2026-10-11 / ドメイン層）
`selectCandidateWindow(snapshot, cursor?, { size?, activeCandidateId? })` は全候補から窓を作る。`selectWindowedQuantifiedCompletionPlan` は既存Plannerのcurrentを保持候補として渡し、window/nextCursorを結果へ付ける。元のCompletion/集計/entries/ownership/achievedは変更しない。ゲーム読取りと操作は行わない。

- 窓の既定size50、最大200、候補集合20000。cursorは `{ afterId: string|null, wraps: safe integer }`。ID順のbookmarkから先へ進み、末尾で折り返す。削除済みbookmarkを最初へリセットしない。固定集合で継続すると全候補が順に入る（絶えず変化する集合の厳密な公平性は保証しない）。
- 観測に残るcurrentだけを保持。保持と他候補がある場合はsize2以上として、他の候補の枠を必ず残す。観測から消えたcurrentは保持しない。順序/値/カーソルは検査し、整数overflowを拒否する。
- windowはcandidates/blockers/totalCandidates/nextCursor/wrapped/activeRetainedを返し、fullCoverageは常にfalse、runnable=false。折り返しは位置の情報であり、全候補の実行可否やCompletion達成を証明しない。観測ブロッカーは256件に制限し、切捨て数を明記、余分なnestedデータをコピーしない。
- `indexPrerequisiteGraph` は最大20000件のglobal IDを一度index化する内部view。indexはsource factsを参照する読取り専用の一時データであり、journal/checkpointへ保存しない。`materializePrerequisites` は候補ごとにowned/confirmed/safe routesの前提だけをbreadth-firstで取り出し、出力DTOを分離する。
- 完了/未確認/未所持factsのroutesを読まない。危険/未確認/Hardcore combat routesを展開しないが、条件のIDは残してResolverが理由を出す。既知の欠落IDをnode予算に加算しない。深さ上限以降もrequirementを残すので、欠落を達成済みとみなさない。
- 候補ごとのlocal node/route/requirement超過や不読データはblockedにして他候補へ進む。global ID重複は曖昧なので全体拒否。総graph探索不足は部分計画を破棄し、window位置だけを残す。nextCursorは提案であり、callerが診断/再観測とともに保存する。
- `planCompletionCandidates(..., { window: { cursor, activeCandidateId } })` はこのlocal viewをResolverへ渡す。legacy small-batch入口の候補/全graph上限は維持。数量Compilerはwindow時に最大100000件のbinding/estimateをID検査し、使用するものだけを取り出す。recipe/actionの大規模入力は下記local catalogへ渡す。
- game snapshotのcache更新、窓をまたぐ全検証の証明、controller/journal、runtime有効化は未実装。全Completionの達成確認は別途、全スコープ/カテゴリの実データで行う必要がある。

## 大規模catalogの局所化（2026-10-11 / P3ドメイン層）
window付き数量Compilerは `indexRecipeCatalog` で最大20000件のrecipe/actionと100000件の出力辺を検査する。ID重複や出力ID不明は全体を拒否。全catalogのコスト/time/余分なフィールドやaction bodyを一括コピーしない。indexは一時的なread-only viewで、保存するGameAdapter出力ではない。

- `materializeRecipeCatalog` は段階のdemands/allowedRecipeIdsからproducerをbreadth-firstに取り出す。globalで既知でもallowed外のレシピを使用しない。確認済みの素材コストだけを展開し、currencyを勝手に生成する経路を補完しない。根拠/所持/解放/リスク/action/境界に不備があれば拒否理由とunknown producerを残す。
- 保証outputsだけでproducerをindex化し、possible副産物だけのIDから供給を作らない。固定/上下限を正規化してDTOを分離し、未確認効果をknownへ昇格しない。関連するgetter例外は固定理由に変換し、別レシピを保持する。
- 共有/循環は有限のID集合で処理。深さの先を展開しなくても素材コストは残すので、Solverが停止/再観測理由を判断する。初期の既存在庫が全需要を満たす場合は不要なproducerを展開せず、最終Completionとの照合は従来のCompilerが維持する。
- local recipe上限はquantity limits（既定512、最大2048）、素材4096、producer辺調査10000、入力需要上限も共有。allowed外や選択済みproducerとの辺の照合も調査量に含める。上限なら部分catalogを破棄してその候補をblocked、次候補へ進む。
- legacy small-batchは従来catalog2048件の制限を維持。window入口は最大20000件のcatalog/actionから必要部分だけを選び、20000件をSolverへそのまま渡さない。source catalog/Completionを変更せず、計画/監視/投影のrunnable=falseとruntime拒否を維持する。
- 実データから確認済み効果を作る経路とP5実機受け入れは未実装。継続controller/記録は下記の人工port実装。global index/candidate windowの長期キャッシュ更新と実環境の保存接続は後続責務。

## 継続controller/記録（2026-10-11 / P4人工port）
`createAutopilotControllerForTesting({ observe, executor, store }, options)` は人工的なobserve→候補窓/Compiler→木こりexecutor→monitor→所有確認停止→再観測を制御する。`start/step/stop/getState/exportCheckpoint` を持ち、最初と復元後は必ずstopped。通常factory `createAutopilotController` はportや設定に触れず無条件拒否。setup/配布ZIPに接続しない。

- observe frameはcompletionSnapshot/resources/graph/estimates/model/actionSelection/woodcutting/offlineを供給する。ゲームオブジェクトを扱わない。人工sessionの版/複製/専用profile/互換性/操作検証をstartで要求。初期capabilityはmelvorF:Woodcuttingだけで、他actionはCompilerの経路から除外する。このcapabilityは実APIの許可ではなく、runtime allowlistは空。
- 有効な作業はmonitorだけで継続し、細かな効率差で毎回計画しない。終了/再評価時に所有確認停止し、そのstepでは次命令を出さず、次stepで最新frameを観測。時計逆行/不正/停止失敗/保存失敗/未知operationは停止し要確認。offline中は停止API/報酬生成を行わず、復帰後は旧monitorを再計画する。
- stepはcallerが起動し、独自の報酬timerやbackground自動再開はない。busy中のstep/startを拒否、stopは世代tokenを即無効化。古いobserve/保存/命令の完了から再開しない。session変更時はexecutor.abandonで所有を放棄し、新キャラクターの行動を停止せず要確認とする。
- 一度だけの命令はrunId/task IDで識別し、planEpochを保存。attemptedをstore.writeへ渡して完了を待ってからexecutorへ送る。verified/active状態も保存し、途中記録/active pointerの復元は要確認。通常停止後もepochは維持し、過去IDを再使用しない。
- `controller-record.mjs` のschema1はrunning=false/runId/planEpoch/retiredThrough/cursor/activeCommandId/requiresReview/ledger/journalだけ。JSON上限1MiB、ledger1000件。所有停止確認後のretiredだけを単調watermarkへ圧縮し、未確定命令とreplay拒否の情報は捨てない。全観測、ゲームセーブ、credential、任意extra fieldsは保存しない。
- journalは閉じたevent/reason、sequence/timeのみ。既定120件/64KiB、未知理由はexternal-reason-rejected、繰返し待ちはsuppressedへ集約、古いentryはdroppedへ計数。ログ回転が命令ledgerを消さない。byte/sequence/epoch/時刻/JSON schemaの不正を拒否する。
- write queueは実際のstore Promiseがsettleするまで直列化する。timeoutは待機を終了しても古いwriteを追越せず、停止後の古い保存が新記録を上書きしない。operation Promiseも実際の完了を追跡し、未確定中に所有情報を消さない。人工portのtimeoutは既定5秒/上限30秒。
- 連続blocked窓は既定500回、stepは100000回で停止（設定のhard ceilingあり）。空/全blocked/窓の折返しを100%としない。実ストレージのcrash/atomicity、キャッシュ更新、他非戦闘action、combat、実機P5の長時間稼働は未検証/未実装。

## 戦闘観測/境界guard（2026-10-11 / P4人工モデル）
`readCombatSnapshotForTesting(gameFixture, context)` は現在のplayer/enemy/encounter/Auto Eat/選択food/resistanceを個別partへ切り離す。origin=mock-only、planningReady=false。通常のreadCombatSnapshot/assessCombatRiskはAPIに触れず無条件拒否。敵を生成/選択せず、戦闘APIを呼ばない。

- dirty statsは数値getterを呼ばずblocked。HP/maxHP/maxHit/interval/damage type、activeEffects/availableAttacksの件数を記録するが、効果の完全な意味はunknown。選択monsterとenemy.monsterのIDを照合し、spawnedでない/不一致は未知。base food healingを修正後healingへ換算しない。
- `assessCombatEnvelope` はv1.3.1、通常モード、frame鮮度、observation ID/敵/typeと狭いstate signatureを確認。coverageはnormal/specials/DoT/passive/reflection/conditional stats/damage type/area/resource change/Auto Eat timing/algorithmがすべて明示true。envelopeはconfirmed-fixtureのみであり実ゲーム証拠ではない。
- packetDamageUpperはAuto Eat機会間の全HP損失を含む軽減後burst上限。通常maxHitにresistanceを掛けてこの値を生成しない。horizon最大1時間、packet64、最短window間隔からinclusiveな機会数を計算して最大10000に制限する。
- damageが正なら現在HPとAuto Eat thresholdをburstより厳密に大きく、healLimitをthresholdより大きく要求。damageの途中値でthresholdに等しく止まる経路も考慮するため、最大damageを連打した一経路の結果を生存保証にしない。
- healing minimumは別のfixture根拠を必要とし、選択foodのみで全機会数×ceil((healLimit-1)/最低healing)の最悪使用量を確保する。派生probabilityや平均回復を安全性の代用にしない。不足/未知/overflow/範囲不正を拒否する。
- 成功はmodelSafe=true/status=bounded-model/modelOnly=true、actualDeathProbability=null、runtimeAllowed/runnable=false。zero damageでも完全coverageが必要。実死亡確率ゼロや実戦許可とは扱わない。
- `guardCombatGraph` は未評価combatのsafe宣言をunknownへ下げ、Resolverがnoncombat代替を取れるようにする。モデル根拠を認める場合もassessmentsに条件付きタグを残す。数量Compiler/controllerは現在combatを拒否する。stats副作用、戦闘triangle/特殊効果の完全な実機model、simulation adapter/戦闘executorは未実装。

## P5全Completion監査/停滞レポート（2026-10-11 / ドメイン層）
- `auditCompletion` は4スコープ×5カテゴリの全entriesとmissing、分子/分母/率、所有情報と観測フラグを照合する。カテゴリ例外は隔離し、未所持scopeの内容は参照しない。scope集計率を独自平均で置換しない。
- `observationComplete` は整合した人工全観測の結果。実機確認済みprofileがないため `actualComplete:false` / `gameVerification:not-performed` / `runnable:false` を固定する。locked/blockedから到達不能は証明しない。
- `buildCompletionReport` はカテゴリ別currentの全観測を同じmode/所有/分母で比較する。進捗時刻・停滞閾値・観測空白を入力時刻で判断し、offline/逆行/部分/仕様変更を基準更新または再評価へ戻す。実時間/ゲームタイマーを動かさない。
- 出力は未達ID例・総未達/locked/omitted数・固定理由だけ。journal最大1000、理由例最大256、カテゴリ例最大1000、JSON全体最大1MiB。例を切り捨てても監査元の全snapshotや集計は保持し、最小reportも収まらなければ拒否する。
- モックcontrollerは各観測step終了時にreportを生成し `getReport` で切り離したコピーを返す。report/checkpointはMOD記録codecへ保存せず、再開/session変更時に破棄。配布UI、ゲームstorage、実ゲームAPIは未接続。
- 人工統合シナリオでは240候補の順次完了、仮想offline7日、停止/復元3回、ledger/journalの反復圧縮を検証。これはイベント接続・実storage・実ゲームの長時間稼働を証明しない。実機受け入れと必要な証拠は `docs/ACCEPTANCE.md` で管理する。

## 計画アルゴリズム

1. 未達Completion項目ごとに候補を生成。
2. 資源/レシピ/解放/装備/スキル要件を有向グラフ化。深さとノード数を制限。循環検出。
3. 安全性を満たさない候補を除外。
4. 推定コストと波及効果から優先順位を決める。長期目標を選び、その実行可能な最初の前提タスクを決定。
5. 行動終了条件（XP、在庫、ダンジョンクリア数）を用いて状態を確認し、再計画。
6. 連続失敗や無進捗は操作を止め、別の候補を試す。全候補不可なら安全停止。

## 将来の実データによるスコア（未実装）
`score = completionGainWeight*completionGain + unlockWeight*unlockValue - etaWeight*estimatedSeconds - riskWeight*riskCost - uncertaintyWeight*uncertainty`
- 計算値を無理に出さず、不明時は区間推定または blocked。
- 同一スナップショットなら決定的な tie-break（ID昇順）。
- 再計画で無駄に切り替えないため、現在の作業に加点と最小継続時間を設ける。

## セキュリティ/セーブ安全
ゲームAPI観測は readonly。書き込みは厳格なallowlistへ。実験の成功を確認するまで無効。セーブを直に編集しない。外部ネットワークへの情報送信なし。ログはPII・セーブ文字列・Cloud資格情報を含まない。
