<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# kqk-abc — クイズ大会の得点表示システム

高校生クイズ大会「abc」の進行と得点をリアルタイム表示するアプリ。進行者が `/admin` を操作し、会場スクリーンに `/main` を投影する。

ルールの出典は `abc the24th ルール` (PDF)。3rd Round の設計は `docs/3rd-round-design.md` にまとめてある。**3rd Round の作業に入る前に必ず読むこと。**

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
| 3rd Round | コース選択フェーズまで完成。クイズ実施は未着手 |
| Extra Round / 準決勝 / 決勝 | 未着手 |

デザインの作り込みは全機能の実装後にまとめて行う方針。

## 次にやること

```
工程0   lint をゼロにする  ← ここから
工程7-1 15分タイマー（サーバ側、開始/停止/リセット、Main 表示）
工程7-2 スコア更新の土台（正誤ボタン、Undo、コース共通部分）
工程7-3 10 up-down
工程7-4 10 by 10
工程7-5 Swedish 10
工程7-6 Freeze 10
工程8   判定基準と同着検出、早押しプレーオフ
工程9   通過順位と準決勝の席順
工程6   ルーレット演出（デザインフェーズに回してよい）
```

各コースのルールと判定基準は `docs/3rd-round-design.md` の3章にある。

### 工程0: lint をゼロにする

`npm run lint` は**まだ一度も通っていない**（30件）。このままでは「lint が通るか」を変更の妥当性の目安に使えないため、先に一度ゼロにする。

クイズ実施フェーズの前にやる理由は、**共有の `Player` 型を先に用意したいから**。これから4コース分の選手状態を操作するコードを書くので、`any[]` のまま書いてから型を入れるより、型がある状態で書いた方が誤りを型検査で捕まえられる。

内容は4つ。

1. **`Player` 型を定義する**（`no-explicit-any` 13件）
   コンポーネントが `players: any[]` で受けている。Prisma の生成型を使うか、`lib/` に共有型を置く
2. **eslint の対象範囲を直す**（`no-require-imports` のうち `server/` 分 11件）
   `server.js` と `server/*.js` は意図的に CommonJS で書いている。`eslint.config.mjs` に override を足して、これらに TS 向けルールを当てない。**コードを直すのではなく設定を直す**
3. **`constants.js` の読み込み方を直す**（残り2件）
   `AdminFirstRound.tsx` と `MainFirstRound.tsx` が TSX の中で `require()` している。`import` に置き換える
4. **`setSocket` を effect 内で呼んでいる件**（`react-hooks/set-state-in-effect` 2件）
   `app/admin/page.tsx` と `app/main/page.tsx`。Socket.IO + React の定番パターンだが React 19 世代のルールが禁止している。`useState` を `useRef` に変える改修になり、`socket` は各コンポーネントへ props で渡り依存配列にも入っているため**影響範囲が広い**。工程0の最後に分けて扱い、大きすぎる場合は `eslint-disable` で保留してよい

`exhaustive-deps` の警告2件（`setPlayers` が依存配列にない）も一緒に片付ける。

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
| `broadcast_scores` | `Player[]` | `server.js` |
| `broadcast_third_round_courses` | `ThirdRoundCourse[]` | `ThirdRoundHandler` |
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

1. **実装前に内容を説明し、確認を取ってから着手する。** 差分の概要ではなく、なぜその設計にするかまで説明する
2. **1工程ずつ区切る。** 複数の機能をまとめて実装しない
3. **ファイルを編集する前に、必ず該当箇所を読む。** 記憶で書かない
4. **各工程の後に `npx tsc --noEmit` の結果を確認する。** ユーザーが実行するので、それを待ってから次へ進む
5. **各コミットが単体でビルドが通る状態にする。** 「意味のまとまり」よりこちらを優先する
6. 初出の文法・ライブラリの書き方には、コードにコメントで説明を残す

## 検証について

ロジックを別ファイルに書き写してテストしても、**実ファイルが写しと違う場合は検出できない**。ロジックの検算は補助にとどめ、次を併用する。

- `Grep` で実コードの不変条件を確認する（イベント名の対応、参照の漏れなど）
- データの流れを変えたら、生産者と消費者を列挙して突き合わせる
- `npx tsc --noEmit` の結果をユーザーに確認してもらう
