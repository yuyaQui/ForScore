/**
 * 3rd Round「Number 10」の4コース定義
 *
 * ここの文字列は DB の ThirdRoundCourse.name と一致していなければならない。
 * 4行は add_third_round マイグレーションの INSERT で投入している。
 * 値を変更する場合は、新しいマイグレーションでの UPDATE が必要になる。
 *
 * Player.thirdRoundCourseName は ThirdRoundCourse.name への外部キーなので、
 * ここに無い名前を書き込もうとすると DB が拒否する。
 */

export const THIRD_ROUND_COURSES = {
    UP_DOWN: '10 up-down',
    FREEZE: 'Freeze 10',
    SWEDISH: 'Swedish 10',
    TEN_BY_TEN: '10 by 10',
} as const;

/** コース名の型。'10 up-down' | 'Freeze 10' | 'Swedish 10' | '10 by 10' */
export type ThirdRoundCourseName =
    (typeof THIRD_ROUND_COURSES)[keyof typeof THIRD_ROUND_COURSES];

/** 全コース名の配列。抽選やコース一覧の表示に使う */
export const THIRD_ROUND_COURSE_NAMES: ThirdRoundCourseName[] =
    Object.values(THIRD_ROUND_COURSES);

/** 1コースあたりの出場人数 */
export const PLAYERS_PER_COURSE = 5;

/** 1コースあたりの勝ち抜け枠 */
export const WINNERS_PER_COURSE = 2;

/** コース終了となる失格者数 */
export const ELIMINATED_TO_FINISH = 3;

/** エントリータイム（秒） */
export const ENTRY_TIME_SECONDS = 10;

/**
 * 各コースの出題時間（秒）
 *
 * 定義元は constants.js。server/ が CommonJS でこの TS ファイルを読めないため、
 * サーバとクライアントの両方が必要な値は constants.js を唯一の定義元にしている。
 * ここでは app/ 側から使いやすい名前に付け替えて再エクスポートするだけ。
 */
export { THIRD_ROUND_TIME_LIMIT as COURSE_TIME_LIMIT_SECONDS } from '../constants.js';

/** 残り時間がこの秒数以下になったら、タイマーを赤（警告色）にする（2026-11-11 ユーザー指示で 2分 → 5分。Main と Admin で同じ値） */
export const TIMER_URGENT_SECONDS = 300;
/** 残り時間がこの秒数以下になったら、Main のタイマーを点滅させる（点滅は従来どおり残り2分から） */
export const TIMER_PULSE_SECONDS = 120;

/**
 * 準決勝の座席割り当て
 *
 * 3rd Round 通過1位〜8位を、左から何番目の席に座らせるか。
 * 9席のうち中央の5番席のみが空き、そこは Extra Round の敗者復活者が入る。
 * 上位ほど中央寄りに配置される。
 */
export const SEMIFINAL_SEATS = [4, 6, 3, 7, 2, 8, 1, 9] as const;
