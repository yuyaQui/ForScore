# 問題表示機能 設計メモ

作業ブランチ: `feature/question-display`（`develop` から作成。2026-10-21）

v1.0 の未実装「敗者復活 1st Step 以外の問題表示機能」を実装するための計画。2026-10-22 にユーザー承認済み（5.2）。

**実装状況（2026-10-22）**: 6章の 1〜3・5 を実装済み（Main の共通の枠は `app/components/Main/RoundStage.tsx`。寸法は 5.1 の見積もりどおり、見出し 108px → 問題欄 140px → 仕切り線 → 本体の箱 1776×710px。本体は箱に収まる倍率で縮める: 2nd Round 12名は横幅で約 0.81、3rd Round は高さで約 0.83、Final は約 0.89）。表示例は Design アーティファクトの「【開発中】問題表示」区画。

---

## 1. 目的と範囲

### 1.1 目的

早押しクイズの1問が終わる（正解・誤答・スルー）たびに、その問題の **問題文と解答** を Main に表示できるようにする。
問題は大会共通の「問題群」から **通し番号** で引く（2026-10-10 ユーザー決定。`lib/questionPool.ts`）。

### 1.2 対象ラウンド

| ラウンド | 対象 | 理由 |
|---|---|---|
| 2nd Round | ○ | 早押し。1問ごとに表示 |
| 3rd Round（4コース） | ○ | 同上。コースが変わっても通し番号は続きから |
| Extra Round Second Step | ○ | 同上 |
| Final | ○ | 同上 |
| Extra Round First Step | × | 実装済み（専用の20問 `ExtraRoundQuestion`。今回は変えない） |
| 準決勝 | × | ルール上タイムレース中は問題のフォローをしない。セット後の「問題の振り返り」が実装済み（通し番号の範囲で表示） |

ルール上の根拠: 1問は「正解・誤答・スルー」のいずれかで終わる（`abc the24th ルール` 細則）。誤答でもその問題は終わる（他の人に解答権は移らない）。

---

## 2. 全体像

```
[Admin] 問題データ取込（CSV）──POST /api/questionPool──▶ [DB] QuestionPoolItem（通し番号・問題文・解答・別解）
                                                              ▲
[Admin] 各ラウンドの採点（正解／誤答／スルー）                   │ GET /api/questions?from=N&to=N(&public=1)
   └─ 採点が成功したら emit('finish_question')                  │
                         ▼                                    │
[Server] QuestionHandler（メモリ）: いまの通し番号・表示段階 ──update_question_display──▶ [Main] 問題表示の部品
                                                                                     （番号が変わったら問題を取得して表示）
```

- **DB** に持つのは「問題データ」だけ（大会前にまとめて取り込む）
- **どの問題を出しているか・表示中か** はサーバのメモリ（他の進行状態と同じ割り切り。再起動で消えたら Admin で番号を合わせ直す）
- 採点の API（スコア計算）は **変えない**。採点が成功したあとに Admin が別のイベントを送るだけにする

---

## 3. バックエンド

### 3.1 DB: 問題データの表を追加（★マイグレーション）

```prisma
// 大会共通の問題群（2nd Round 以降で使う。通し番号で指定する）
model QuestionPoolItem {
  serial    Int    @id          // 通し番号（1〜）
  text      String              // 問題文
  answer    String              // 解答
  altAnswer String @default("") // 別解・正誤判定基準（空でもよい）
}
```

- マイグレーション名の例: `20261021xxxxxx_add_question_pool`（`npx prisma migrate dev`。適用は Mac で）
- 選手データとは関係を持たない（独立した表）。大会後のデータ削除の対象に含める

### 3.2 API

| API | 内容 |
|---|---|
| `POST /api/questionPool`（新規） | `{ csvText }` を受け取り、`parseQuestionPoolCsv`（既存）で検証。エラーがあれば 400 で全エラー行を返し、何も変えない。正しければ **全件入れ替え**（`deleteMany` → `createMany` を1つのトランザクションで）。すでに登録があるときは確認（409 → `confirmReplace: true`）。返り値: 登録件数・最小／最大の通し番号 |
| `GET /api/questionPool`（新規） | 登録状況（件数・最小／最大の通し番号・欠番の有無）。Admin の取込画面と各ラウンドの「開始番号」入力の確認用 |
| `GET /api/questions?from&to(&public=1)`（既存を変更） | 読み込み元を `test_questions.csv` から DB に差し替える。範囲の検証（`selectQuestionRange`）・Main 用に別解を除く処理はそのまま。準決勝の振り返りもこの API なので、自動的に DB を使うようになる |

- 検証用の `test_questions.csv` は、取込画面で読み込ませるサンプルとして残す（API からは読まない）

### 3.3 Socket: 問題表示の進行（★新しいハンドラ `server/QuestionHandler.js`）

**状態（メモリ）**

```js
questionDisplay = {
  round: "secondRound" | "thirdRound" | "extraSecondStep" | "final" | null, // どのラウンドの問題か
  serial: number | null,   // いま表示対象の通し番号（null = まだ開始番号を決めていない）
  stage: "hidden" | "shown", // Main に出しているか
  seq: number              // 表示を切り替えた回数（Main のアニメーション用。増えた瞬間だけ演出）
}
cursors = { secondRound: 15, thirdRound: 42, ... } // ラウンドごとの「次に読む通し番号」
```

**イベント**

| 方向 | イベント | 内容 |
|---|---|---|
| Admin → サーバ | `set_question_cursor` `{ round, serial }` | ラウンドの開始番号（次に読む番号）を設定・修正する |
| Admin → サーバ | `finish_question` `{ round, serial }` | 採点（正解・誤答・スルー）が成功した。`serial` がそのラウンドの次に読む番号と一致するときだけ受け付け、表示対象を `serial` にして番号を1つ進める（古い画面・二重送信で2問進まないように） |
| Admin → サーバ | `change_question_display` `{ stage }` | 表示する／隠す（手動） |
| Admin → サーバ | `request_question_sync` | 開いた画面に現在の状態を返す（他ラウンドと同じ） |
| サーバ → 全員 | `update_question_display` | 上の状態 |

- 値はすべてサーバで検証する（未知の `round`、整数でない番号は無視）
- **Undo との関係**: 採点の Undo を押したとき、問題の番号は自動では戻さない（スルーは DB に記録が無いラウンドもあり、戻す量を正しく決められないため）。Admin の問題パネルの「◀ 前の問題」で手動で合わせる

---

## 4. フロントエンド

### 4.1 Admin

**(a) 問題データの取込（新規パネル）**

- 置き場所: 待機画面（`waiting` モード）の Admin。大会前に一度だけ使う想定
- CSV を選ぶ → プレビュー（件数・通し番号の範囲・エラー行）→「登録」。Extra Round の問題取込（`AdminExtraRoundUpload`）と同じ形
- 登録済みなら件数と範囲を表示。入れ替えるときは確認ダイアログ

**(b) 問題パネル（新規の共通部品 `AdminQuestionPanel.tsx`）** — 2nd / 3rd / Extra Second Step / Final の各 Admin に置く

- 「次に読む問題」: 通し番号・問題文・解答・別解（Admin だけ）。司会・スタッフが確認できる
- 「Main に表示中の問題」: 直前に終わった問題
- 操作: 開始番号の入力、「◀ 前の問題」「次の問題 ▶」（番号の手動修正）、「表示する／隠す」
- 番号が問題データに無いとき（範囲外・欠番）は警告を出す

**(c) 採点との連動**

- 各ラウンドの採点が API で成功したら、Admin が `finish_question` を送る（スコアの API は変えない）
- **スルー** ボタン: 3rd Round にはある（API あり）。2nd Round・Extra Second Step・Final には無いので、**問題を1つ進めるだけ**のスルーボタンを足す（DB は変えない）
- 対象: 正解・誤答・スルー。勝ち抜け処理・セット切り替えなど問題に関係しない操作では送らない

### 4.2 Main

**(a) 問題表示の部品（新規 `QuestionOverlay.tsx`）**

- `update_question_display` を受けて、`serial` が変わったら `GET /api/questions?from=N&to=N&public=1` で問題を取得して表示
- 現れ方は Extra Round First Step と同じ `RevealWhole`（ぼかし＋せり上がり）。`seq` が増えた瞬間だけ演出し、途中で開いた・リロードした Main は即表示（実装済みの方針と同じ）
- 表示内容: 問題文・解答（通し番号・別解は出さない。5章）

**(b) 各ラウンドの画面への組み込み** — 置き方は5章

- 2nd / 3rd Round・Extra Second Step はカード（高さ 694px）で画面の縦がほぼ埋まっており、Final もカード＋正解数でほぼ埋まっている。問題を出すには、カードの一部を隠すか縮める必要がある
- 置き方が決まったら、各ラウンドの Main に部品を組み込み、Design アーティファクトに表示例を作ってから実装を確定する（これまでと同じ進め方）

---

## 5. 決定事項と残りの確認（2026-10-22）

### 5.1 Main での見せ方（ユーザー指示）

- 問題は **見出し下の仕切り線（横棒）の上側** に表示する
- それに合わせて、仕切り線の位置と選手カードの位置を **全ラウンドで一貫したレイアウト** にそろえる
- 問題文は **100文字で2行分**、解答は **1行分** のスペースを常に確保する（問題が無いときも空けておき、表示の有無でカードが動かないようにする）

#### 寸法の見積もり（1920×1080、上下の余白 56px）

- 使える高さ 968px のうち、カード（694px）＋カード下の数字（86px）＝ 780px。残りは 188px
- 見出し（ラウンド名 40px＋副題 50px）を左、問題を右に並べ、同じ段に収める。問題の欄の幅は約 1,300px
  - 問題文: 1行50文字 × 2行 → 1文字 26px 前後（行の高さ 36px × 2）
  - 解答: 1行（34px 前後）
  - 合計 約 120〜130px → 見出しの段の高さ（現在 約 100px）を 130px 前後に広げる
- 足りない分は、カード下の余白・仕切り線の上下の余白を詰め、それでも足りなければカードの高さをラウンド共通で少し縮める
- Final はカード（574px）＋正解数・誤答（約 160px）で、他ラウンドと高さが違う。仕切り線とカード上端の位置だけを他ラウンドとそろえる
- 正確な寸法は Design アーティファクトで全ラウンドを並べて確認してから決める

### 5.2 そのほかの決定事項（2026-10-22 ユーザー回答）

- **表示のタイミング**: 採点（正解・誤答・スルー）したら自動で表示する。Admin の「隠す」で消せる
- **通し番号**: Main には出さない（Admin の問題パネルには出す）
- **別解・正誤判定基準**: Main には出さない（準決勝の振り返りと同じ。Admin の問題パネルには出す）
- 本メモのプラン（★の DB・API・Socket の変更を含む）で実装を進めることを承認済み

## 6. 実装の順番（承認後）

1. DB（`QuestionPoolItem`）＋ `POST/GET /api/questionPool` ＋ `GET /api/questions` の差し替え ＋ 取込パネル
2. `server/QuestionHandler.js` ＋ Admin の問題パネル（表示なしで、番号が正しく進むことを確認）
3. 各ラウンドの採点との連動（`finish_question`・スルーボタン）
4. Design アーティファクトで全ラウンドの一貫したレイアウト（仕切り線の上に問題欄）を作る → 確認
5. Main の問題表示を各ラウンドに組み込む
6. 型チェック・lint、模擬環境で各ラウンドを通して確認、設計メモ・AGENTS.md の更新

## 7. 影響するファイル（予定）

| 区分 | ファイル |
|---|---|
| DB | `prisma/schema.prisma`、新しいマイグレーション |
| API | `app/api/questionPool/route.ts`（新規）、`app/api/questions/route.ts` |
| サーバ | `server/QuestionHandler.js`（新規）、`server.js`（ハンドラの登録） |
| 共通 | `lib/types.ts`（`QuestionDisplayState`）、`lib/questionPool.ts`（コメントの更新のみ） |
| Admin | `AdminQuestionPanel.tsx`・問題取込パネル（新規）、`AdminText.tsx`、`AdminSecondRound.tsx`、`AdminThirdRound.tsx`、`AdminExtraRoundSecondStep.tsx`、`AdminFinal.tsx` |
| Main | `QuestionOverlay.tsx`（新規）、`MainSecondRound.tsx`、`MainThirdRound.tsx`、`MainExtraRound.tsx`、`MainFinal.tsx` |

## 8. Undo で問題も戻す（2026-10-29 ユーザー承認・案A）

- サーバ（`server/QuestionHandler.js`）が、ラウンドごとに「操作の記録」をメモリに積む（1ラウンド200件まで。再起動で消える）
  - `finish_question { round, serial, scope, scored }`: 問題を受け付けたら `scored`（得点の Undo 履歴あり）または `through`（スルー）を積む。問題を受け付けなかったが得点は動いたときは `other`
  - `record_question_event { round, scope }`: 問題と関係しない得点の操作（3rd Round のコース終了、Final の次のセットへ）。`other`
  - `scope` は組・コース（2nd Round は `g1`〜`g4`、3rd Round はコース名、Extra は `secondStep`、Final は `final`）
- 配信する状態に `lastEvents`（ラウンドごとの記録の最後の種類と scope）を足した
- Admin の Undo（`useQuestionDisplay().undoWithQuestion`）は記録の最後を見る
  - `through` … 確認のうえ問題だけ戻す（得点の Undo API は呼ばない）
  - `scored` … 得点の Undo が成功したら問題も戻す ／ `other` … 得点の Undo が成功したら記録を1つ消す
  - 記録が無い・scope が違う … 得点の Undo だけ（従来どおり）
- `undo_question_event { round, scope, kind }`: 記録の最後と一致するときだけ受け付ける（二重送信・複数の Admin で二重に戻らない）。問題を戻すと「次に読む問題」がその問題になり、Main は1つ前に表示していた問題（無ければ空）に戻る
- 手動で番号を動かす（`set_question_cursor`）と、そのラウンドの記録は消える。一本道のリセットでも消える
- 3rd Round・Final の採点 API は、Undo の履歴を積んだか（`historyAdded`）を返す（何も変わらない操作は履歴を積まないため、記録と手数をそろえる）
