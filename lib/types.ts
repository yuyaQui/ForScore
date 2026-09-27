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
export type { Player, ThirdRoundCourse, ExtraRoundQuestion } from '@prisma/client';

/**
 * 2nd Round の進行状態。
 * server/ModeHandler.js がメモリに保持し、update_second_round_state で配信する。
 */
export type SecondRoundState = {
    /** 何組目か（1〜4） */
    group: number;
    /** turnOver = 選手紹介、quiz = 正誤判定 */
    view: 'turnOver' | 'quiz';
    /**
     * turnOver 画面の発表ステップ（0〜3）。0=1位のみ、1=2・3位、2=4〜6位、3=7〜12位。
     * group を切り替えたとき、または view を turnOver に切り替えたときは 0 にリセットする。
     */
    turnOverStep: number;
    /** そのステップの順位帯を公開済みか。collapsed=順位のみ、expanded=氏名まで公開 */
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
 * フェーズ（フェーズ1 / フェーズ2 / サバイバル）は questionNumber から導出できるので
 * 持たない。残り人数も、First Step の採点がシステム外なので持たない。
 *
 * First Step は「1〜10問を出題だけ進める1周目」→「1〜10問をもう一度、解答表示ありで
 * 進める2周目」という流れになる。この2周構成はシステムが管理せず、Admin が
 * mode を手動で切り替えることで表現する（asking の間は解答を表示する手段自体を
 * 出さない。revealing に切り替えたあとも、1問ずつ解答表示ボタンを押して進める）。
 */
export type ExtraRoundState = {
    /** firstStep = 筆記クイズ、secondStep = 通過者最大12名の早押し */
    step: 'firstStep' | 'secondStep';
    /** 現在の問題番号 1〜20。Admin が手動で前後させる */
    questionNumber: number;
    /** 現在の問題の解答を表示しているか */
    answerRevealed: boolean;
    /** asking = 出題のみの周（解答表示ボタンを出さない）、revealing = 解答表示ができる周 */
    mode: 'asking' | 'revealing';
};

/**
 * 準決勝（Nine Hundred）の進行状態。
 * server/SemifinalHandler.js がメモリに保持し、update_semifinal_state で配信する。
 *
 * タイムレース形式は「セット中は結果を出さず、セット終了後にまとめて確認する」進行
 * のため、Main の表示を view で切り替える（quiz = 何も出さない、results = ポイントのみ）。
 * Admin は採点のため常にポイントが見える必要があるので、view の影響を受けない。
 */
export type SemifinalState = {
    /** 現在のセット 1〜3 */
    set: number;
    /** quiz = 通常の採点、playoff = 境界の同点を早押しプレーオフで決める */
    phase: 'quiz' | 'playoff';
    /** Main の表示切り替え。quiz = クイズ中（非表示）、results = セット終了後の点数発表 */
    view: 'quiz' | 'results';
    /** セット終了処理（勝ち抜け/失格の確定）を走らせたセット番号。未実行なら null */
    finishedSet: number | null;
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
};
