// app/ と server/ の両方から使う定数。
// server/ は CommonJS なので lib/ の TS ファイルを読めない。両方から必要な値は
// ここを唯一の定義元にし、lib/ 側は再エクスポートで受ける（値を2箇所に書かない）。

/** 1st Round ペーパークイズの制限時間（秒）= 20分 */
const DEFAULT_COUNTDOWN = 1200;

/** 3rd Round 各コースの制限時間（秒）= 15分 */
const THIRD_ROUND_TIME_LIMIT = 15 * 60;

/** 準決勝 各セットの制限時間（秒）= 5分 */
const SEMIFINAL_SET_TIME_LIMIT = 5 * 60;

/** Extra Round First Step の問題数（1〜20問） */
const EXTRA_ROUND_QUESTION_COUNT = 20;

/**
 * Extra Round First Step の進行ステップ数。
 * 「問題を出す」「解答を出す」を1ステップずつ数え、(1〜10問)(11〜15問)(16〜20問)の
 * ブロックごとに「問題N…→解答N…」の順に進むので、全部で 問題数 × 2 = 40 ステップ。
 * 並び順そのものは lib/extraRound.ts の FIRST_STEP_SEQUENCE が組み立てる。
 */
const EXTRA_ROUND_FIRST_STEP_LENGTH = EXTRA_ROUND_QUESTION_COUNT * 2;

/** Extra Round Second Step の出場者の上限（First Step 通過者は最大12名） */
const EXTRA_ROUND_MAX_ENTRANTS = 12;

/** Extra Round の段階（server/ExtraRoundHandler.js が保持する進行状態の stage） */
const EXTRA_ROUND_STAGES = ['setup', 'firstStep', 'entrantSelect', 'secondStep'];

/**
 * ペーパークイズ上位100名の発表（2026-10-31 ユーザー承認・項目19）。
 * 1画面目は 1〜4位の4人、以降は6人ずつ（5〜10位 … 95〜100位）の全17画面。
 * 画面ごとの選手の割り振りは lib/paperTop.ts の getPaperTopPages が計算する
 */
const PAPER_TOP_COUNT = 100;
const PAPER_TOP_FIRST_PAGE_SIZE = 4;
const PAPER_TOP_PAGE_SIZE = 6;
const PAPER_TOP_PAGE_MAX = 1 + Math.ceil((PAPER_TOP_COUNT - PAPER_TOP_FIRST_PAGE_SIZE) / PAPER_TOP_PAGE_SIZE);   // 17

module.exports = {
    DEFAULT_COUNTDOWN,
    THIRD_ROUND_TIME_LIMIT,
    SEMIFINAL_SET_TIME_LIMIT,
    EXTRA_ROUND_QUESTION_COUNT,
    EXTRA_ROUND_FIRST_STEP_LENGTH,
    EXTRA_ROUND_MAX_ENTRANTS,
    EXTRA_ROUND_STAGES,
    PAPER_TOP_COUNT,
    PAPER_TOP_FIRST_PAGE_SIZE,
    PAPER_TOP_PAGE_SIZE,
    PAPER_TOP_PAGE_MAX
};
