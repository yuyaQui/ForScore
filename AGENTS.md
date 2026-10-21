<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# kqk-abc — クイズ大会の得点表示システム

高校生クイズ大会「abc」の進行と得点をリアルタイム表示するアプリ。進行者が `/admin` を操作し、会場スクリーンに `/main` を投影する。

ルールの出典は `abc the24th ルール` (PDF)。3rd Round の設計は `docs/3rd-round-design.md` にまとめてある。**3rd Round の作業に入る前に必ず読むこと。**

完成までの全体の進め方（各ラウンドの機能実装とデザインをどの順で進めるか）は `docs/roadmap.md` にまとめてある。

## 起動

```bash
npm run dev     # node server.js（next dev ではない）
npx prisma db seed   # test_players.csv から48名を投入
```

`server.js` が Next.js と Socket.IO を1つの HTTP サーバに相乗りさせている。**`server/` 配下を変更したらサーバの再起動が必要**（ホットリロードされない）。

## 進行状況

| ラウンド | 状態 |
|---|---|
| 1st Round | 完成（共有タイマー、CSV取込） |
| 2nd Round | 完成（連答つき5○2×、アドバンテージ、Undo、組リセット） |
| 3rd Round | コース選択・4コースの採点・通過順位と準決勝席順（工程9）が完成。工程8（15分経過時の同着判定・早押しプレーオフ）はシステム化せず実施者が手動で判断する方針にした |
| Extra Round | 完成（2026-10-06。2026-10-07 に問題文・解答の段階表示を追加。仕様は `docs/extra-round-design.md` の0章。要 `npx prisma migrate dev` ＋サーバ再起動） |
| 準決勝 | 機能を実装（2026-10-10。進行・判定・サドンデス・点数発表の演出。仕様は `docs/semifinal-design.md` 6章）。進出者紹介（二つ名・写真を DB に登録）と新しい選手カード・タイマーを実装（2026-10-15、同 7章）。セットの操作フロー（タイマー開始〜得点集計〜判定の2段階化）と結果リセットを実装（2026-10-17、同 8章） |
| 決勝 | 最終順位の自動確定を実装（2026-10-10、`docs/final-design.md` 6章）。Main をサイバーパンクのデザインに作り直した（2026-10-15、同 7章）。待機・選手紹介（成績つき）・最終成績の表示を実装（2026-10-17、同 8章）。Admin の採点部分の見た目は従来のまま |

デザインの作り込みは、各ラウンドの機能実装が終わった直後に順次行う方針（2026-09-25 に変更。経緯と全体の流れは `docs/roadmap.md`）。

## 次にやること

```
工程0    lint をゼロにする                         … 完了（30件 → 0件）
工程7-1  15分タイマー（コース別、自動停止）          … 完了
工程7-2  スコア更新の土台（正誤ボタン、Undo）        … 完了
工程7-3  10 up-down                               … 完了
工程7-3.5 終了判定（2名勝ち抜け / 3名失格）          … 完了
工程7-4  10 by 10                                 … 完了
工程7-5  Swedish 10                               … 完了
工程7-6  Freeze 10                                … 完了
工程8    15分経過時の順位決定、同着検出、早押しプレーオフ  … スキップ（システム化せず、実施者が手動で判断する方針にした）
工程9    通過順位と準決勝の席順                         … 完了（lib/semifinal.ts に実装済み。Extra Round/準決勝の土台追加時に先行して用意されていた）
工程10   3rd Round の見た目デザイン                     … 完了（2026-10-10 に完了扱いと決定）
準決勝 / 決勝 の機能仕上げ → デザイン                  ← ここから（準決勝の見た目・進出者紹介と決勝 Main は 2026-10-15 に実装。決定事項は semifinal-design 7章・final-design 7章。残りは決勝 Admin の見た目）
工程6    ルーレット演出（デザインフェーズに回してよい）
工程0-2  socket の所有構造を直す（set-state-in-effect の保留分）
```

各コースのルールと判定基準は `docs/3rd-round-design.md` の3章にある。

**当初の計画から動いた点が4つある。**

1. **工程7-3.5 を新設した。** `AGENTS.md` は終了判定を共通部分として工程7-2 に置いていたが、終了判定は「勝ち抜け」「失格」が存在しないと書けず、その条件はコースごとに違う。最初の1コース（10 up-down）を実装したあとに回した
2. **終了条件2（3名失格）の順位を席順で決着させることにした。** 設計メモ 4.3 は「3名失格 or 15分経過」の両方でプレーオフとしていたが、前者は残った全員がどのみち勝ち抜けるため順位の付け方だけの問題で、後者は誰が通過するかが決まる。重みが違うので扱いを分けた。詳細は `docs/3rd-round-design.md` 4.3 の「プレーオフを行うのは15分経過のときだけ（改訂）」

3. **工程8（早押しプレーオフ）をシステム化しない方針にした（2026-10-03）。** 15分経過時に同着が出た場合の決着は、実施者（スタッフ）が手動で判断する。同着検出・プレーオフ専用モードの実装は行わない
4. **工程9（通過順位と準決勝の席順）は、3rd Round 本体の実装順を待たずに完了していたことが判明した（2026-10-03）。** `lib/semifinal.ts` の `getSemifinalSeats` が、Extra Round/準決勝の土台追加時（2026-09-27）にすでに実装・結線されていた

### 3rd Round 採点の構造

`lib/thirdRoundScoring.ts` の `applyThirdRoundScore` が3段になっている。**この順序を崩さないこと。**

```
0段目  Freeze 10 のみ。1問終わったので休み中の全員の残り問数を1減らす
1段目  対象の選手だけを採点する（共通処理 → コース別）
2段目  終了条件2 が成立していたら残り全員を勝ち抜けにする
```

0段目が1段目より前にあるのは、**誤答したその問題自体を休みに数えないため**（設計メモ 3.3）。誤答処理でセットした直後に同じ問題で減算すると休みが1問ずれる。

採点ロジックはすべてこの純関数の中にあり、**ルートは DB とのやりとりだけを担当する。** 2nd Round はルールをルートハンドラに直接書いており、記録されている2つのバグはその構造から出た。新しいコースやルールを足すときも、ルートではなくこの関数を触ること。

### 列を持つ / 持たないの判断（実装後の確認）

| 値 | 判断 | 理由 |
|---|---|---|
| 10by10 の総合pt・誤答pt | 持たない | `正解数 ×(10 − 誤答数)` で導出できる |
| 10up-down のポイント | 持つ | 誤答で0に戻るため正解数から導出できない |
| Swedish の × | 持つ | 誤答時点の正解数に依存するため履歴なしでは導出できない |
| Freeze の残り休み | 持つ | 出題の進行に依存するため導出できない |
| スルー回数 | 持たない | 休みを減らす契機に使うだけで、選手に紐づく値ではない |

`thirdRoundCorrectCount` は**4コース共通で加算する**。10 up-down は判定に使わないが、共通部分に1コースだけ例外を作るより「共通は常に同じことをして、コース別は足すだけ」の形を保つ方が追いやすい。

### API の約束

`updateScores` と `undo`（と、2026-10-11 追加の `resetScores` が0に戻すフィールド）は**6項目で一致していなければならない。** 新しい列を触るようになったとき、片方だけ足して忘れると「Undo したのに一部だけ戻らない」バグになる。次の grep で確認できる。

```bash
for f in app/api/thirdRound/updateScores/route.ts app/api/thirdRound/undo/route.ts; do
  grep -o "thirdRound[A-Za-z]*: p\.thirdRound[A-Za-z]*" $f | sort
done
```

スコア更新は**対象コースを常に `courseName` で受け取る。** スルーは選手に紐づかないイベントなので、`playerId` から所属コースを引く方法が使えない。

### 工程0: lint をゼロにする（完了）

`npm run lint` が一度も通っていなかった（30件）ため、「lint が通るか」を変更の妥当性の目安に使えるようゼロにした。以下は次に触る人が壊さないための記録。

**eslint の対象範囲**

`eslint.config.mjs` の配列末尾に override を置き、`server.js` / `server/**/*.js` / `constants.js` に対して `@typescript-eslint/no-require-imports` **だけ**を無効化した。これらは意図的に CommonJS で書いている（`node server.js` で直接起動するため）が、`eslint-config-next/typescript` が `files` を絞らずにルールを入れているため `.js` まで対象になっていた。

`globalIgnores` で `server/` を除外**しない**こと。他のルールは効かせ続けたい（実際に未使用の `require("node:console")` を検出した実績がある）。flat config は「後に書いた設定が勝つ」ので、override は `nextTs` より後ろに置く必要がある。ファイルごとの実効設定は `npx eslint --print-config <file>` で確認できる。

**共有型の置き場は `lib/types.ts`**

Prisma の `Player` / `ThirdRoundCourse` はここから再エクスポートしている。**`app/` 配下から `@prisma/client` を直接 import しないこと。** `import` に `type` を書き忘れると DB クライアント本体をブラウザ側へ読み込むことになるため、参照を1箇所に閉じている。

`Player` は現在すべての列が `Int` / `String` / `Boolean` なので、API のレスポンス（JSON）を経由しても型がずれない。**`DateTime` 列を足すと `Date` が `string` になってずれる**ので、そのときは `lib/types.ts` 側で API 用の型を再定義する。`SecondRoundHistory` / `ThirdRoundHistory` は既に `createdAt` を持つため、Undo 履歴を画面に出すときはこれに該当する。

**`constants.js` の読み込み**

TSX 側は `import { DEFAULT_COUNTDOWN } from "../../../constants.js"` で読む。CommonJS のファイルだが、`module.exports` のオブジェクトを静的解析できるため名前付き import が通り、tsconfig の `allowJs` により tsc も型を推論する。`server/` 側は `require` のまま。

**積み残し**

- `res.json()` が `any` を返すため、`setPlayers(data.allPlayers)` の行は型検査されていない。API のレスポンス型を定義すれば塞げる
- `Course` / `ThirdRoundState` / `AssignedPlayer` が Admin と Main で重複定義されている。`lib/types.ts` へ寄せられる（`Course` は Prisma の `ThirdRoundCourse` で置き換え可能）

### 工程0-2: socket の所有構造を直す

`app/admin/page.tsx` と `app/main/page.tsx` で `react-hooks/set-state-in-effect` を `eslint-disable` で保留している。**このコメントを消すだけで済ませないこと。**

現状は `socket` を `useState` で持ち、effect の中で `setSocket()` している。子コンポーネントへ props で渡すためこの形が必要で、`useRef` にすると値の更新で再描画が起きず子に socket が永久に届かない。

ただし「初回レンダー（socket = null）→ effect → setState → 再レンダー（socket = Socket）」という連鎖が起き、子の依存配列が `[socket]` であるため **`MainSecondRound` / `MainThirdRound` / `AdminThirdRound` の初期 fetch がマウント時に2回走っている**（GET なので壊れはしない）。

対応案は `lib/socket.ts` にモジュールレベルのシングルトンを置き、`useMemo(getSocket, [])` で取得する形。`socket` が初回レンダー時点で存在するので `setSocket` が消え、props の型が `Socket | null` → `Socket` になって各コンポーネントの `if (socket)` ガードも不要になる。

- 波及するのは `socket` を props で受けている7コンポーネント + ページ2つ = 9ファイル
- 共有インスタンスになるため、アンマウント時の `disconnect()` を「listener だけ外す」へ設計し直す必要がある
- `socket.off("イベント名")` をハンドラ指定なしで呼んでいる箇所があり、そのイベントの listener を全部消してしまう。あわせて整理する

---

# 設計の約束

## データをどこに置くか

判断基準は4つ。**迷ったらこの順に当てはめる。**

| 条件 | 置き場所 | 例 |
|---|---|---|
| 消えたら困る | **DB** | 選手の得点、勝ち抜け順位、コースの実施順 |
| 消えても選び直せる | **サーバのメモリ**（`server/` のハンドラ） | 現在のモード、進行ステージ、タイマーの残り秒数 |
| 実行中に変わらない | **コードの定数**（`lib/`, `constants.js`） | コース名、制限時間、アドバンテージの配点 |
| 他の値から計算できる | **どこにも持たない** | 10by10 の総合pt、抽選の回数、確定済みかどうか |

### 導出できる値は持たない

これは繰り返し効いている原則。二重管理はいずれ必ずずれる。

- 10 by 10 の総合pt = `正解数 × (10 − 誤答数)` → 列にしない
- 抽選が何回済んだか = `playOrder` が入っているコースの数 → 状態にしない
- 出場者が確定済みか = そのコースの割当が5名いるか → フラグを持たない
- 現在処理中のコース = `playOrder` が最大のコース → 状態にしない

逆に、**導出できないものは必ず持つ**。10 up-down のポイント（誤答で0に戻るので正解数から復元できない）、Swedish 10 の×（誤答時点の正解数に依存）、Freeze 10 の残り休み問数、エントリーの締切済みフラグ。

## ディレクトリの役割

| | 誰が使うか | 形式 | DB に触るか |
|---|---|---|---|
| `app/` | ブラウザ / Next.js | TSX, TS (ESM) | `app/api/` のみ触る |
| `lib/` | `app/` 配下 | TS (ESM) | `lib/prisma.ts` が接続を持つ |
| `server/` | `server.js` | JS (CommonJS) | **触らない** |
| `constants.js` | 両方 | JS (CommonJS) | — |

`app/` 配下でURLになるのは `page.tsx` `route.ts` `layout.tsx` などの予約名だけ。それ以外（`app/components/` など）はルートにならない。

**`server/` のハンドラは DB に触らない。** CommonJS で書かれており Prisma を読み込んでいない。DB の読み書きは必ず `app/api/` 側で行う。

## DB は API、リアルタイム配信は Socket

この分担を崩さないこと。

```
Admin の操作
  → fetch('/api/...')        … DB を読み書きし、更新後の状態を返す
  → socket.emit(...)          … 返ってきた結果を全画面へ配る
  → 受信して画面を更新        … 自分の画面も配信経由で更新する
```

**fetch のレスポンスを直接 setState しない。** 自分だけ別経路で更新すると、Admin と Main で表示が食い違う。例外は画面を開いた直後の初期取得だけ（配信すべき新しい情報がないため）。

## データ種別ごとに更新経路は1本

**過去にバグを出した箇所。** 選手データをコース用のイベントに同乗させたため、Admin だけが受け取り、Main の表示が古いまま残った。

- 選手データは必ず `broadcast_scores` → `update_players`
- コース情報は必ず `broadcast_third_round_courses` → `update_third_round_courses`
- **API のレスポンス全体を emit しない。** 必要なフィールドだけを送る

複数の種類のデータが変わる操作では、**それぞれの経路で個別に配信する**。

```ts
// リセットは実施順と所属コースの両方を消すので、両方を配信する
socket.emit('broadcast_third_round_courses', data.courses);
socket.emit('broadcast_scores', data.allPlayers);
```

データの流れを変えたときは、**その生産者と消費者を全部列挙して、それぞれが更新されるか確認する。**

## `io.emit` と `socket.emit` の使い分け

| | 宛先 | 用途 |
|---|---|---|
| `io.emit` | 接続中の全員 | 状態が変わったときの配信 |
| `socket.emit` | そのクライアント1人 | 接続直後に現在の状態を渡す |

取り違えると「自分だけ変わって他が追随しない」または「誰かが繋ぐたびに全員が再描画される」という不具合になる。

## Socket イベント一覧

### クライアント → サーバ

| イベント | 引数 | ハンドラ |
|---|---|---|
| `change_mode` | mode: string | `ModeHandler` |
| `change_2nd_round_state` | `{ group, view }` | `ModeHandler` |
| `change_3rd_round_state` | `Partial<ThirdRoundState>` | `ThirdRoundHandler` |
| `change_semifinal_state` | `SemifinalState` の一部（`reviewRange` で振り返り範囲） | `SemifinalHandler`（項目ごとに検証） |
| `announce_semifinal_results` | `{ set }` | `SemifinalHandler`（振り返り中・得点入力済みのときだけ） |
| `change_semifinal_timer` | `{ action, seconds? }` | `SemifinalHandler` |
| `start_semifinal_lineup` | なし | `SemifinalHandler`（選手カード表示を始める） |
| `reset_semifinal_progress` | なし | `SemifinalHandler`（結果リセットに合わせて第1セット・タイマー 5:00 に戻す） |
| `change_final_state` | `FinalState` の一部（`set`・`view`・`introIndex`・`resultRank`） | `FinalHandler`（項目ごとに検証） |
| `semifinal_profiles_changed` | なし | `SemifinalHandler`（写真・二つ名の保存を全員に知らせる） |
| `request_semifinal_sync` / `request_final_sync` | なし | `SemifinalHandler` / `FinalHandler`（開いた画面にだけ現在の状態を返す） |
| `broadcast_scores` | `Player[]` | `server.js` |
| `broadcast_third_round_courses` | `ThirdRoundCourse[]` | `ThirdRoundHandler` |
| `reset_third_round_progress` | なし | `ThirdRoundHandler`（選手 CSV の取り込み後に、進行状態・タイマーを初期値に戻す） |
| `update_text` | text: string | `TextHandler` |
| `1R_start_timer` / `1R_stop_timer` / `1R_reset_timer` | なし | `FirstRoundHandler` |
| `1R_edit_timer` | seconds: number | `FirstRoundHandler` |

### サーバ → クライアント

| イベント | 引数 |
|---|---|
| `mode_update` | mode: string |
| `update_second_round_state` | `{ group, view }` |
| `update_third_round_state` | `{ phase, step, quizOrder }` |
| `update_third_round_courses` | `ThirdRoundCourse[]` |
| `update_semifinal_state` | `SemifinalState` |
| `update_semifinal_timer` | `SemifinalTimer` |
| `update_semifinal_profiles` | なし（受け取ったら `/api/semifinal/profiles` を取り直す） |
| `update_final_state` | `FinalState` |
| `update_players` | `Player[]` |
| `text_updated` | text: string |
| `1R_update_timer` | seconds: number |
| `1R_finish_timer` / `1R_reset_timer` | なし |

命名は `change_*` / `broadcast_*`（要求）→ `update_*`（配信）が基本。ただし既存に例外がある。

- `update_text` → `text_updated`（語順が逆）
- `1R_reset_timer` は**両方向で同じ名前**を使っている

**新しいイベントは基本形に従うこと。** 上の2つは既存コードなので放置しているが、真似しない。

## 命名規約

**名前が実態と食い違うのを避ける。** 過去に `secondRoundCorrectCount` が実際にはアドバンテージを含むポイントだったため、改名した。

- 単一のコースでしか使わないフィールドは、**どのコース用かを名前に含める**
  - `thirdRoundUpDownPoint`（10 up-down の現在ポイント）
  - `thirdRoundSwedishCross`（Swedish 10 の×）
  - `thirdRoundFreezeRest`（Freeze 10 の残り休み問数）
- 複数コースで共有するものは汎用名
  - `thirdRoundCorrectCount` / `thirdRoundWrongCount`
- `Point` という汎用名は避ける。コースによって別の「ポイント」概念があり混同する
- 順位フィールドの規約: **勝ち抜け → 正の数、失格 → −1、未決着 → 0**（`secondRoundRank`, `thirdRoundRank`）

## Prisma の運用

- スキーマ変更は `npx prisma migrate dev`。**`db push` は使わない**（履歴が残らず、実態とマイグレーションがずれる）
- 初期データを投入するマイグレーションを作るときは `--create-only` で SQL を生成し、`INSERT` を書き足してから適用する。**適用後のマイグレーションは編集しない**（チェックサムが変わる）
- ただし**まだ共有していない**マイグレーションなら、編集して `migrate reset` してよい
- `ThirdRoundCourse` の4行はマイグレーションで投入している。`lib/thirdRoundCourses.ts` の定数と文字列が一致していること
- `prisma/seed.ts` は開発用。`NODE_ENV=production` では実行を拒否する。**マスタデータを seed に置かないこと**（本番で作れなくなる）
- `*.db` は `.gitignore` 済み。マイグレーションは追跡対象

## 過去に踏んだバグと教訓

**Undo のスナップショットは、状態を書き換える前に文字列化する。**

`app/api/secondRound/updateScores/route.ts` で、DB から取得した配列を終了時処理が直接書き換えていたため、履歴保存の時点では「更新後」の状態になっていた。結果、勝ち抜けや繰り上げが発生した問題を Undo しても正しく巻き戻らなかった。

```ts
const groupPlayers = await prisma.player.findMany({ ... });
const snapshot = JSON.stringify(groupPlayers);   // 書き換わる前に固める
```

3rd Round の Undo を実装するときも同じ順序を守ること。

**他人の状態を無条件に上書きしない。**

同じファイルで、終了判定とは無関係に「自分以外の全員」を毎回 UPDATE していたため、他人が誤答するたびに連答権が消えていた。終了時だけ実行するよう `if` で囲んで解決。

**リセット系の操作は、消す対象を全部消す。**

抽選のリセットで `playOrder` だけを消して `thirdRoundCourseName` を残すと、「実施順は未定なのに所属コースだけ決まっている」矛盾が生じる。同一トランザクションで両方クリアする。

---

# 作業の進め方

このプロジェクトは大会本番で使うため、**実装者が内容を説明できる状態を保つこと**が優先される。

## エージェントがコードを書くときの条件

エージェントがファイルを編集してよい。ただし次の3つを必ず守る。

1. **実装前に実装内容をチャットに示し、実装者の確認を待つ。** 何をどう変えるか、なぜその設計にするかを説明してから着手する
2. **処理ごとに簡潔なコメントを付ける。** 実装者が読んで理解できる状態にする。とくに「なぜそうしたか」が読み取れないコードにはコメントを残す
3. **実装者から指示を受けるまで、勝手に実装しない。** 説明して確認を取っただけでは着手しない。「実装して」「着手して」といった指示を待つ

この3つは、**実装者が内容を説明できる状態を保つ**ためにある。本番の進行卓で想定外のことが起きたとき、中身を説明できないと対処できない。コードが早く手に入っても、理解が伴わなければ意味がない。

### 例外：バックエンド側の処理に関わらない編集

データの操作など、バックエンド側の処理に関わらないコードの編集（見た目・レイアウト・配色などのUI変更で、`app/api/` ・`server/` ・`lib/` ・`prisma/` やDB・Socketの送受信ロジックに触れないもの）は、1と3（事前説明・着手指示待ち）を省略してよい。確認を取らずに直接編集してよい。

ただし2（処理ごとのコメント）と、実装後の `npx tsc --noEmit` / `npm run lint` の確認は引き続き行う。DBの読み書き・Socketイベント・採点ロジックなど、バックエンド側の処理に少しでも関わる変更は、これまで通り1・3を守る。

補足として、次も守る。

- **一度に出す量を絞る。** 1ファイルの1箇所ずつが基本。まとめて出さない
- **コードを書く前に、必ず該当箇所を読む。** 記憶で書かない
- 実装後は `npx tsc --noEmit` と `npm run lint` の結果を確認してから次へ進む。実装者がまとめて実行したい場合はその指示に従う

### 実装者が自分で書く場合

実装者から「チャットに提示してほしい」と指示があった場合は、編集せずに変更内容を提示する。そのときは次を守る。

- **どのファイルのどこに入れるかを明示する。** 前後の既存コードを添えて、挿入位置が一意に決まるようにする
- **書き写す前に、何をするコードなのかを説明する。** 説明を読んで納得してから写せる順序にする
- 画面のマークアップ（JSX、Tailwind のクラス）は分量が多く写経の価値が薄いので、指示があればエージェントが直接書いてよい。その場合、マークアップが参照する関数を先に入れる（**ロジック → マークアップ**の順。逆だと `tsc` が落ちる）

## その他の約束

0. **Admin 画面の説明文・ボタン文言は短く、ラウンド間で揃える（2026-10-10 ユーザー指示）。** 同じ機能には同じ文言を使う（例: 「手動操作」「Undo」「残り時間を手動で変更」「この時間にする」「キャンセル」、待ち状態は「〜中...」、1本道ボタンは「〜 ▶」）。新しい文言を足す前に、他ラウンドの Admin に同じ機能の文言がないか確認する
1. **1工程ずつ区切る。** 複数の機能をまとめて実装しない
2. **各コミットが単体でビルドが通る状態にする。** 「意味のまとまり」よりこちらを優先する
3. 初出の文法・ライブラリの書き方には、コードにコメントで説明を残す

## 検証について

ロジックを別ファイルに書き写してテストしても、**実ファイルが写しと違う場合は検出できない**。ロジックの検算は補助にとどめ、次を併用する。

- `Grep` で実コードの不変条件を確認する（イベント名の対応、参照の漏れなど）
- データの流れを変えたら、生産者と消費者を列挙して突き合わせる
- `npx tsc --noEmit` の結果をユーザーに確認してもらう
