// カードの下に出す数字（ポイント・正解数）と ×（誤答）の大きさ。全ラウンド共通（2026-10-29 追加。項目4）。
// 文字の大きさと、画面に収める縮小の基準にする「下の欄の高さ」を必ず一緒に変えるため、ここに1つだけ置く
// （ずらすとカードが画面からはみ出す）。各ラウンドの CONTENT_H・Semi-Final の BELOW_H はここから求める。
// Swedish 10 の10マス・10 by 10 の6マスはカード幅の都合で大きくできないので、ここの値は使わない。

/** 数字の文字の大きさ（px） */
export const BELOW_NUMBER_FONT = 84;   // 2026-10-29 ユーザー決定（案C。以前は 58）
/** 数字の行の高さ（px） */
export const BELOW_NUMBER_H = Math.round(BELOW_NUMBER_FONT * 1.2);
/** ×・「・」の文字の大きさ（px） */
export const BELOW_MARK_FONT = 80;     // 2026-10-29 ユーザー決定（案C。以前は 64）
/** ×・「・」の1マスの幅（px）。2nd Round は2マス＋間隔14px がカード幅 172px に収まること */
export const BELOW_MARK_W = Math.min(78, BELOW_MARK_FONT);
/** ×の行の高さ（px） */
export const BELOW_MARK_H = BELOW_MARK_FONT + 6;

/**
 * 数字の欄に出す文字の大きさ。「LOST」「12th」のように文字数が多いと、大きくしたときに隣のカードの
 * 文字とくっつく（カード幅 172px）ので、文字数に応じて上限をかける（2026-10-29）。
 */
export function belowFontSize(text: string | number): number {
    const length = Array.from(String(text)).length;
    if (length >= 4) return Math.min(BELOW_NUMBER_FONT, 60);
    if (length === 3) return Math.min(BELOW_NUMBER_FONT, 76);
    return BELOW_NUMBER_FONT;
}
