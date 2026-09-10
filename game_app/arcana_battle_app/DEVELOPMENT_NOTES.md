# アルカナバトル 開発メモ（引き継ぎ用）

このファイルは長い開発セッションの区切りで作成した引き継ぎ資料です。次のセッションはまずこれを読んでから作業を再開してください。

## 概要・デプロイ

- リポジトリ: `bhag008.github.io`（GitHub Pagesの個人サイト、`master`にpushすると自動デプロイ）
- 公開URL: https://bhag008.github.io/game_app/arcana_battle_app/
- スタック: バニラJS ESモジュール、buildツールなし。`game_app/`配下の他アプリ（Make10, Hit&Blow）と同じ構成
- ローカル起動: `python -m http.server <port> --directory game_app/arcana_battle_app`（`.claude/launch.json`に`arcana_battle`という名前で登録済み）

## ファイル構成

- `js/engine.js` — バトルルール・状態遷移（ターン管理、カードプレイ、攻撃、効果解決）
- `js/cards.js` — 全カードデータ（スタンダード24種＋拡張パック3種）
- `js/ai.js` — CPU思考ロジック（ジェネレーター関数、1手ずつ`yield`して演出と同期）
- `js/opponents.js` — CPU対戦相手6体のデータ
- `js/state.js` — 永続化（ゴールド・コレクション・複数デッキ・戦績）
- `js/shop.js` — パック開封抽選
- `js/sync.js` — クラウド同期（Firebase Realtime Database、任意機能）
- `js/selection.js` — 対戦相手選択画面→バトル画面への受け渡し
- `js/ui/*.js` — 画面ごとのレンダリング（home, deck, shop, opponentSelect, battle, cardView）
- `firebase-config.js` — Firebase設定（このゲーム専用プロジェクト。Make10/Hit&Blowとは別）

## ゲームルール現状

- デッキ30枚（同名カード2枚まで）、初期手札4枚
- CPU戦は毎回先攻/後攻がランダム。後攻は自分の最初のターン開始時の通常ドローで結果的に5枚になる（配布時は先攻・後攻とも4枚）
- ライフ25、マナ最大10（毎ターン+1）
- 最大5個のデッキを保存でき、1つを「使用中デッキ」に設定してバトルに使う（`state.js`の`decks`配列＋`activeDeckIndex`）
- 盤面最大5体、手札上限8枚

## カードプール

### スタンダード（24種、常時使用可能）
基本カード。コスト1〜7。

### 拡張パック（パック購入で入手。100G/パック、コモン70%/レア22%/エピック6%/レジェンダリー2%、レア以上1枚確定。基本20種構成だが進化の秘伝書のみバランス調整で22種）
1. **焔の書**（Book of Flame、20種） — 炎・竜テーマ
2. **深淵の書**（Book of the Abyss、20種） — 悪魔・契約テーマ
3. **妖精の書**（Book of Fairies、20種） — 妖精・群れシナジーテーマ（種族システム導入）
4. **進化の秘伝書**（Book of Evolution、22種：コモン10/レア6/エピック4/レジェンダリー2） — 竜・デーモンの「進化」システムがテーマ（下記「進化（evolve）システム」参照）。EXPANSIONS/EXPANSION_CARDSのキーは`"evolution"`。竜の展開カードが手薄だった反省からコモンを8→10に追加している（詳細はバランス検証メモ参照）

### 種族（race）システム
`card.race`: `"dragon"` | `"demon"` | `"fairy"` | `undefined`。既存の竜・悪魔カードは遡及タグ付け済み（焔の書のドラゴン4種、深淵の書のデーモン9種）。進化の秘伝書のカードも当然dragon/demonタグを持つ。

## エンジンのメカニクス一覧

### キーワード（`keywords`配列）
- `taunt`（挑発）: 敵はこれを優先攻撃する必要がある
- `charge`（速攻）: 出したターンに攻撃可能
- `lifesteal`（吸血）: 与えたダメージ分自分のリーダーを回復

### トリガー（ミニオンのカード定義に持たせられる）
- `battlecry` — 戦場に出た時（プレイ時）
- `deathrattle` — 破壊された時
- `onAttack` — このミニオンが攻撃した時
- `onDefend` — このミニオンが攻撃を受けた時

いずれも`target:"none"`の効果のみ使うこと（UI側でターゲット選択させたくないため）。

### スペル/効果のtarget種別
- `"select"` — 敵ミニオン or 敵リーダーを選べる（リーチ火力。**威力は低め**に設定する）
- `"select_monster"` — 敵ミニオンのみ選べる（純粋な除去。**威力は高め**に設定する）
- `"enemy_face"` / `"self_face"` — 固定ターゲット、選択不要
- `"none"` — ターゲット不要（全体効果・自己効果など）

### 効果タイプ一覧（`effect.type` / `battlecry.type`など）
`damage`, `heal`, `draw`, `damage_all_enemy`, `summon_token`, `self_damage_draw`（自傷+ドロー）, `pact_nuke`（自傷+ドロー+盤面全体ダメージ、自身は除外）, `discard_random_enemy`（手札ランダム破棄）, `damage_monster_and_self`（除去+自傷）, `damage_all_enemy_and_draw`, `heal_and_draw`, `buff_all_friendly_race`（自種族全体バフ）, `buff_self_per_race_count`（他種族数だけ自身バフ）, `summon_token_and_buff_self`（召喚してから自身バフ、新規召喚分も加算）, `draw_per_race_count`（種族数だけドロー、cap上限あり）, `bounce_random_enemy_if_race_count`（種族数がしきい値以上ならランダムに敵ミニオンを手札へ戻す）, `random_burst`（敵ミニオンor顔にランダムに`value`ダメージを`hits`回。進化の秘伝書レジェンダリー専用の派手系効果）, `damage_all_enemy_and_draw_per_kill`（敵全体に`value`ダメージ、撃破した数だけドロー。同じく進化の秘伝書レジェンダリー専用）, `tutor_random_evolve`（自分のデッキから`evolve`持ちカードをランダムに1枚サーチして手札に加える。手札上限なら見つけたカードごと失う＝`drawCard`と同じ挙動）

### コスト軽減（`costReducePerRace`）
ミニオン/スペルのカード定義に`{race, cap}`を持たせると、場の指定種族の数だけプレイ時コストが下がる（上限cap）。`engine.js`の`getEffectiveCost(game, side, card)`で計算。`canPlayCard`/`playCard`両方がこれを参照する。UI（手札）では`cardView.js`の`createCardEl`に`costOverride`を渡すと軽減後の数字が表示される（`battle.js`が計算して渡している）。

### 種族シナジーの設計方針（重要）
**常時発動のオーラ（continuous aura）ではなく、既存のトリガーポイント（battlecry等）で発火時点の盤面をカウントする「一回きりのスナップショット効果」として実装している。** これにより盤面が変化してもバフは動的に増減しない（シンプルさ優先の設計判断）。`countRace(game, side, race, excludeUid)`が種族カウントのヘルパー。

### 進化（`evolve`）システム（進化の秘伝書で導入）
デュエルマスターズ型の進化を簡略化して実装。ミニオンのカード定義に`evolve: { race: "dragon" | "demon" }`を持たせると進化カードになる。

**ルール（意図的な簡略化）:**
- 盤面に**進化元と同種族のミニオンが1体以上いること**が唯一のプレイ条件（`canPlayCard`が`p.board.some(m => m.race === card.evolve.race)`でチェック）。コスト・種族以外の制約（元のカードのコストや進化元の指定など本家DMにある細かい条件）は持たせていない。
- プレイすると**新しいミニオンとして場に追加されるのではなく、選んだ進化元ミニオンのオブジェクトを直接書き換える**（`playCard`内の`card.evolve`分岐）。そのため**盤面枠を消費しない**（`MAX_BOARD`一杯でも進化はできる。`canPlayCard`・`ai.js`の両方でこの枠チェックを迂回させている）。
- 進化元の**デスラトルは発動しない**（破壊ではなく進化のため、`removeDeadMinions`を経由しない）。
- 進化後のミニオンは**`sick`を常にfalse**にする（進化元の召喚酔い状態に関わらず、進化させたその場で攻撃できる＝進化の最大の旨味）。ただし**`attacked`は引き継ぐ**（そのターン既に攻撃済みの個体を進化させても2回攻撃はできない）。
- 進化カードに`battlecry`を持たせると「進化時」の効果として発動する（`target:"none"`または`enemy_face`/`self_face`など固定ターゲットのみ。進化元選択と別に敵ターゲット選択を要求する設計にはしていない＝UIの複雑化を避けるため）。
- ダメージを受けて欠けたHPなどは**進化時にリセットされる**（進化先のカード定義のhp/maxHpでまるごと上書き。スタック管理はしていない、シンプルさ優先）。

**UI側の対応（`battle.js`/`cardView.js`）:**
- 手札で進化カードをクリックすると`needsTarget`がtrueを返し（`card.evolve`があれば無条件でtrue）、`pending.kind === "play"`になる。`opponentTargets()`が`pending.card.evolve`を見て**自分の盤面の同種族ミニオン**をターゲット候補として返す。
- 自分のミニオンをクリックした時の処理（`handlePlayerMinionClick`）は、従来「攻撃選択」しか考慮していなかったが、`pending.kind === "play"`中は先にターゲット選択として扱うよう修正した。**この修正はもともと回復スペル（`heal`/`heal_and_draw`）で自分のミニオンを対象に選ぶ際にも必要だったはずの経路で、進化実装のついでに直した**（回復スペルの対象選択が機能していたか未確認だったため、進化と合わせて動作確認済み）。
- 進化のターゲット選択中は、既存の攻撃対象ハイライト（赤 `.targetable`）と区別するため専用の`.evolve-targetable`（オレンジ、`--evolve`カラー変数）でハイライトする。
- 手札カードの表示には`⬆ 進化－ドラゴン/デーモン`のバッジ（`.card-evolve-tag`）を追加（`cardView.js`）。

**AI側の対応（`ai.js`）:**
- `playCpuCardsSteps`の`playable`フィルタで、進化カードは`p.board.length < MAX_BOARD`チェックを免除するよう修正（`card.evolve`なら常に許可、`canPlayCard`側の条件と整合）。
- `chooseEvolveTarget(game, side, race)`: 進化元候補の中から「まだ攻撃していない個体」を優先（進化後すぐ攻撃できるため）、同条件なら攻撃力+体力の合計が低い個体を優先（弱い個体を底上げする）。

**バランス検証メモ（2026年時点、簡易テストデッキでの結果）:**
自動シミュレーション（`ai.js`同士の対称対戦、300戦/カード）で竜魔進化デッキを組んで検証したところ、進化元と進化ペイオフの比率が重要だと分かった。進化ペイオフ（`evolve`持ちカード）を増やしすぎると進化元が枯渇して手札で腐るカードが増え、逆に勝率が下がる（レジェンダリー2枚ずつ×エピック2枚ずつに全振りした構成でaggro相手18%まで悪化）。進化元・トークン生成・サポートスペルをバランスよく混ぜた構成が最も安定した。

**竜デッキと悪魔デッキは分けて構築すること（重要）。** 竜と悪魔を混在させたデッキは、進化元をどちらの種族にも投資する必要があり非効率。単色で組んだ方が進化元の安定供給という点で強い。ただし単色化しただけでは足りず、**除去スペルではなく展開札（進化元候補・トークン生成）を優先して積む**必要がある（受け重視の構成にすると、除去1枚が相手1体としか交換できないのに対し進化・展開が生む複数ボディの物量に負ける。この教訓はコントロールデッキの検証時と同じ）。

**竜と悪魔で種族専用カードの層の厚さに偏りがある。** 悪魔は「深淵の書」がデーモン専業拡張のため種族タグ付きカードが20種近くあるのに対し、竜は「焔の書」がテーマ的に竜オンリーではなく（"焔"＝炎全般）実質4種類（`fl_c3`/`fl_r6`/`fl_l1`/`std_dragonet`）しかなく、進化の秘伝書のカードを合わせても悪魔よりだいぶ手薄。この差はデッキ構築だけでは埋めきれず、進化の秘伝書に竜専用の低コスト展開カードを2種追加した（`ev_c9`双竜の巣：3cスペルで2/1竜のひなを2体、`ev_c10`火吹きの幼竜：1c 1/1速攻、戦場に出た時1dmg）。追加後、竜デッキの妖精コンボ戦が27.7%→33.3%、悪魔デッキ戦が23.3%→33.0%まで改善した。

**現状の3アーキタイプ比較（対妖精コンボ勝率、単色デッキ・展開重視構成）:** 悪魔48.0%（ほぼ互角）＞ 竜33.3%（まだ劣勢）。竜は種族カードの層がまだ薄く、さらなる強化の余地がある。

## CPU対戦相手（6体、レベル1〜6）

| レベル | 名前 | テーマ | 報酬(勝/敗) |
|---|---|---|---|
| 1 | 見習い冒険者 | 低コスト中心 | 15G/3G |
| 2 | 熟練の戦士 | バランス型スタンダード | 25G/5G |
| 3 | 焔の魔導士 | 焔の書、除去+挑発 | 40G/8G |
| 4 | 紅蓮の竜王 | 焔の書エピック・レジェンダリー | 65G/12G |
| 5 | 魔王ザガレス | 深淵の書、自身のレジェンダリーカードを使用 | 90G/15G |
| 6 | 妖精女王ティターニエラ | 妖精の書＋他セット混合、自身のレジェンダリーカードを使用 | 75G/14G |

**注意**: 魔王ザガレスと妖精女王は「自分自身のレジェンダリーカードを使い手として使う」演出。妖精女王は難易度調整に苦労した（下記AI節参照）。報酬は実測難易度に基づいて設定しており、必ずしもレベル順=強さ順ではない（妖精女王は紅蓮の竜王/魔王ザガレスよりやや弱め）。

## AIロジックの注意点

`js/ai.js`は単純な貪欲法（コスト降順で出せるカードを出す）。以下のヒューリスティックを追加済み:

1. **挑発優先展開**: 自分の場に挑発がなく、敵に盤面があるときは挑発ミニオンを最優先で出す
2. **スケーラー温存**: `buff_self_per_race_count`/`summon_token_and_buff_self`/`buff_all_friendly_race`/`draw_per_race_count`系の効果（`isScalerBattlecry`）は、他に出せるカードがある間は後回しにする（先に盤面を作ってから使う方が価値が高いため）
3. **薄い盤面への全体除去を温存**: `damage_all_enemy`/`damage_all_enemy_and_draw`系のスペル（`isWastefulBoardWipe`）は、敵の場にミニオンが2体未満なら他に出せるカードがある間は温存する（終焉の雷などの高コスト全体除去を1体だけの盤面に無駄撃ちしないため）
4. **無駄死に回避**: 挑発しか攻撃対象がない場合、単独で倒せず、かつ味方の残り攻撃力合計でも倒しきれないなら攻撃しない（温存する）

上記2・3はいずれも「他に出せるカードがなければ結局そのターンに出す」フォールバック方式（`playCpuCardsSteps`内の`preferred`/`pool`ロジック）。全CPU共通のロジックなので、特定のボス専用ではなく該当カードを持つ全デッキに効く。

**重要な教訓**: シナジー（群れ）デッキはこの単純なAIでは理想的な運用ができない。妖精女王ボスの調整時、純粋なシナジー特化デッキはプレイヤー勝率80%まで弱くなった。最終的に「単体でも強いカードを多めに混ぜる」構成に倒すことで解決した。**今後シナジー系の新CPUデッキを作る際はこれを念頭に置くこと**（自動シミュレーションで弱く出たら、デッキ構成を見直すか、AIのヒューリスティックを拡張する）。

## バランス検証のワークフロー（必須）

カードやAIを変更したら、必ず以下を実行してから提案すること:

### 1. 重複・上位互得チェック（自動スクリプト）
コスト・攻撃力・体力・キーワード・種族・battlecry/deathrattle/onAttack/onDefendの内容が完全一致するカードがないか、上位互換（同条件で片方が全項目以上）がないかを機械的にチェックする。ブラウザコンソールで以下のようなスクリプトを実行する（`freshImport`ヘルパーは下記参照）:

```js
const cardsMod = await import(await window.freshImport('/js/cards.js'));
const all = cardsMod.allCollectibleCards();
// sig関数で (type,cost,atk,hp,keywords,race,battlecry/deathrattle/onAttack/onDefend) または (type,cost,effect) を文字列化し、
// 完全一致=重複、部分的に優劣がつく=上位互換としてリストアップする
```
（過去の実装は会話ログのコード参照。同じロジックを毎回書き直している）

### 2. エンジンレベルの直接テスト
`createGame(deckA, deckB, "player")`で先攻を固定し、`game.players.player.board`などを直接書き換えて特定シチュエーションを再現し、効果の数値が期待通りか確認する。

### 3. 大量シミュレーション
`runCpuTurnSteps`（AI）＋簡易プレイヤーロジック（`canPlayCard`→`playCard`をコスト順に回す、`declareAttack`で最後のターゲットを殴る等）で30〜60戦程度自動対戦させ、エラーが出ないか・勝率が妥当かを確認する。

### 4. 実画面での目視確認
`preview_start`または新しいポートでサーバーを立てて実際にクリック操作し、コンソールエラーがないか確認する。

## ⚠️ ブラウザのESモジュールキャッシュに関する重大な注意

**`import(url)`はネストされたimportがキャッシュされたままになることがあり、ソースを編集した直後でも古いコードが動いているように見える。** `navigate({force:true})`や新しいタブでも直らないことがある。

**対処法（2つ）:**
1. **ロジックテスト**: 以下の`freshImport`ヘルパーを使う（全ファイルを`cache:'no-store'`で取得し、相対importをBlob URLに書き換えて再帰的に解決する）:
```js
window.__freshCache = new Map();
async function freshImport(url) {
  const abs = new URL(url, location.href).href;
  if (window.__freshCache.has(abs)) return window.__freshCache.get(abs);
  const res = await fetch(abs, { cache: 'no-store' });
  let text = await res.text();
  const importRegex = /from\s+["'](\.[^"']+)["']/g;
  const matches = [...text.matchAll(importRegex)];
  const seen = new Set();
  for (const m of matches) {
    const relPath = m[1];
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    const resolvedUrl = new URL(relPath, abs).href;
    const blobUrl = await freshImport(resolvedUrl);
    text = text.split(`"${relPath}"`).join(`"${blobUrl}"`).split(`'${relPath}'`).join(`'${blobUrl}'`);
  }
  const blob = new Blob([text], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  window.__freshCache.set(abs, blobUrl);
  return blobUrl;
}
window.freshImport = freshImport;
```
使い方: `const eng = await import(await freshImport('/js/engine.js'));`

2. **実画面テスト**: 新しいポートでサーバーを立てて（例: `python -m http.server 82xx --directory game_app/arcana_battle_app`）そのポートにnavigateする。別オリジンなのでキャッシュが効かない。テスト後はプロセスを止めること。

## カード設計の絶対ルール

**異なるカード同士で効果が完全に同一（コスト・数値・キーワードまで一致）になることを絶対に避ける。** 拡張セットをまたいでも同じ。過去に何度か「焔の書と深淵の書で数値まで同じ全体火傷スペル」のようなミスをして怒られている。新カードを追加したら必ず上記の重複チェックスクリプトを回すこと。

## その他の運用ルール

- **commit/pushは必ずユーザーの明示的な承認後に行う**（このリポジトリは公開サイトなので特に厳格に）
- 他セッションが並行して`game_app/`配下の別アプリ（麻雀アプリ等）を触っていることがある。`git status`で自分が触っていないファイルが混ざっていたら、それらはstageしないこと
- コミットメッセージのheredocで過去に何度か「別の変更の説明文を貼り間違える」事故があった。pushする前に`git log --oneline -3`で最新コミットのメッセージを必ず目視確認すること

## 今後の余地（ユーザーから明示的な依頼はまだないが、話が出るかもしれない項目）

- 種族シナジーをさらに拡張する場合、新しい効果タイプを増やす前に既存のもの（上記一覧）で表現できないか検討する
- 妖精女王ボスの難易度は「実測でやや弱め」。AI側の温存ヒューリスティック拡張（`buff_all_friendly_race`の温存、薄い盤面への全体除去温存、上記AI節参照）で対CPU勝率を60戦/250戦シミュレーションで82.0%→85.6%まで引き上げ済みだが、伸びは小さめ。さらに強くする場合はシナジーカードの多いデッキ専用の展開順ロジック（種族カードを先出しして頭数を稼いでからスケーラーを出す等）が次の候補
- クラウド同期は実装済みだが、複数デッキ機能追加後にフル動作確認（同期後に複数デッキが正しく引き継がれるか）はまだ行っていない可能性がある — 触るタスクが来たら確認すること
