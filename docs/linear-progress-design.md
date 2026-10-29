# 1st Round → Final 一本道の進行 設計メモ

v1.0 の未実装「1st Round から Final までが一本道である前提を考慮した動線設計」の計画。作業ブランチ `feature/linear-progress`（`feature/question-display` から作成）。
2026-10-22 ユーザー承認済み・実装済み（7章）。**6章の決定事項が 2〜4章より優先**。

## 1. 前提

大会は 1st Round → 2nd Round → 3rd Round → Extra Round → Semi-Final → Final の順に **不可逆に** 進む。
あるラウンドの結果は、その後のすべてのラウンドの出場者を決める（2nd の勝ち抜け → 3rd の出場者、3rd の敗退者 → Extra の対象、…）。
したがって **あるラウンドの結果を戻したら、その後のラウンドの結果はすべて無効** になる。

## 2. リセットの連鎖（★DB の変更）

### 2.1 共通の部品 `lib/roundReset.ts`（新規）

「あるラウンドより後のラウンドを全部初期化する」処理を1か所にまとめ、各リセットの API が同じトランザクションの中で呼ぶ。

| ラウンド | 初期化する選手の列 | 一緒に消すもの |
|---|---|---|
| 3rd Round | 所属コース・正解数・誤答数・up-down ポイント・Swedish の×・Freeze の休み・勝ち抜け順位 | 4コースの抽選結果（playOrder）・3rd Round の Undo 履歴 |
| Extra Round | Second Step 進出・正解数・敗者復活 | Extra Round の Undo 履歴 |
| Semi-Final | ポイント・勝ち抜け／敗退 | Semi-Final の Undo 履歴 |
| Final | 正解数・誤答数・獲得セット数・最終順位 | Final の Undo 履歴 |

**消さないもの**: 選手名簿・1st Round 順位、Extra Round の問題（20問）、二つ名と写真、大会共通の問題データ（入力データであってスコアではないため）。

### 2.2 各リセットの範囲

| 操作（Admin） | そのラウンドで戻すもの | その後のラウンド |
|---|---|---|
| 1st Round: 選手 CSV の取り込み | 全選手を作り直す（現状どおり） | すべて（現状どおり）＋ **全ラウンドの進行状態・タイマー**（現状は 3rd Round だけ） |
| 2nd Round: 組のリセット | その組のポイント（アドバンテージに戻す）・誤答・勝ち抜け／敗退・**その組の Undo 履歴**（現状は残っている） | 3rd Round 以降すべて |
| 3rd Round: 抽選のリセット | 抽選結果・全員の所属コース・**3rd Round のスコアと履歴**（現状はスコアが残る） | Extra Round 以降すべて |
| 3rd Round: 出場者確定の取り消し（コースごと） | そのコースの所属・**そのコースのスコアと履歴** | Extra Round 以降すべて |
| 3rd Round: コースのリセット | そのコースのスコアと履歴（現状どおり） | Extra Round 以降すべて |
| Extra Round: 結果のリセット／進出者の選び直し | Extra Round 全体（現状どおり） | Semi-Final 以降すべて |
| Semi-Final: 結果のリセット | Semi-Final 全体（現状どおり） | Final |
| Final: 結果のリセット（**新設**） | Final 全体 | — |

### 2.3 サーバの進行状態（メモリ）

DB を戻したラウンドは、進行状態とタイマーも最初に戻す（現状は 3rd Round・Semi-Final だけ個別のイベントがある）。
新しいイベント `reset_round_progress { from }` を1つ作り、各ハンドラが「自分のラウンドが from 以降なら初期化」する。

| ラウンド | 戻し先 |
|---|---|
| 2nd Round | 1組目・ターンオーバー（組のリセットでは使わない。CSV 取り込み時のみ） |
| 3rd Round | コース選択・エントリー中・1コース目、タイマー 15:00 |
| Extra Round | 問題取込（setup）。登録済みの問題は「登録済みの問題を使う」で再開できる |
| Semi-Final | 準備（standby）・第1セット・タイマー 5:00（二つ名・写真は残る） |
| Final | 待機（standby）・第1セット |
| 問題表示 | そのラウンド以降の「次に読む番号」を未設定に戻し、表示中の問題を消す |

### 2.4 確認ダイアログ

リセットの確認に **影響する範囲** を書く（例:「2組目の結果をリセットします。3rd Round 以降の結果（抽選・所属コース・スコア）もすべてリセットされます。」）。
後のラウンドにデータがあるときだけ、その旨を足す（無いときは今の文面のまま）。

## 3. 次のラウンドに進めない状態では進めない（UI）

### 3.1 ラウンドの完了条件 `lib/roundProgress.ts`（新規・純関数）

| ラウンド | 完了の条件（選手データから判定） |
|---|---|
| 1st Round | 選手が登録されている |
| 2nd Round | 4組すべてで 5名ずつ（計20名）勝ち抜けが決まっている |
| 3rd Round | 4コースすべてで 2名ずつ（計8名）勝ち抜けが決まっている |
| Extra Round | 敗者復活者（1名）が決まっている |
| Semi-Final | 3名の勝ち抜けが決まっている（第3セットの判定まで終わっている） |
| Final | 最終順位が決まっている |

### 3.2 Admin のサイドバー（SELECT ROUND）

- 前のラウンドが完了していないラウンドは **押せない**（鍵の印と、理由を小さく表示。例:「2nd Round 勝ち抜け 12 / 20名」）
- 各ラウンドに状態の印: 完了（✓）／進行中／未開始
- 待機画面・1st Round はいつでも押せる

## 4. 追加の提案（一本道の前提に関するもの。許可を得たものだけ実装）

| # | 内容 |
|---|---|
| A | **「次のラウンドへ ▶」ボタン**: ラウンドが完了したら、各ラウンドの Admin の1本道ボタンの位置に出す（準決勝の「FINAL へ」と同じ形）。サイドバーを使わなくても順に進める |
| B | **前のラウンドの Undo を止める**: 後のラウンドが始まったら（後のラウンドに結果が1件でも入ったら）、前のラウンドの Undo を押せなくする。Undo は「結果を少し戻す」ので、後のラウンドと食い違う。戻したいときはリセット（2章の連鎖つき）を使う |
| C | **API でも順番を守る**: 前のラウンドが完了していないときは、そのラウンドの採点・抽選・進出者確定の API を受け付けない（409）。画面を経由しない操作や古い画面からの操作でも、順番が崩れない |
| D | **後戻りの確認**: 後のラウンドに結果があるときに、サイドバーで前のラウンドへ戻ろうとしたら確認を出す（Main も切り替わるため） |
| E | **進行中のラウンドを DB から示す**: サーバ再起動でモードが待機画面に戻ったとき、Admin に「DB の結果では 3rd Round が進行中です」と出し、そのラウンドへ1クリックで戻れるようにする |

## 5. 影響するファイル（予定）

- 新規: `lib/roundReset.ts`、`lib/roundProgress.ts`、`app/api/final/reset/route.ts`
- API: `app/api/firstRound`、`secondRound/resetScores`、`thirdRound/draw`（DELETE）、`thirdRound/assignCourse`（DELETE）、`thirdRound/resetScores`、`extraRound/reset`、`extraRound/secondStepEntrants`、`semifinal/reset`
- サーバ: `ModeHandler.js`・`ThirdRoundHandler.js`・`ExtraRoundHandler.js`・`SemifinalHandler.js`・`FinalHandler.js`・`QuestionHandler.js`（`reset_round_progress`）
- 画面: `app/admin/page.tsx`（サイドバー）、各ラウンドの Admin（確認文・リセット後のイベント送信、提案 A・B）

## 6. 決定事項（2026-10-22 ユーザー回答）— 2〜4章より優先

1. **リセットの連鎖**: 2章のとおり。ラウンドの一部（組・コース）をリセットしたときも、**後のラウンドは出場者全員ぶんを丸ごと戻す**（ユースケースと長所・短所を比べたうえでのユーザー選択）。
   そのラウンドで戻すのは、表示されている組・コースの選手だけ。
2. **二つ名と写真**: Semi-Final の進出者が決まる前のフェーズ（選手 CSV・2nd Round・3rd Round・Extra Round）でリセットしたときは、Semi-Final 出場者の二つ名と写真も削除する。Semi-Final のリセット以降は削除しない。
3. **敗者復活者なし**: Extra Round First Step で全員が脱落した場合に備え、Admin の操作で「敗者復活者なし」を確定できるようにし、確定したら Semi-Final に進める（8名で実施）。
   確定は DB に保存する（大会の状態の表 `TournamentState` を追加。★マイグレーション）。Extra Round 以前のリセットで一緒に消す。
4. **提案A**: ラウンドが完了したら、各 Admin の大ボタンの位置に **具体的なラウンド名** のボタン（「3rd Round へ ▶」など）を出す。
5. **提案B**: 後のラウンドが始まっていたら、前のラウンドの Undo を押しても **警告を出して実行しない**（修正はリセットで行う）。
6. **提案C**: 採用。前のラウンドが完了していなければ、そのラウンドの採点・抽選・進出者確定の API が受け付けない（409）。
7. **提案D**: D-1 を採用。後のラウンドに結果があるときに、サイドバーで前のラウンドを押したら「Main もそのラウンドの画面に戻ります」と確認を出す。
8. **提案E**: 採用。サーバ再起動で待機画面に戻ったとき、DB で進行中のラウンドを示し、1クリックで戻れるようにする。

## 7. 実装（2026-10-22）

### 7.1 DB（★マイグレーション `20261022130000_add_tournament_state`）

- `TournamentState`（1行。`id = 1`）: `extraRoundNoRevival`（Extra Round の「敗者復活者なし」を確定したか）
- Mac で `npx prisma migrate dev` を実行してサーバを再起動するまで、表は使えない。その間も採点などの API は止まらない（`loadTournamentState` が初期値を返す）。「敗者復活者なし」の確定だけが 503 で、やることを書いたメッセージを返す

### 7.2 部品

| ファイル | 役割 |
|---|---|
| `lib/roundProgress.ts` | 各ラウンドの「始まっているか」「完了したか」の判定（純関数）、確認文・警告文 |
| `lib/roundReset.ts` | `resetRoundsFrom(tx, from, { clearProfiles })`: from 以降のラウンドを出場者全員ぶん初期化（API 専用） |
| `lib/roundGuard.ts` | `guardRound`（前のラウンドが未完了なら 409）・`guardUndo`（後のラウンドが始まっていれば 409） |
| `server/roundOrder.js` | `reset_round_progress { from }` の対象判定 |
| `app/components/Admin/roundProgressContext.tsx` | Admin 全体で共有する状況（`useRoundProgress`）、「○○へ ▶」・Undo の制限・確認文・リセット後の配信 |
| `app/components/Admin/AdminRoundNav.tsx` | サイドバー（鍵・状態の印・戻るときの確認）と、待機画面の「RESUME」案内 |

### 7.3 各リセットの API（同じトランザクションの中で連鎖する）

| API | そのラウンドで戻すもの | 連鎖（`resetRoundsFrom`） | 二つ名・写真 | Admin が送る `reset_round_progress` |
|---|---|---|---|---|
| `POST /api/firstRound`（選手 CSV） | 全選手を作り直す・全履歴・抽選結果・大会の状態 | — | 消える（選手ごと） | `all` |
| `POST /api/secondRound/resetScores` | その組のポイント・誤答・順位・**その組の履歴** | thirdRound | 消す | `thirdRound` |
| `DELETE /api/thirdRound/draw` | — | thirdRound（抽選・全員の所属・スコア・履歴） | 消す | `thirdRound` |
| `DELETE /api/thirdRound/assignCourse` | そのコースの所属・スコア・履歴 | extraRound | 消す | `extraRound` |
| `POST /api/thirdRound/resetScores` | そのコースのスコア・履歴 | extraRound | 消す | `extraRound` |
| `POST /api/extraRound/reset` | — | extraRound（敗者復活者なしも） | 消す | `extraRound`（Extra は問題取込へ） |
| `POST /api/extraRound/secondStepEntrants`（選び直し） | — | extraRound（結果・敗者復活者なし・後のラウンドがあるときだけ。確認つき） | 消す | `semifinal`（Extra はそのまま Second Step へ） |
| `POST /api/semifinal/reset` | — | semifinal | 残す | `semifinal` |
| `POST /api/final/reset`（新設） | — | final | 残す | `final` |

選手 CSV の取り込みは、2026-10-22 から「履歴・抽選結果」に加えて「2nd Round 以降の結果・二つ名・写真」が残っているときも確認を求める。

### 7.4 順番チェック（提案C）と Undo の制限（提案B）

- `guardRound`: 2nd Round の採点、3rd Round の抽選・出場者確定・採点、Extra Round の進出者確定・Second Step の採点・敗者復活者なし、Semi-Final の採点、Final の採点
- `guardUndo`: 2nd・3rd・Extra（Second Step）・Semi-Final の Undo。画面でも押した時点で警告を出す（`blockUndoIfLaterStarted`）

### 7.5 敗者復活者なし

- `POST /api/extraRound/noRevival { value }`。確定は「3rd Round 完了・敗者復活者なし・Second Step 出場者なし」のときだけ。取り消しは Semi-Final 開始前だけ
- Admin: 進出者選択の段階で「敗者復活者なしで確定」（副ボタン）。確定後は大ボタンが「Semi-Final へ ▶」。取り消しは手動操作のデータ操作
- Semi-Final は 3rd Round 通過の8名（5番席が空席）。ルールの判定はそのまま（第3セットは2名から勝ち抜け1名・失格1名）

### 7.6 Socket

- `reset_round_progress { from }`: 各ハンドラが自分のラウンドが from 以降なら初期化（2.3 の表）。Semi-Final は、自身のリセットなら従来どおり（準備・紹介・カード表示の途中なら表示はそのまま、それ以外は第1セットのクイズ画面）、それより前からなら準備（standby）・紹介1人目に戻し、`update_semifinal_profiles` も送る。旧 `reset_third_round_progress`・`reset_semifinal_progress` はこれに置き換えた
- `tournament_state_changed` → `update_tournament_state`（中身は送らず、各 Admin が `/api/tournamentState` を読み直す）
- 2026-10-22: `AdminSecondRound` がイベント名だけで `socket.off` していたのを、自分の受け取り口だけ外すように直した（admin/page.tsx の受け取り口まで外れていたため）
