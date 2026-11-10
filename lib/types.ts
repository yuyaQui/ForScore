/**
 * アプリ全体で共有する型の置き場。
 *
 * Prisma の生成型はここから再エクスポートし、app/ 配下は @prisma/client を
 * 直接 import しない。import に type を書き忘れると DB クライアント本体を
 * ブラウザ側へ読み込むことになるため、その参照を1箇所に閉じている。
 */

// schema.prisma から Prisma が生成した型。
// Player は全列が Int / String / Boolean で DateTime を持たないため、
// API のレスポンス（JSON）を経由しても型がずれない。
// DateTime 列を足すと JSON では string になり、ここでの再定義が必要になる。
export type { Player, ThirdRoundCourse } from '@prisma/client';

// Extra Round の問題。別解・正誤判定基準（altAnswer）はマイグレーション
// 20261006120000_add_extra_round_question_alt_answer で追加した列。Prisma クライアントを
// 再生成する（npx prisma generate / migrate dev）までは生成型に載らないため、列の存在を
// ここで明示している。再生成後は生成型と同じ内容になるだけで、害はない。
import type { ExtraRoundQuestion as PrismaExtraRoundQuestion } from '@prisma/client';
import type { SemifinalPlayoff } from './semifinalPlayoff';
export type ExtraRoundQuestion = PrismaExtraRoundQuestion & { altAnswer: string };

/**
 * 2nd Round の進行状態。
 * server/ModeHandler.js がメモリに保持し、update_second_round_state で配信する。
 */
export type SecondRoundState = {
    /** 何組目か（1〜4） */
    group: number;
    /**
     * turnOver = ターンオーバー（選手紹介）、quiz = 正誤判定、
     * runnerUp = 次点（ペーパー49位）の発表（2026-10-30 追加。4組目の後。順位だけ／展開は turnOverPhase）
     */
    view: 'turnOver' | 'quiz' | 'runnerUp';
    /**
     * turnOver 画面の発表ステップ（0〜3）。0=1位のみ、1=2・3位、2=4〜6位、3=7〜12位。
     * group を切り替えたとき、または view を turnOver に切り替えたときは 0 にリセットする。
     */
    turnOverStep: number;
    /** そのステップの順位帯を公開済みか。collapsed=順位のみ、expanded=氏名まで公開（次点の発表でも使う） */
    turnOverPhase: 'collapsed' | 'expanded';
    /**
     * 4組目の最終ステップ（7〜12位）でだけ意味を持つフラグ。48位（そのステップの
     * 最後の1人）を、他の5人（28〜44位）より後に単独発表したいか（lib/secondRound.ts
     * の getTurnOverSecondaryIndex 参照）まで発表済みか。false=48位はまだ順位のみ、
     * true=48位も氏名まで公開。4組目の最終ステップ以外では参照されない
     * （2026-09-27、ユーザー指示）。
     */
    turnOverFinalRevealed: boolean;
};

/** SecondRoundState の初期値。4箇所（app/admin, app/main, AdminSecondRound, MainSecondRound）
 * の useState 初期値をここに集約し、フィールドを増やしたときの直し忘れを防ぐ。 */
export const DEFAULT_SECOND_ROUND_STATE: SecondRoundState = {
    group: 1,
    view: 'turnOver',
    turnOverStep: 0,
    turnOverPhase: 'collapsed',
    turnOverFinalRevealed: false,
};

/**
 * 3rd Round の15分タイマー。コースごとに1本ずつ持つ。
 * server/ThirdRoundHandler.js がメモリに保持し、update_third_round_timer で配信する。
 *
 * 「コース N が稼働中か」は runningOrder === N で導出できるため、コースごとの
 * 稼働フラグは持たない。0秒到達も「時計が止まった」だけでコースの終了ではないので、
 * 専用の状態を持たない（remainings[N] === 0 で判定できる）。
 */
export type ThirdRoundTimer = {
    /**
     * コースごとの残り秒数。キーは quizOrder(1〜4)。
     * まだ一度も動かしていないコースはキー自体が存在しない（＝制限時間のまま）。
     */
    remainings: Record<number, number>;
    /** 走っているコースの quizOrder。停止中は null */
    runningOrder: number | null;
};

/**
 * Extra Round の進行状態。
 * server/ExtraRoundHandler.js がメモリに保持し、update_extra_round_state で配信する。
 *
 * 持つのは「どの段階か（stage）」「First Step のどこまで進んだか（cursor）」
 * 「いまのステップの中身（問題文 / 解答）を Main に出したか（revealed）」の3つだけ。
 * 問題番号・出題/解答発表・フェーズ・進出者決定ボタンを出す位置は、cursor から
 * lib/extraRound.ts の関数で導出する（別々に持つと食い違うため持たない）。
 *
 * stage の流れ（Main の表示）:
 *   setup         … 問題CSVの取込（Main は「準備中」）
 *   firstStep     … 筆記クイズ。問題→解答の順に表示
 *   entrantSelect … 2nd Step 進出者の選択（Main は「準備中」）
 *   secondStep    … 進出者による早押し。勝ち抜けは準決勝5番席へ
 */
export type ExtraRoundStage = 'setup' | 'firstStep' | 'entrantSelect' | 'secondStep';

export type ExtraRoundState = {
    stage: ExtraRoundStage;
    /** First Step の進行位置 0〜39（lib/extraRound.ts の FIRST_STEP_SEQUENCE の添字） */
    cursor: number;
    /**
     * いまのステップの中身を Main に出したか。
     *   問題のステップ … 問題文（false の間、Main は問題番号と枠だけ）
     *   解答のステップ … 解答（false の間、Main は問題文だけ）
     * false → true になった瞬間だけ、Main は文字を徐々に表示するアニメーションを流す。
     * cursor / stage が変わると（明示しない限り）false に戻る。詳細は server/ExtraRoundHandler.js。
     */
    revealed: boolean;
};

/** ExtraRoundState の初期値。server/ExtraRoundHandler.js の初期値と同じ */
export const DEFAULT_EXTRA_ROUND_STATE: ExtraRoundState = {
    stage: 'setup',
    cursor: 0,
    revealed: false,
};

/**
 * 準決勝（Nine Hundred）の進行状態。
 * server/SemifinalHandler.js がメモリに保持し、update_semifinal_state で配信する。
 * 勝ち抜け・失格・ポイントは DB（Player）が持ち、ここには持たない。
 *
 * 準決勝の始まり（2026-10-15 追加。docs/semifinal-design.md 7章）:
 *   standby（準備中。Admin で写真・二つ名を登録）→ intro（進出者紹介）→ lineup（選手カード表示）→ 第1セットの quiz
 *
 * 1セットの流れ（設計メモ 6.2、2026-10-17 に 8章の流れへ変更）:
 *   quiz（クイズ中。Main はポイントを出さない。タイムアップ後に Admin で振り返る問題の番号を入力）
 *   → review（問題の振り返り。Main に問題と解答を3問ずつ）
 *   → tally（得点集計。Admin で各選手のそのセットの得点を入力。Main は得点を空欄にしたカード）
 *   → results（点数発表。announceSeq が増えた瞬間に Main でポイントバーの演出）
 *   → 勝ち抜け判定 → 敗退判定（それぞれ同点なら playoff＝サドンデス）→ 次のセットの quiz
 */
export type SemifinalView = 'standby' | 'intro' | 'lineup' | 'quiz' | 'review' | 'tally' | 'results' | 'playoff';

/**
 * 進出者紹介の段階（2026-10-15 追加）。1人につき「二つ名」→「写真・学校名・学年・名前（profile）」。
 * 二つ名が未登録の選手は nickname を飛ばして profile から始める（Admin が判断する）
 */
export type SemifinalIntroStep = 'nickname' | 'profile';

/** 振り返り範囲。from > to は上限で折り返す範囲で、そのときの最初と上限（min・max）も持つ（2026-11-11。lib/questionWrap.js） */
export type SemifinalReviewRange = { from: number; to: number; min?: number; max?: number };

export type SemifinalState = {
    /** 現在のセット 1〜3 */
    set: number;
    /** Main の表示 */
    view: SemifinalView;
    /** セットごとの振り返り範囲（通し番号）。キーはセット番号 */
    reviewRanges: Record<number, SemifinalReviewRange>;
    /** 振り返りのページ（0始まり、1ページ3問） */
    reviewPage: number;
    /** このセットの得点を入力済みか（二重入力を防ぐ） */
    pointsEntered: boolean;
    /** 点数発表の回数。増えた瞬間に Main が演出を再生する（サーバが増やす） */
    announceSeq: number;
    /** サドンデス（コード上の名前は playoff）の進行。行っていなければ null（lib/semifinalPlayoff.ts） */
    playoff: SemifinalPlayoff | null;
    /** 進出者紹介で表示中の選手（紹介順 lib/semifinalProfile.ts の getIntroOrder の何番目か。0始まり） */
    introIndex: number;
    /** 進出者紹介で表示中の段階 */
    introStep: SemifinalIntroStep;
    /** 選手カード表示を始めた回数。増えた瞬間に Main がカードを1枚ずつ出す演出を再生する（サーバが増やす） */
    lineupSeq: number;
};

/** SemifinalState の初期値。server/SemifinalHandler.js の初期値と同じ */
export const DEFAULT_SEMIFINAL_STATE: SemifinalState = {
    set: 1,
    view: 'standby',
    reviewRanges: {},
    reviewPage: 0,
    pointsEntered: false,
    announceSeq: 0,
    playoff: null,
    introIndex: 0,
    introStep: 'nickname',
    lineupSeq: 0,
};

/**
 * 準決勝の5分タイマー。セットごとに1本ずつ持つ（3rd Round の ThirdRoundTimer と同じ形）。
 */
export type SemifinalTimer = {
    /** セットごとの残り秒数。キーは set(1〜3)。一度も動かしていないセットはキー自体が存在しない */
    remainings: Record<number, number>;
    /** 走っているセット番号。停止中は null */
    runningSet: number | null;
};

/**
 * 決勝（トリプルセブン）の進行状態。
 * server/FinalHandler.js がメモリに保持し、update_final_state で配信する。
 *
 * 決勝はルール上タイマーを持たない（設計メモ 決定事項4）ため、3rd Round /
 * 準決勝の *Timer 型に相当するものはない。セットが決着したかどうかも
 * lib/finalScoring.ts の isSetOver が選手データから都度判定するため、
 * ここでは持たない。
 */
export type FinalState = {
    /** 現在のセット番号。上限は設けない（3勝先取で終わるため） */
    set: number;
    /** Main の表示（2026-10-17 追加。docs/final-design.md 8章） */
    view: FinalView;
    /** 選手紹介で表示中の選手（準決勝の勝ち抜け順の何番目か。0〜2） */
    introIndex: number;
    /** 最終成績を表示中の順位（1〜3）。表示していなければ 0 */
    resultRank: number;
};

/**
 * 決勝の Main の表示（2026-10-17 追加）。
 *   standby … 待機（何も表示しない）
 *   intro   … 選手紹介（写真・二つ名・プロフィール・それまでのラウンドの成績）。準決勝の勝ち抜け順に1人ずつ
 *   quiz    … クイズ（3名のカード）
 *   result  … 最終成績（選手紹介に Final の成績を足したもの）。優勝決定後に Admin で順位を選んで出す
 */
export type FinalView = 'standby' | 'intro' | 'quiz' | 'result';

/** サーバから届くまでの初期値（server/FinalHandler.js の初期値と同じ） */
export const DEFAULT_FINAL_STATE: FinalState = { set: 1, view: 'standby', introIndex: 0, resultRank: 0 };

/**
 * ペーパークイズ上位100名の発表の進行状態（2026-10-31 追加。項目19）。
 * server/PaperTopHandler.js がメモリに保持し、update_paper_top_state で配信する。
 */
export type PaperTopState = {
    /** 何画面目か（0始まり。lib/paperTop.ts の getPaperTopPages の何番目か） */
    page: number;
    /** collapsed = 順位だけ、expanded = 学校名・学年・名前まで公開 */
    phase: 'collapsed' | 'expanded';
};

/** サーバから届くまでの初期値（server/PaperTopHandler.js の初期値と同じ） */
export const DEFAULT_PAPER_TOP_STATE: PaperTopState = { page: 0, phase: 'collapsed' };

/**
 * 問題表示（2026-10-22 追加。docs/question-display-design.md 3.3）。
 * 早押しの1問が終わるたびに、その問題の問題文と解答を Main の仕切り線の上に出す。
 * server/QuestionHandler.js がメモリに保持し、update_question_display で配信する。
 */
// semifinal はサドンデスだけで使う（2026-10-30 追加。項目17）
export type QuestionRound = 'secondRound' | 'thirdRound' | 'extraSecondStep' | 'semifinal' | 'final';

export type QuestionDisplayState = {
    /** 表示中の問題がどのラウンドのものか。まだ何も出していなければ null */
    round: QuestionRound | null;
    /** 表示中の問題の通し番号 */
    serial: number | null;
    /** Main に出しているか（Admin の「隠す」で false） */
    shown: boolean;
    /** 表示する問題が変わった回数。Main はこれが増えた瞬間だけ現れる演出をする */
    seq: number;
    /** ラウンドごとの「次に読む問題」の通し番号。開始番号を決めていないラウンドは無い */
    cursors: Partial<Record<QuestionRound, number>>;
    /**
     * ラウンドごとの「操作の記録」の最後（2026-10-29 追加。Undo で問題も戻すため）。
     * kind: scored = 採点（得点の Undo 履歴あり・問題あり）／ through = スルー（得点なし・問題あり）／
     *       other = 問題と関係しない得点の操作（3rd Round のコース終了、Final の次のセットへ など）
     * scope: どの組・コースの操作か（2nd Round は "g1" など、3rd Round はコース名）。記録が無ければ無い
     */
    lastEvents?: Partial<Record<QuestionRound, QuestionEvent>>;
};

export type QuestionEventKind = 'scored' | 'through' | 'other';
export type QuestionEvent = { kind: QuestionEventKind; scope: string };

export const DEFAULT_QUESTION_DISPLAY: QuestionDisplayState = { round: null, serial: null, shown: false, seq: 0, cursors: {} };
