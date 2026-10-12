# 機能要件と受け入れ基準

## ゴール
「何をするか」をプレイヤーが指定しなくても、ゲーム状態からMODが自分で目標を生成し、通常操作だけでゲーム内Completion 100%を目指す。Base Gameと所有DLCを別スコープで追跡。初期対応は Melvor Idle v1.3.1 (実機要検証)。

## P0実機ロード修正（2026-10-12）
- ユースケース: Creator Toolkitが解析専用ローカルMODを登録できる。実機のmanifest検証で`melvor`接頭辞のnamespaceは予約扱いとして拒否されたため、非予約の英数字namespaceへ変更する。
- 受け入れ: ZIPのmanifest/setupが現在のソースに一致し、Creator Toolkitでnamespaceエラーなく登録できること。ゲームAPIの読取り/操作許可は追加しない。初期停止、理由付きblocked、緊急停止、再読み込み後の非再開を複製スロット2で確認する。
- 実機UIでlogの内容は存在するが暗い文字色で読めなかった。log自身に明るい文字色を指定し、開始/拒否理由/停止のログを視認できることを受け入れに含める。
- 文字色指定だけでは実機の視認性が改善しなかったため、ゲームの`pre`タグ向けスタイルを避ける通常`div`へログ欄を変更する。改行/最大高さ/スクロールと既存の容量制限は維持する。

## P1-01 開発専用の実機集計プローブ（2026-10-12）
- ユースケース: 準備済み複製スロット2と専用profileで、Baseの5カテゴリのキャッシュ集計を1回だけ観測し、UIの分子/分母/率と比較する。通常配布のreadSnapshot/操作入口は無効のまま、開発ZIPへ分離する。自動観測/リトライ/永続化はしない。
- gameTitleの完全一致、characterSelected/ロード/offline flags、currentCharacterの期待indexを先行ゲートにする。期待index 1とUIスロット2の対応はプローブで照合する仮説で、違えばCompletionに触れず停止。元スロットへ自動切替しない。
- Base合成namespaceとmelvorD/Fのサンプルを診断として保持。DLC所有は未確認のまま、DLCを観測/目標化しない。成功でもruntimeAllowed/runnable/actualComplete=false、UI一致や所有APIの検証を済ませた正常adapterとは扱わない。
- 観測直前/直後のbank全stack数量/locks/枠、全通貨、全skillのstandard/abyssal XP、全装備セット/選択、行動/モードを局所プリミティブへコピーし、厳密比較する。外へ出すのは同一性フラグと件数/限定数値だけ。これはセーブ全体/RNG/観測間の変化を保証しない。
- 受け入れ: version/slot/ロード/Raid/活動中ゲート、receiver付き集計、空分母/数値不正/例外の隔離、同じ枠数の数量変更などの副作用検出、前後context/モード/ゲーム参照変更、集合/byte上限、秘密getter/保存/認証/書込み非参照をモックで確認。実機で5カテゴリのUI集計と照合し、一致範囲を個別に記録する。

## FR-01 状態観測（P1）
- 全スキル・レベル・ロック状態、所持アイテム数量、装備、ショップ、通貨、ゲームモードを取得できる。
- Completion Log: スキル、マスタリー、アイテム、モンスター、ペット、DLCごとの未達項目を特定できる。
- 取得できない項目は未対応と表示。推測で「達成済み」と補完しない。
- 受け入れ: モックテスト、実セーブ複製での照合、未知API時の fail-closed。

## FR-02 目標の自己生成（P2）
- 候補をゲームの未達Completion項目から生成し、前提条件を再帰的に分解する。
- 手動で目標を入力しなくても候補が必ずあるか、理由を付して blocked と判断する。
- 必要時間/解放効果/成功見込み/死亡リスク/作業の競合を評価して最善候補を選ぶ。
- 受け入れ: 固定スナップショットを使う回帰テストで同じ行動が再現する。

## 今回の実装範囲（2026-10-11 / P1-01 + P2候補生成）
- ユースケース: Completionの各カテゴリを読み取り、Base Game / TotH / AoD / ItA別の未達項目から手入力なしで解析候補を生成する。
- 型定義の存在はv1.3.1実機検証の代替にしない。今回のゲームAPIアダプターはテスト専用入口に隔離し、配布UIから呼ばない。実機確認済みアダプターがない間、通常の `readSnapshot` は外部オブジェクトに触れず `blocked` を返す。従来の推測スキルAPIも無効化する。
- 所持情報・現在バージョンはテスト用コンテキストで明示する。実環境からの自動取得は証拠不足として未実装。未所持DLCは対象外、所持不明はblocked。レジストリにDLCデータがあることを所持の証拠にしない。
- 受け入れ: 5カテゴリ×4スコープ、通常/abyssalレベル、ロック状態、発見済みで銀行にないアイテム、未所持/不明DLC、Hardcore、未知バージョン、欠落API、例外、NaN/null/文字列/重複ID、公式集計との不一致をモックで検証する。
- 集計のcurrent/maximumと列挙結果を照合し、不一致や部分取得を100%と扱わない。ゼロ件/未知データだけで達成宣言しない。スキル上限は固定99/120を使わずCompletion breakdownを使用する。
- 候補生成は純粋関数。ID順で決定的に並べ、ロック/経路未確認/戦闘リスク不明を理由付きblockedにし、全候補の `runnable` はfalse。計画の最適化と操作はこの作業の範囲外。
- スナップショットはプリミティブ値のみ。元データを変更せず、例外本文・セーブ・認証情報をログへ渡さない。

## 続行イテレーション（2026-10-11 / P2前提条件グラフ）
- P1-01の実機照合は接続環境がなく保留。未検証ゲーム読取りを有効化せず、独立したドメイン層を実装する。
- ユースケース: Completion候補を終点とし、素材/必要スキル/解放/装備/通貨等の前提条件をAND、入手経路をORとして表現する。グラフは確認済み事実を表す人工フィクスチャから供給し、実ゲームからの自動構築は未実装。
- 各ノードにスコープ・観測の根拠状態・達成状態、各経路にID・前提ノードID・根拠状態・非戦闘/戦闘・死亡リスク・推定所要時間を持たせる。未所持/不明スコープ、未確認事実・経路・時間、死亡リスク不明はblocked。Hardcoreとモード不明では戦闘経路を拒否する。
- `resolvePrerequisites` は純粋関数。前提を先に並べた手順、使用経路、代替経路の失敗理由、探索量を返す。同じ状態ではID順に決定的。ゲームAPIや時計を使わず、すべて `runnable: false`。
- 循環は現在の探索経路で検出し、別経路を調べる。共有前提作業は同じノード/経路なら一度だけ。異なる経路が同じノードに競合する場合はその組合せを拒否する。
- ノード数/経路数/前提数/深さ/探索回数に上限を設ける。全候補を探索しきれない場合は部分計画を実行可能扱いせず、固定理由でblocked。時間が分かる安全な経路のうちローカルに短い経路を選ぶ（大域最適は保証しない）。
- `planCompletionCandidates` は既存の純粋候補生成とグラフを接続する。手入力目標は不要。候補ID/スコープの対応を検査し、候補数と総探索量を制限する。経路のない候補や個別探索上限に達した候補は理由付きblocked、総予算が残る場合は他の候補を検討する。実ゲームの経路証拠がないので配布UIには接続しない。
- 受け入れ: 直列/AND/OR、共有前提、循環と代替、未知/未所持、Hardcore、未確認API相当の事実、欠落ノード・重複ID・不正数値、各探索上限、順序の決定性・入力無変更・Completion候補接続をモックで検証。

## 続行イテレーション（2026-10-11 / P2純粋Planner）
- ユースケース: 手入力目標なしでCompletion候補を前提条件グラフで分解し、確認済みの人工見積りから次の候補と最初の前提作業を決定する。配布UI・ゲームAPI・実行処理には接続しない。すべて `runnable: false`。
- 見積りは安定した作業ID（ノードIDと経路IDの組）ごとに供給する。Completion増分はスコープ内の0〜1の割合、解放効果と消費コストは共通の人工評価単位。信頼性と死亡確率は0〜1。経路の変更で以前の見積りを流用しない。実データからの見積り計算・数量予約・経路の効用最適化は未実装。
- 共有前提は一度だけ評価。時間はグラフの合計を使用し、信頼性は失敗確率の和から保守的な下限、死亡リスクは確率の和から上限を計算する（独立性を仮定しない）。不明/未確認/不正な見積り、信頼性不足、リスク超過は候補をblockedにして他の候補へ進む。非戦闘に非ゼロの死亡確率があれば矛盾として拒否する。
- 固定重みの効用で順位付けし、同点は候補ID順。安全判定をスコアで相殺しない。全候補を探索しきれない場合は部分選択を破棄する。見積り件数にも上限を持つ。
- 時計と継続状態は引数で渡す。現在候補の最初の作業が引き続き有効なら最小継続時間・切替クールダウン・絶対/相対改善閾値を適用。境界では切り替えない。現在作業が完了/不明/危険/別経路なら継続制約を解除し、安全候補へ移るかblocked。時刻の逆行や不正な状態はblocked。
- 戻り値は評価内訳・固定理由・選択候補・最初の前提作業・次の継続状態。元の入力オブジェクトを保持/変更せず、時計・乱数・外部I/Oを使わない。継続状態は呼出し元が保持する解析用データで、自動再開機能ではない。
- 受け入れ: 効用の各項、同点と順序変更、前提時間/共有コスト、未知/不正/重複見積り、安全候補へのフォールバック、Hardcore拒否、探索上限、クールダウン/ヒステリシス境界と反復、進捗後の最初の作業更新、危険な現在作業の解除、時刻逆行、freeze入力・出力分離・ゲーム経路無効をモックで検証する。

## P1-02 資源観測イテレーション（2026-10-11）
- ユースケース: 数量計画・操作前後検証に使う在庫、通貨、銀行枠、全装備セット、現在/一時停止アクションと関連スキルを読み取り、外部オブジェクトを持たないスナップショットへ変換する。
- `readResourcesForTesting` は型宣言を参考にしたモック専用入口。通常の読取りは引き続きゲームgetterに触れずblocked。v1.3.1以外、モード不明、Golbin Raid中は全体をblockedにする。DLC所有判定として在庫/通貨レジストリを利用しない。
- bank/currencies/equipment/activityの部分失敗は固定理由で表し、そのカテゴリの部分データを破棄。他カテゴリは残す。数量は非負safe integer、通貨は小数を許可する非負有限値（MAX_SAFE_INTEGER以下）。ゼロ在庫を捏造しない。
- 銀行は実在スタックとロック状態、占有/最大枠を照合。占有が最大枠を超える場合も観測し、空き0と超過を表示する。装備は銀行在庫へ加算せず、複数枠を占有する装備の参照先を残す。選択セットを範囲検査する。
- 上限: 在庫/ロック項目20000、通貨256、装備セット32、セット内枠128、関連スキル64。重複ID、欠落、例外、数値/boolean不正、参照矛盾はblocked。例外本文/キャラクター名/セーブ/認証情報を読み取らない。
- 受け入れ: 空/通常/満杯/超過銀行、ロック、MOD/DLC在庫、少数通貨、複数セット/占有枠、active/paused/idle、未知版/モード/Raid、各部分失敗/不正値/重複/上限、決定性・freeze・参照分離・本番経路無効をモックで検証。実セーブ複製での照合は別途未実施。

## P2 素材数量計画（2026-10-11 / 人工レシピ）
- ユースケース: 自動生成された候補に必要なアイテム数量を、観測済み在庫と確認済み人工レシピで満たす生産回数/素材/通貨/銀行容量の計画を計算する。実物を増減せず、投影状態として返す。
- レシピは保証された複数出力、固定の素材/通貨コスト、消費後に生産する順序、全possible副産物、所要時間、スコープ/解放/非戦闘の根拠を持つ。確率的な最低収量/保存率/戦闘収量の証拠不足はblocked。今回のカタログは人工入力だけで、実ゲームからの自動構築とPlanner/監視への接続は続行作業。
- 最終需要と各レシピの素材を予約し、同じ在庫を複数の消費先へ二重使用しない。銀行内の実量と予約量を分け、装備を在庫へ加算しない。保護アイテムは消費しないが、そのアイテムを所持する終了条件の充足には使用できる。
- 在庫不足を再帰的に調達し、必要な生産回数は切り上げる。AND素材/ORレシピ・共有素材・固定副産物を扱う。循環/直接自己消費/未所持/未確認レシピを拒否し代替を調べる。直接自己消費や合法的な再利用循環の一般解はまだ未対応、理由を残す。
- 各OR分岐は投影状態を分離し、失敗分岐の在庫/通貨/予約/手順を他経路へ持ち越さない。ローカルに短い安全経路を選び、同点は安定ID。全需要の大域最適や全組合せは保証しない。
- 固定コストを消費した後の銀行スタックに保証出力とpossible副産物の最悪新規枠を検査する。未保証副産物を素材供給や収益に加算しない。数値のオーバーフロー、必要通貨不明、数量/時間/コレクション/探索上限を検査する。総探索上限では部分計画を破棄する。
- 受け入れ: 生産回数/残余、複数需要/同じ素材の競合/予約、複数出力、消費後容量/副産物不足、通貨と保護素材、循環/代替/失敗分岐の巻戻し、未知/未所持/不正/上限、順序の決定性とfreeze/投影の分離をモックで確認する。

## P2 数量Planner/監視接続（2026-10-11）
- ユースケース: Completion候補→前提グラフの各作業を、数量需要を満たす生産手順または資源中立の作業へ変換し、実生産回数を評価して次候補と最初の監視作業を選ぶ。入力binding/catalogは機械由来の人工事実で、手入力の目標UIは追加しない。
- グラフの全手順に確認済みbindingが必要。productionは段階終了時に保持すべき数量需要と許可レシピID、neutralは資源を消費/生成しない根拠とCompletion終了条件を持つ。不明/未対応の資源効果や操作は候補をblockedにする。戦闘はこの接続では拒否する。
- 生産段階を順番に投影し、前段の確定在庫/通貨とpossible副産物の銀行枠を次段へ引き継ぐ。段階の予約は終了後に解放し、実在庫は維持する。共有素材が不足すれば追加生産する。保証していない副産物を素材にしない。
- 数量の実時間/回数から効用を計算し、固定の消費評価単位と1回の信頼性を回数分集計する。Completion増分/解放効果は段階末尾に一度だけ、数量段階の元グラフ時間/消費は二重計上しない。既存Plannerと同じヒステリシス/クールダウンを利用する。
- 生産手順からaction/選択ID、保証出力の絶対銀行数量、次の1操作の素材/通貨、possible出力、時間boundsを監視用に生成する。最終手順は元のCompletion対象をAND条件に追加。最終需要が既存在庫だけで満たされた場合はCompletion未達との矛盾として再観測待ちblocked。
- 固定消費後に生産するレシピは、監視の銀行枠判定でも次の1操作で確実に空く枠を考慮する。変動コスト/保存率/順序不明ではこの扱いを許可しない。
- 操作IDは生産回数が変わっても同じactionを表し、監視task IDには呼出し元のplanEpochを含む。再計画の終了条件が変われば古いmonitor checkpointを拒否する。新しい作業の実行IDに進めるepoch管理は後続のcontroller責務。自動再開/ゲーム操作を追加しない。
- 候補全体の数量探索とコンパイル手順数にも上限。部分/個別失敗は次候補へ移り、総探索不足は部分順位を破棄。選択/評価/監視/投影は参照を分離する。
- 受け入れ: 自動候補生成から数量・効用・監視・木こりモック停止までの統合、素材不足候補の除外、追加生産/副産物容量の段階引継ぎ、原時間の置換/コストと信頼性回数、既存在庫とCompletionの混同拒否、未対応/不正binding、範囲/探索上限、継続時刻、epoch/終了条件変更、決定性/freeze/出力分離を検証する。

## P3 効果の上下限（2026-10-11 / ドメイン層）
- ユースケース: 確認済み人工レシピの保証最小収量/最大収量、最低/最大消費、最低/最大時間を扱い、保存や倍化があっても必要素材/通貨を過少予約せず、銀行枠を過大評価しない。
- 固定レシピは上下限が同じモデルとして保持。boundedレシピはevidence/rangeEvidence=confirmed、全出力とコストのID対応、非負の最低消費≤最大消費、正の保証収量≤最大収量、最低時間≤最大時間が必須。不明/矛盾/NaN/無限/overflowはblocked。catalogのnominal値や保存率から境界を自動生成しない。
- 供給と最終予約は在庫下限を使用し、最大消費を予約して保証最小出力だけを加える。在庫上限は最低消費/最大出力で投影、通貨も上下限を別に保持。未保証副産物の数量を供給へ加算しない。
- 銀行のピークは「最初の1操作の最低消費後の在庫上限 + 全possible出力」で検査する。バッチ終了時だけ空く枠は最初から使用しない。出力と入力が同じレシピは既存の未対応扱いを維持し、後続batchで入力集合が増えないモデルに限定する。
- Compilerは上下限を段階間で引き継ぎ、時間/コストを安全側で評価。監視は最大消費量が用意できるかを確認し、枠解放には最低消費だけを使用する。終了条件は保証最小出力、最終Completionの明示条件を維持。
- 受け入れ: 保存で枠が空かない例、固定batchの途中容量不足、最大消費の素材/通貨予約、倍化の余剰を供給にしない例、上下限の段階引継ぎ、不正/欠落/固定と矛盾/overflow、OR代替、freeze/決定性、Compiler→monitor統合をモックで検証。実ゲームの境界証拠と操作は未検証。

## P3 木こり/鍛冶カタログ観測（2026-10-11）
- ユースケース: 木こりと鍛冶の実データ形状をテスト専用read-only adapterで読み、action/生産物/必要レベル/基礎XP/基礎数量/基礎コスト/修正後コスト/時間/解放/保存率/倍化率をプリミティブで列挙する。型宣言と実機の一致は未検証、通常入口は無条件blocked。
- nominal値と観測getter値を分ける。WoodcuttingTreeに保証数量の宣言がないため1個と補完しない。getTreeMultiplierを保証収量とみなさない。Smithing.baseQuantityも修正後の保証数量の代用にしない。保存率ゼロ/倍化率ゼロでも追加効果や全副産物を保証したことにはしない。
- scope所有は人工contextで供給し、未所持/MOD actionは除外、不明所有はblocked。除外actionの効果getterは呼ばない。registry/skillの失敗は該当skillだけ、個別recipeの失敗はそのrecipeだけを隔離。未知値を0/無料/解放済みと補完しない。
- 木こりのtree/default/random/jewelryと共通rare dropにある静的出力IDを観測するが、mastery token/realm条件/全modifier追加出力を網羅したとは扱わない。possible outputの完全な集合はunknownのまま。
- カタログからaction binding/recipeのdraftも生成するが、効果根拠/保証数量/全副産物/資源評価の未確認を明示してevidence=unknown、planningReady=false。既存Plannerがこのdraftを拒否することを検証する。calibrationを新しいゲーム有効化スイッチにしない。
- 上限: action registry/skill1024、素材128、通貨64、静的出力ID512。型/ID/重複/数値/boolean/namespace不正、getter例外、集合上限を検査。選択/create/consume/Reward/乱数を含む数量修正helper、セーブ/認証を読み書きしない。
- 受け入れ: 木こり/鍛冶、DLC所有/不明/除外、ロックと追加条件、nominalとeffectiveコスト差、変動保存/倍化、空/重複/欠落/例外/不正/上限、順序/freeze/参照分離、危険getter非呼出し、draftのPlanner拒否を人工fixtureで検証する。

## P3採掘/釣り/料理のカタログ観測（2026-10-11）
- ユースケース: 既存の木こり/鍛冶と同じ隔離adapterで採掘/釣り/料理を観測する。テスト入口の既定対象は5スキル、人工contextで限定する場合も既知スキルのみ。通常入口は引き続き無条件拒否。
- 採掘は鉱石HP/復活状態、mastery/採掘可否、店/必要mastery、基礎量/復活時間と修正interval、gem chanceを区別する。HP再計算/復活/選択/報酬を呼ばない。
- 釣りは魚/釣り場registryの対応を照合し、必要装備/秘密/POIの条件存在、fish/junk/special確率、最短/最長intervalを観測。最短時間やfish chanceから固定収量を作らない。選択には釣り場と魚のIDを残すが操作証拠はunknown。
- 料理はcategory/upgrade、perfect/discovered outputs、基礎/修正後コスト、成功/完全調理/保存/倍化/active/passive intervalを観測。stockpileとpassive timerの登録を別DTOにし、銀行在庫へ足さない。収集/調理/乱数/保存関数は呼ばない。
- 例外/欠落/不正数値/重複/関連registry矛盾は固定理由で保留。未所持/MOD対象の内容getterは読まず、全副産物/効果根拠はunknownとしてPlannerが拒否。スキル1024action/512output、area/category/stockpile等にも有限上限を持つ。
- 受け入れ: 5スキル混在/限定、基礎値と修正値、鉱石枯渇/復活、魚area/確率/秘密/装備/POI、料理upgrade/成功/perfect/passive/stockpile、DLC/例外/不正/上限/決定性/無変更/禁止API非参照、draft拒否をモックで検証。

## P3共通Artisanカタログ（2026-10-11）
- ユースケース: Crafting/Fletching/Runecrafting/Herblore/Summoningを同じモック専用catalogへ追加し、既定10スキルを観測する。人工subsetと通常入口の拒否は維持する。
- Craftingのcategory/subcategory、Fletchingの基礎/代替コスト・quantity multiplier・設定済み代替番号、Runecraftingのsubcategory集合/水combo判定を別フィールドにする。番号やmultiplierから保証quantity/通常選択の意味を推測しない。
- Herbloreは4段階のpotionsとraw potion tierを観測する。型宣言だけではtierのindex対応が未確認なのでselected product/baseQuantityはnull、全potionsを同時出力として数量計画へ渡さない。現在選択actionのgetterも使わない。
- Summoningはtier/maxMarkLevel/関連スキル/mark count/mark level、non-shard素材候補/現在選択/候補ごとの修正後コストを観測する。mark discovery/タブレット消費XP/シナジー操作を呼ばない。
- variant数/関連ID/registryに有限上限を設け、unknown/MOD/未所持対象の内容を読まない。副作用/全副産物/効果/通常操作は未実証で、draftのevidence/costEvidence/operationはunknown。
- 受け入れ: 10スキル混在/限定、基本/代替コストと設定、herblore product不明、mark/素材選択/原料代替、DLC/関連registry/例外/不正/上限、禁止API非参照、freeze/順序/参照分離、未検証draftの拒否をモックで検証。

## P3農業の観測（2026-10-11）
- ユースケース: 農業のcategory/recipe/plot/compostと成長timerの所属をread-only DTOへ分離し、複数区画の並行成長、収穫待ち/枯死/未解放を観測する。通常入口は無条件拒否、人工contextでv1.3.1/所有/観測IDを供給する。
- 基礎の種/区画解放コストと修正後値、categoryの返種/XP/収量modifier、肥料の基礎値と区画の適用量を区別する。成長状態から収穫数量/種返却/銀行在庫/Completionを作らない。
- plot stateは公式enum 0〜4を明示し、Growing/Grown/Deadは登録済み・同categoryのplanted recipeを要求。selected recipeは植付済みとは扱わない。未知状態/所属矛盾/欠落/例外は個別blocked。
- timersは登録・plot所属・growthTimerMapの整合だけを照合し、残り時間/tick/報酬を独自計算しない。plot.growthTimeは宣言どおりseconds、recipe/helperのinterval単位は実機未照合なのでraw/unknownとして保持。
- category256/recipe2048/plot1024/compost256/timer1024/所属edge4096、JSON出力既定1MiB（最大4MiB）に上限を置く。未所持/MODは内容getter非参照。例外/任意extra/セーブ/認証は出力しない。
- 受け入れ: 全plot state、複数timer、基本/修正コスト、選択と植付の区別、DLC/未知/参照矛盾、部分例外/不正数値/重複/上限、禁止API非参照、順序/freeze/DTO分離、収穫/在庫を生成しないことをモックで検証。

## P3ショップの観測（2026-10-11）
- ユースケース: ショップのcategory/purchaseをread-only DTOへ分け、所持スコープ/通常mode/購入回数、解放/購入要件、価格構造、1回分の数量制限/見積りを観測する。通常入口は無条件拒否。
- Fixed/Linear/BankSlot/GloveのrawパラメータとgetPurchaseCostsが返す修正後価格を区別する。数量1をcapPurchaseQuantityへ渡すだけでbuyQuantityを変更せず、価格式/銀行枠/手袋割引を独自再計算しない。
- 要件はShopPurchase/SkillLevel/AbyssalLevelの構造を切り離し、参照所有を確認してisMetだけを観測。他の型は要件不明として残し、未知の要件body/通知関数へ触れない。解放・価格・数量・資源所有を混同してcanPurchaseをtrueにしない。
- getBuyLimitの返り値はrawとして記録し、0の意味を推測しない。Infinityは明示タグへ変換してJSONのnullへの暗黙変換を防ぐ。購入済みMapの存在時はgetPurchaseCountとの一致を検査する。
- containsのitems/charges/pet/lootBox/bankTabとstatsの存在を分離し、アイテム所持・銀行容量・Completionの投影を作らない。未所持/MOD/Raid categoryは内容を読まず除外。
- category256/purchase2048/要件128/allowed modes128/素材128/通貨64/出力128、JSON既定1MiB（最大4MiB）を上限にする。例外/不正/重複/参照矛盾は固定理由で保留。
- 受け入れ: 4価格形式、基礎/修正価格、所有回数/limit/cap0/Infinity、各要件/unknown/参照、DLC/mode/Raid/contains、部分例外/上限/禁止購入・通知・通貨・保存API非参照、順序/freeze/DTO分離、投影なしをモックで検証。

## P2ショップ観測からの依存グラフ（2026-10-11）
- ユースケース: プリミティブだけのshop snapshotから、購入回数の条件ノード、解放/購入要件のANDノード、通常/abyssalスキル条件を自動生成する。目標や依存関係を手入力しない。
- count条件は購入ID/必要回数、skill条件はtype/scope/skillID/levelで安定IDを作り、共有/重複をまとめる。購入回数の観測と要件metが食い違う場合、同じskill条件のmet矛盾や高いlevelだけmet=trueの場合は未検証へ戻す。
- 取得済み回数が条件を満たす場合は依存を展開しない。未達条件の循環は反復型SCC解析で検出し、充足済みノードを除いた現在の依存を報告する。循環を到達不能や100%の根拠にしない。
- 未登録/blocked/excluded/未知条件は固定理由付きのleaf/stubへ分離する。未知AND条件を落として残りだけでmet=trueとしない。価格/在庫/銀行容量/単位時間/operationを補完しない。
- prototypeのgraph evidenceはunknown、routeは未確認、runnable/planningReady=falseを固定。observedMet/completedはスナップショット内の観測状態であり、実ゲームAPI確認や操作許可とは別。
- 上限: 入力purchase2048、各要件群128、node20000/edge100000、diagnostic256、UTF-8既定4MiB/最大8MiB。超過時は全graphを破棄。入力/出力を分離し、API/時計/乱数/外部I/Oは使わない。
- 受け入れ: AND/直列/共有/回数違い/通常abyssal、count/met/skill単調性矛盾、自己/相互/共有循環、充足済み依存非展開、missing/unknown/除外、部分観測/不正/重複/各上限、順序/freeze/例外秘匿、既存Resolverの拒否を検証する。

## P2生産観測からの調達依存（2026-10-11）
- ユースケース: Completionの照合済み未達itemsを自動rootsとし、製品のOR producer、素材/通貨/必要スキル/未確認アクセスのAND構造を生成する。手入力目標やbindingを要求せず、純粋変換として実装する。
- nominalと現在観測コストを別記し、素材IDの構造を保持する。保存/倍化/基礎量/intervalから保証収量・必要回数・時間・銀行占有を計算しない。既発見のアイテムも銀行在庫として補完しない。
- Fletchingの代替コストとSummoningの素材別コストは未確認variantとして別経路へ分離する。選択番号の対応やquantity multiplierを保証へ変換しない。Herblore未確定製品とpartial副産物をproducerにしない。
- 関連producerだけをwork queueで展開し、共有/閉路を有限に解析する。OR代替を含む循環は診断として報告し、全経路が到達不能とは断定しない。未所持/未知/MOD/失敗レシピは供給へ使わない。
- 全evidence/operation/価格/効果はunknown、runnable/planningReady=false。長いcatalog IDは安定した短いroute IDへ変換し、collisionは拒否する。異なるversion/modeの入力を混ぜない。
- 上限: source entry20000、各cost128/64、variant64、OR route64、node20000/edge100000、診断256、出力既定4MiB/最大8MiB。上限時は全graphを破棄。例外/任意extra/API/時計/乱数/外部I/Oは使わない。
- 受け入れ: 自動item roots/直列/OR/AND/共有、zero cost/スキル差、nominalとobserved/代替、閉路と非循環OR、未確定製品/副産物/所有/部分/不正/上限/長ID、順序/freeze/秘匿、既存Resolverの拒否、adapter接続を検証。

## P2生産/ショップの入手経路統合（2026-10-11）
- ユースケース: 同じ未達Completion itemと素材について、生産のOR producerに通常ショップのitem購入候補を追加する。購入の条件・素材/通貨コストもANDとして展開する。
- 新規入手はshop count条件ではなく別のshop-operationノードを使い、常にcompleted=false。既に買った回数が1以上でも新しい在庫/発見の証拠にしない。購入済みcountは解放要件の観測だけに使う。
- contains.nominalItemsの正量だけを候補にし、lootBox/charges/pet/bankTab/statを通常item供給へ補完しない。nominal/quoteは保証量・必要購入数・価格計画へ変換しない。
- 関連shop operationのclosureだけを既存graphへ取り込み、購入に必要な素材から生産/別shopへ再帰的に進む。統合後の共有/OR/閉路を有限に診断し、別経路がある循環を到達不能と断定しない。
- shop snapshotも同じversion/mode/所有に照合。上限は合計node20000/edge100000/OR64/要件128、出力4MiB（最大8MiB）で、超過時は全graphを破棄する。全evidence/operationはunknown、projection/実行許可なし。
- 受け入れ: 生産/店OR、店だけの素材、購入済みでも未完了operation、素材/通貨/条件、unknown price/lootBox等非供給、DLC/版mode/例外/関連だけ/共有/統合cycle/上限/順序/freeze、adapter接続と既存Resolver拒否を検証。

## P1観測フレームの統合（2026-10-11）
- ユースケース: Completion/resources/production/shop/farmingのモック専用readerを一つのcontextで各1回束ね、切り離したframe、全Completion監査、調達依存解析を返す。通常入口は無条件拒否してgame getterに触れない。
- version/観測ID/nowMs/所有と人工skills subsetを先に検査し、contextを狭い値へ固定する。開始前/後のmode/Raidと各snapshotヘッダーを照合し、不一致ではframe全体を拒否する。
- stageの取得失敗/部分データは元の固定理由で残し、全stageのsupportedと解析の成功を分離する。shop欠落では生産構造だけを解析し、原因を明示してshop対応完了とは扱わない。
- 同じcontextで呼んでも原子的snapshot/時刻の同一性は証明しない。atomicObservation=false、actualComplete/runnable/planningReady=falseを固定し、オフライン進行/報酬/保存/操作を作らない。
- frameと解析のUTF-8 JSONを既定8MiB（最大16MiB）に制限する。超過は全frameを破棄。秘密/任意extra/context getter/例外本文をコピーせず、出力を切り離す。
- 受け入れ: 全stage成功/部分/欠落/例外、context先行gate、version/mode/Raidの変化、所有/subset、audit/graph接続とfallback、秘密/byte/freeze/参照分離、通常入口/操作/報酬非参照をモックで検証。

## P4観測フェーズの分離（2026-10-11）
- ユースケース: planningだけ5 readerとaudit/調達graphを実行し、monitoring/offlineではresources/Completionの現在観測だけを取得する。未実施stageはdeferred/nullとして残し、cached dataや取得済みを捏造しない。
- controllerはobserveへphase/nowMs/sessionId/現在contextのoffline flagだけを渡す。active作業ではmonitoring、完了/停止後の新計画はplanning。旧phase/旧解析を再開の根拠にしない。
- activeなしのoffline復帰も1stepを新観測要求へ戻し、次stepのplanning frameから計画する。activeありは既存monitor/replanと所有確認cleanupを保つ。offline状態をhintとして固定して復帰不能にしない。
- resources/Completionは新しく読み、mode/Raid/ヘッダー/byte gateを監視でも適用する。軽量化はproduction/shop/farming/graphの省略で、全Completion registryと全資源観測の走査は現段階では残る。
- 受け入れ: deferredのgetter非参照/analysisなし、planningへ戻る再評価、invalid phase/offline/context、監視中の部分失敗/不一致/byte、controller phase/完了/offline/no-active復帰/二重発行防止を確認。実機イベント/局所cache/時間原子性は未検証。

## P1対象Completionの限定観測（2026-10-11）
- ユースケース: plannerが生成した監視条件の明示対象だけをID lookupで読み、全registry/allObjects走査を避ける。各対象値とカテゴリ最大数を分離し、coverage=targets-only/fullCoverage=false/achieved=falseを固定。
- skillsはstandard/abyssalとCompletion breakdownのscope/offset/cap、masteryはskillID/actionID、収集系はignoreCompletionと発見/討伐/解放を既存定義に従って検査。所持/固定99/部分合計をCompletionの代替にしない。
- 全体snapshotとは別のcompletionTargets DTOをmonitorで受け、mode/version/所有/ID/重複/数値/分母/lockedを照合する。混合snapshotや未観測条件は拒否する。全体auditは部分DTOから達成判定しない。
- controller requestのtargetsはactive.taskのcompletion endConditionsから生成。monitoring時だけ限定readerへ接続し、planningは従来の全観測。inventoryだけの監視も空target集合を全Completionとして扱わない。
- 最大16条件、breakdown4 scope、UTF-8既定64KiB/最大1MiB。未知/未所持/MODは内容/APIへ触れず固定理由で保留。通常入口は無条件拒否、実機検証/原子的観測/操作許可はなし。
- 受け入れ: 5カテゴリ/track/skill action、ignore/lookup mismatch/未登録/所有、分母変化/例外/不正/上限/重複/全件getter非参照、monitor/統合frame/controller接続、部分100%非宣言と既存回帰を確認。

## P1監視資源の限定観測（2026-10-11）
- ユースケース: taskの素材/出力/在庫終了条件/通貨だけをID lookupとbank.getQty/lock membershipで観測し、銀行/通貨全registryを走査しない。equipment/activityは既存readerを共用する。
- coverage=targets-only、requested item/currency IDsとゼロを含む対象量、全銀行のoccupied/maximum slotsを別記する。部分items.lengthを全銀行の占有数へ置換しない。未登録/取得失敗をゼロ在庫へ補完しない。
- 完全resourceの共通guardはpartialを拒否し、monitorだけが専用guardと全要求IDのcoverageを検証する。数量planner/executorのfull pre/postへ部分在庫を流用しない。
- bank容量は全occupied slotsから既知の最小消費で消える対象stackだけを引き、新規出力枠を検査する。未観測stackの削除/所持/空きを推測しない。lockと保護、少数通貨も維持。
- controllerのresourceTargetsはtaskから自動生成、monitoring frameだけで使う。planningは全資源観測。最大512 items/64 currencies、JSON既定1MiB/最大4MiB、既存equipment/activity上限を維持。
- 受け入れ: 対象ゼロ/正量/lock/MOD/DLC、全items/locked set/currency registry非走査、slots/容量/最小消費、coverage/missing/不正/例外/上限、monitor/frame/controller、full用途拒否/freeze/秘匿/操作非参照を検証。

## P1現在行動の選択対象観測（2026-10-11）
- ユースケース: current active/paused/idleと木こりactiveTreesを分け、監視のactionSelectionとexecutor形状のwoodcutting DTOをread-onlyで生成する。expected action/tree IDsはactive.taskから自動供給する。
- idleかつexpected actionなしは選択未知のidleを返し、不要なskill getterへ触れない。木こり以外は未対応理由で保留。別行動の存在を木こりとして補完しない。
- activeTreesのID/登録参照/所有/重複とwanted treeのID lookup、isUnlocked/isActive/canStop/実行状態の整合を検査する。選択集合とisActiveを混同しない。未所持/MOD/未登録/例外は固定理由で拒否。
- primary product IDは部分出力の観測だけ、outputsEvidence=unknownを固定して通常operationを許可しない。選択/停止/報酬/XP/乱数/保存の関数を呼ばない。
- activeTrees64/wanted IDs64/trees128/UTF-8既定64KiB（最大1MiB）、pre/post mode/Raidを既存frameで照合。通常入口は無条件拒否。
- 受け入れ: idle/active/paused/選択のみ/別行動、複数木/登録/所有/対象変化/不正/例外/上限、禁止API非参照、monitor手動介入/frame/controller、executor unknown拒否/freeze/秘匿を検証。

## P1他の非戦闘選択対象（2026-10-11）
- ユースケース: Mining/Fishing/Cooking/Smithing/Crafting/Fletching/Runecrafting/Herblore/Summoningのraw選択状態をread-only DTOへ追加する。global active/paused/isPausedとskill isActive/canStopを照合し、木こり以外のoperationは許可しない。
- MiningはselectedRock、Fishingはactive area/selected fishの登録参照と所属、Cookingはactive category/selected recipeの登録とcategoryを分離。ArtisanはselectedRecipeを使い、activeRecipe/actionItem等の動的getterに依存しない。
- Fletchingの設定alt index、Summoningの設定素材はvariant DTOとして別に保持する。index対応/既定値/製品/数量を推測しない。monitorはvariant署名をcheckpointに狭く保持し、同じrecipeでも変更をreplanにする。
- 未選択/不正/未登録/未所持/MOD/Map形状/活動矛盾は固定理由で保留。空選択を実行中と補完しない。全件registry/Map iteration/報酬/乱数/選択/start/stop/保存は使わない。
- lookup対象だけを読む。Map最大1024、関連array128、variant署名8192文字と既存DTO byte上限を適用する。全体のnormal入口/操作/出力保証は未検証・無効。
- 受け入れ: 9追加skill/idle/active/paused/別行動、area/station/recipe/variantの変更、未所持/登録/不正/上限/禁止API非参照、monitor/frame/既存checkpoint互換/freeze/秘匿を検証。

## P2/P4 大規模候補の作業窓（2026-10-11）
- ユースケース: 数千の未達Completionがあっても全候補を変更せず、カーソル付きの候補窓と候補ごとの局所graphを自動作成し、現行の探索予算内で評価する。元のentries/集計/ownership/achievedを切り詰めない。
- ID順のbookmarkを使い、固定した候補集合では全候補が順に窓に入る。削除されたbookmarkでもそのIDより後へ進み、末尾で折り返す。継続中候補は観測されている場合だけ保持。保持候補があるときは他の候補が入る枠を必ず残す。
- 窓の折り返し/未選択/全blockedをCompletion達成や全候補の検証完了とみなさない。nextCursorは探索用位置、呼出し元が保存する。ゲームの再起動を自動再開する設定ではない。
- graph全体のIDを一度index化し、各候補から安全/確認済み/所持範囲の経路の前提だけを深さ/件数上限内で切り出す。完了済み事実のroutesは読まない。閉路/欠落/不正/重複を判定し、局所上限はその候補のblockedとして次へ進む。部分graphから不足条件を達成済みと補完しない。
- 通常のsmall-batch入口のfail-closed制限を維持し、window入口を追加。Compilerは必要なbinding/estimateだけを大きな入力から抽出する。recipe catalogは現行上限を維持し、巨大catalogの局所化は後続作業。
- 上限: 候補集合20000、global graph20000、metadata入力100000、窓1〜200（既定50）。保持候補と他候補がある場合は窓2以上。カーソル/ID/集合重複/epoch overflow/未知設定は拒否。入力/窓/計画/状態は参照を分離する。
- 受け入れ: 2000件超の候補/graphで末尾の有効候補へ到達、固定集合の公平性、継続候補保持/非飢餓、追加/削除/並べ替え、巨大候補の局所拒否と次候補、共有/閉路/深さ/未確認/未所持/完了routes、scope/category全体保持、空/未知snapshotで誤達成なし、不正/上限/freeze、数量Compiler統合をモック検証する。

## P3 大規模レシピの局所化（2026-10-11）
- ユースケース: 候補窓のCompilerで、2000件超のglobal catalog/actionをその段階の需要/素材producerに限定し、既存の数量探索上限内で扱う。元のcatalog/Completionを切り詰めて達成扱いにしない。
- global ID/出力IDのindexを1回作り、許可済みレシピだけから各需要のproducer、確認済み素材のproducerをbreadth-firstに探索。未確認/未所持/未解放/リスク/操作/不正効果のレシピは供給へ使わず、素材を再帰展開しない。未保証副産物だけで供給を捏造しない。
- 分岐はローカル上限内で全producerを保持し、探索できない候補はpartial catalogを使わずblockedにして次候補へ進む。循環/共有は有限集合で検査、深さ上限の先は数量Solverの停止条件を保持する。在庫だけで全需要を満たせる段階は不要なcatalogを展開しない。
- 不読/不正な関係のあるレシピは個別理由、global ID重複/出力index不明は全体拒否。不要なレシピのコスト/time/追加フィールドやaction bodyは読まない。未知値をfree/安全/解放済み/保証出力へ昇格しない。
- 上限: global recipe/action20000、global出力index辺100000、local recipeは数量limits.maxRecipes（既定512）、訪問素材4096、producer調査10000。legacy small-batch入口は従来catalog2048件上限を維持。
- 受け入れ: 5000件以上のcatalogで末尾の有効供給へ到達、素材連鎖/OR/共有/循環、許可範囲/未所持/未確認/ロック/操作拒否、巨大producer群の個別拒否後の次候補、深さ/集合/調査/重複/出力不明、未保証副産物不使用、stockのみ、不要getter非参照、順序/freeze/参照分離を検証する。

## FR-03 実行可能なオペレーション（P3）
- 木こり、採掘、釣り、料理、鍛冶、生産、農業、購入、素材確認、銀行整理、装備変更、戦闘などを小さなadapterに分割。
- 操作前に装備・材料・レベル・通貨・未解放チェック。実行後に状態差分を検証。
- 同じコマンドの再実行で重複購入・二重消費しない。
- 受け入れ: モックの失敗/再試行/タイムアウト、およびバックアップセーブでの個別実機試験。

## P1-03 木こり操作の検証基盤（2026-10-11）
- 実機環境: SteamのMelvorライブラリは確認できたが、ユーザーから複製セーブ/専用プロファイル未準備と回答。実プレイ検証は保留、未確認のselectTree/stopは呼ばない。型宣言の調査とモック操作の検証基盤を先行する。
- ユースケース: 一度だけ木を選択する命令を `precondition -> operation -> postcondition` で検査する。実環境入口は無条件拒否。テスト専用入口のportは人工fixtureだけでsimulateし、実ゲームに接続しない。
- 起動は既定停止。モックの版/複製/専用プロファイル/互換性/操作検証状態の全条件がtrueの場合のみテストsession開始。現在アクション/木選択/必要解放/全資源観測を検査し、別アクションを中断しない。通常の木選択がtoggleになり得るため、既に同じ木だけ稼働中なら操作を省略し、idleで選択が残る/別の木が稼働なら拒否する。
- 銀行はproductと全ランダム副産物の既知IDリストから最悪新規スタック数を検査し、空き不足や副産物不明を拒否。操作直後に同じ木だけ稼働していること、銀行数量が減らないこと、通貨/装備が変わらないことを照合。未知状態は停止し、自動再試行しない。
- 命令IDと対象を記録し、同じIDを別対象に流用/失敗後に再操作しない。実行中は別命令を拒否。readだけ最大2回、操作は最大1回。checkpointはメモリ内・1000件上限で破棄せず、新規受付を停止する。永続化はP4の別作業。
- 各port待機にtimeout上限、停止は即座にsessionを無効化。停止/timeout後に遅延完了した命令は成功扱いにせず、検証可能な自分の木こりだけを停止・確認する。別行動へ変わっていたら停止APIを呼ばず、手動確認が必要な理由を返す。
- 受け入れ: 既定停止、起動ゲート、pre/post照合、toggle二重防止、重複/競合ID、別行動/銀行不足/未知副産物拒否、read例外/再試行上限、operation例外/timeout、緊急停止と遅延完了競合、stop失敗/別行動非干渉、checkpoint上限、例外秘匿をモックで確認する。

## P1-04 進捗監視（2026-10-11）
- ユースケース: Plannerが生成した作業のAND終了条件（銀行の必要数量/Completionの対象項目）を切り離したスナップショットで監視し、完了・停滞・必要素材/通貨不足・銀行容量不足・手動介入を理由付きで判定する。手入力目標を追加しない。
- Completionアダプターは集計と照合済みの全項目 `entries` も返す。達成は明示的な対象項目のcurrent/maximumで判断し、missingからの消失・全カテゴリゼロ・集計率だけから推測しない。未知/重複/不一致/分母変更/モード変更を拒否する。
- 資源スナップショットのカテゴリフラグだけに依存せず、プリミティブの形・数量・ロック・容量・通貨・装備セット/占有枠・活動状態を純粋検査する。素材はロックされた在庫を消費可能とみなさず、不明通貨を残高0と補完しない。possible outputが新規銀行枠を必要とする最悪ケースを検査する。
- `monitorTask(task, snapshot, checkpoint, context)` は時計/乱数/ゲームAPI/外部I/Oなし。時刻/session ID/offline/停止要求を引数で供給する。進捗は終了条件に対応するcurrent値だけで測り、無関係なドロップで停滞時刻を更新しない。境界で停滞/最長時間/観測間隔超過を判定、数値の逆行/終了条件の変更はblocked。
- オフライン中は報酬生成/停止操作を要求せずsuspended。復帰、session変更、大きな観測空白はreplanとし、古いチェックポイントから操作を再開しない。停止要求はスナップショットを参照せず処理。完了/blocked/replan/停止はterminalとし、同じ監視状態が自動でcontinueに戻らない。
- 項目数と時間に上限。checkpointは安定task ID/仕様signature/mode/session/開始・観測・進捗時刻/対象進捗だけで、セーブや外部オブジェクトを持たない。配布UIや実ゲーム操作には未接続。
- 受け入れ: 数量/5カテゴリの対象完了、対象消失/未知カテゴリ/集計不一致/ゼロ分母の拒否、対象進捗/無関係報酬/停滞境界、素材/通貨/銀行不足、手動切替/装備変更/一時停止、版/モード/分母変更、停止/オフライン復帰/session変更/観測空白、checkpoint/入力不正/上限/freeze/順序の決定性をモック検証。木こりexecutorの所有確認停止と人工シナリオで接続する。

## P4 戦闘観測/境界guard（2026-10-11）
- ユースケース: 型宣言を参考にHP/stats/damage type/resistance/Auto Eat/選択食料/効果と攻撃選択の件数をテスト専用readerで列挙し、未知戦闘を拒否する。stats.dirty=trueなら数値getterを呼んで再計算しない。敵未選択/不一致を未知として扱い、新しい敵を選択/生成しない。
- 読取り supported は生存保証ではない。通常maxHitから軽減後burstを推測しない。多段/DoT/passive/反射/条件変化/area/Auto Eat timing/資源変化を含む完全な人工envelopeがない場合はrisk unknown。Hardcore/モード不明は既定拒否。
- guardは人工frameのobservationId/敵/damage type/時刻を照合する。envelopeは全Auto Eat機会間の軽減後ダメージ上限と最短機会間隔、healing最小を確認済みfixtureとして供給。実ゲームのAPI検証や死亡確率の証明に昇格させない。
- 正のdamageでは現在HPとAuto Eat thresholdの両方がburstを厳密に上回り、回復下限がthresholdを上回ることを要求。0〜上限のどのdamageでもthresholdにちょうど止まる経路があるため、max damage連打だけのsimulationを安全証明にしない。
- 食料は選択slotのみ、全horizonの最悪機会数×最悪必要個数を確保。基礎healsFor×efficiencyを効果下限と仮定せず、最低healingは別証拠。不明/food不足/一撃致死/境界/古いframe/coverage欠落/overflow/探索上限はblocked。
- 成功はboundedな人工model内の条件付き生存だけ。actualDeathProbability=null、runnable/runtimeAllowed=false。graphへのguardは未評価combatのsafeラベルをunknownへ落とし、非戦闘代替を選べるようにする。実戦APIは未実装。
- 受け入れ: readerのdirty/欠落/例外/敵identity/food/形/上限/危険setter非参照、HPとthresholdの厳密境界、多段burst/DoT等coverage、時刻/敵/type/Hardcore、food/healing/frequency/overflow、graph非戦闘fallback/freezeを人工データで検証する。

## FR-04 戦闘リスク管理（P4）
- 通常の戦闘シミュレーションまたは保守的な生存条件により死亡リスクを評価。
- 自動Eat、消耗品、装備、祈り、食料、敵の特殊攻撃とHardcore設定を考慮。
- 不確かなダンジョンは突入しない。安全な育成目標にフォールバック。
- 受け入れ: 安全失敗系のテスト、死亡リスク不明時に拒否するテスト。

## P4 継続制御/記録（2026-10-11 / 人工port）
- ユースケース: 明示的start後、候補窓→数量計画→木こり命令→対象監視→所有確認停止→再観測をcontrollerで継続する。実環境factoryは無条件拒否。命令や目標の手入力を要求せず、未対応actionは拒否する。
- 初期/復元状態はstopped。保存データのrunningを再開許可にしない。active命令/attempted命令が残れば要確認として開始を拒否する。checkpointはschema/run ID/epoch/探索cursor/命令ledger/固定理由journalだけで、セーブ・全観測・認証・例外本文は保存しない。
- 操作前にattemptedをdurable storeへ保存してからexecutorを呼ぶ。1stepに命令1回、同じIDは再操作しない。epochを保存して再起動時も命令IDを再利用しない。保存失敗/不明operation/cleanup失敗は停止し、曖昧な状態を自動再試行しない。
- 有効な作業はmonitorだけで継続し、わずかな効率差でswitchしない。完了後に所有確認停止し、次のstepで新しい状態から計画する。解析blocked窓は位置を進めて別候補へ移るが、連続窓数/最大step数に上限を持つ。未選択/折返し/全窓blockedをCompletion 100%としない。
- 手動stopは状態/tokenを即座に無効化し、同時に古いobserve/保存/operation結果から新規操作や再開をしない。異なるsessionへ切り替わった場合は所有が不明なので別キャラクターの行動を止めず要確認。offline中は停止API/報酬生成をせずsuspended、復帰時は再評価する。
- storeのwriteはtimeout後の実Promise完了も直列化し、停止後に旧writeが新しい停止記録を上書きしない。各portにtimeout。JSON/ledger/journalに件数/byte上限。journalは閉じたevent/reasonのみ、同じ観測待ちイベントを集約。所有確認停止後のretired命令だけを単調epoch watermarkへ圧縮し、未確定命令や二重実行防止を捨てない。
- 受け入れ: 実環境拒否/既定停止/開始条件、計画からmonitor/停止/再計画、二重step/命令/epoch、途中checkpoint/正常停止の復元、store/read/operation/cleanupの失敗とtimeout、手動停止と遅延結果、session/clock/offline、巨大候補の窓進行/上限、ログ秘匿/サイズ/集約、入力/出力分離を人工シナリオで検証。

## FR-05 長時間稼働（P4-P5）
- ゲーム再読み込み後、プレイヤーが再開操作したときにスナップショットを読み直し計画を更新。
- オフライン報酬はゲームに任せ、復帰後に再判定。ログは機密情報を含まずサイズ制限。
- 受け入れ: 一時停止、ブラウザ再起動、素材欠乏、資金不足、銀行満杯、予期せぬUI変更で安全停止。

## P5 Completion監査/停滞report（2026-10-11）
- ユースケース: Base/TotH/AoD/ItAと5カテゴリの全観測を照合し、未達/未検証/除外/観測上の全達成を分離する。全scopeの所有情報と全カテゴリのentries/missing/分子/分母/率を検査。空/部分/窓結果/自己申告achievedから100%を推測しない。
- GameAdapterのscope percentを正として残し、独自の平均/全スキル99/所持数量から総Completionを再定義しない。100%と未達項目が矛盾した場合は未検証。基礎/DLCを混ぜた架空の総達成率を作らない。
- 実機確認済み経路がない現状ではactualCompleteは常にfalse。全データが整合していても観測上の全達成/実機照合待ちと表現し、プロジェクト/P5を完成と表明しない。
- reportは未達ID/locked数、取得失敗、controllerの固定理由履歴、探索位置が部分であることを件数/byte上限付きで列挙。任意extra fields/例外/認証/セーブをコピーしない。lockedやblockedだけで到達不能と断定しない。
- 停滞は同じmode/所有/分母の全観測だけで比較し、対象カテゴリcurrentが増えた時刻を更新。進捗逆行/分母やmode/所有変更/時刻逆行/部分観測/offline復帰は再評価として扱い、曖昧な空白を進捗なしと補完しない。
- 観測間隔が既定5分（設定上限30日）を超えた場合は新しい基準を作る。reportのbyte制限は進捗checkpointを含むUTF-8のJSON全体に適用し、集計を保持できない場合は固定理由で拒否する。
- controllerは最新CompletionとjournalからgetReportを返し、レポートと小さい進捗checkpointはゲーム/保存へ送らない。全観測が揃うまでは進捗比較を保留。planning/監視/命令のsource snapshotを切り詰めない。
- reportは直近の観測step終了時のjournalを含む。手動停止後の最新状態はgetStateで確認する。手動再開とsession変更時にreport/進捗checkpointを破棄し、別の実行期間を停滞比較しない。
- 受け入れ: 4スコープ×5カテゴリ、mock全達成、missingの残存/不一致/未知所有/空/部分/重複/数値不正/上限、scope集計矛盾、通常/abyssal/mastery ID、停滞/進捗/mode/分母/所有/逆行/offline、診断の秘匿/切捨て、freeze/決定性、controller getReport統合を検証する。

## P5長時間の人工統合検証（2026-10-11）
- ユースケース: 数百の未達候補から手入力なしで作業を順次選び、候補窓・数量計画・命令前記録・監視・所有停止・全Completion監査を一貫検証する。時間と取得結果は人工fixtureが供給し、実報酬を作るコードは追加しない。
- 小さいledger/journal上限で回転を繰り返し、全命令のepoch単調性/二重発行防止、checkpoint/report容量、未達項目が最後まで残ることを確認する。
- 7日以上の仮想時間にoffline復帰、手動停止、正常停止後の別controller復元、bank不足、全窓blockedを含める。復元は停止状態とし、explicit start後だけ再評価する。
- 受け入れ: 多数作業の完了、停滞/不足での停止、未確定記録を捨てない圧縮、offline中の非操作、最終mock全達成でもactualComplete=falseを検証。実機受け入れ表を準備し、仮想時間試験を実時間/実ゲーム/P5完了と扱わない。

## FR-06 Completion 100%（P5-P6）

- Completion Logのスコープ別100%を根拠に達成判定。
- 達成が長時間停滞したとき、未達項目/原因/ブロッカーを列挙。
- DLC未所持、制限付きモード、ゲーム内条件で到達不可能なものは理由を明示し偽の達成率を示さない。

## 非機能要件
- Windowsの一般的なノートPCで稼働。GPU、LLM、有料API、ゲームソース全量のローカル保存は必須にしない。
- 初期MODはゲーム起動後に手動で開始する。常時「緊急停止」を表示。
- すべての書き込み系機能は設定で個別に無効化でき、未検証は常時無効。
- 実ゲームの挙動を変える前にバックアップセーブと別MODプロファイルを使用。

## 100%の定義上の注意
Melvor Idleのクリア条件はゲームモードやDLCによって異なる。すべてのレベルを一定値まで上げることだけではCompletion 100%を保証できない。ゲーム内ログを常に優先する。
