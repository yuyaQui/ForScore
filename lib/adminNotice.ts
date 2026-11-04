// Admin 画面の通知（2026-11-04）。操作が断られた・失敗した・通信が切れている、を画面の上に出す。
//
// 以前は、サーバのエラーは alert（OK を押すまで操作が止まる）、通信の失敗は console.error だけ
// （押しても何も起きないのに画面には何も出ない）だった。どちらもここに集める。
// 画面のどこからでも notify() を呼べるように、window のイベントで AdminNoticeHost に渡す。
export type NoticeTone = 'info' | 'error';
export type NoticeDetail = { text: string; tone: NoticeTone };

export const NOTICE_EVENT = 'kqk-admin-notice';

export function notify(text: string, tone: NoticeTone = 'info') {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<NoticeDetail>(NOTICE_EVENT, { detail: { text, tone } }));
}

/** fetch の結果の error（文字列とは限らない）を人が読める文にする */
export function errorText(e: unknown, fallback: string): string {
    if (typeof e === 'string' && e !== '') return e;
    if (e instanceof Error && e.message) return `${fallback}（${e.message}）`;
    return fallback;
}
