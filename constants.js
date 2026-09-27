// app/ と server/ の両方から使う定数。
// server/ は CommonJS なので lib/ の TS ファイルを読めない。両方から必要な値は
// ここを唯一の定義元にし、lib/ 側は再エクスポートで受ける（値を2箇所に書かない）。

/** 1st Round ペーパークイズの制限時間（秒）= 20分 */
const DEFAULT_COUNTDOWN = 1200;

/** 3rd Round 各コースの制限時間（秒）= 15分 */
const THIRD_ROUND_TIME_LIMIT = 15 * 60;

/** 準決勝 各セットの制限時間（秒）= 5分 */
const SEMIFINAL_SET_TIME_LIMIT = 5 * 60;

module.exports = {
    DEFAULT_COUNTDOWN,
    THIRD_ROUND_TIME_LIMIT,
    SEMIFINAL_SET_TIME_LIMIT
};
