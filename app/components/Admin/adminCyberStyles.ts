import type { CSSProperties } from "react";
import { ACCENT } from "@/lib/cyberpunkCard";

// Extra Round の Admin 画面で使う、サイバーパンク調の共通スタイル。
// 値は AdminThirdRound.tsx / AdminSecondRound.tsx（Cowork Design の AdminManual.dc.html 等を
// レビューで確定した版）と同じ。ラウンドごとに見た目がズレないよう、同じ定数を使う。

export const MANUAL_PANEL_BASE: CSSProperties = {
    boxSizing: 'border-box', padding: '16px 20px 20px', background: 'rgba(12,22,40,.75)',
    border: '1px solid rgba(79,216,255,.22)',
    clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
    display: 'flex', flexDirection: 'column', gap: 12,
};
export const MANUAL_LABEL_STYLE: CSSProperties = {
    fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, letterSpacing: 3, color: '#5C7EA6',
};
export function manualPanelStyle(active: boolean, flex: number): CSSProperties {
    return { ...MANUAL_PANEL_BASE, flex, ...(active ? {} : { opacity: 0.35, pointerEvents: 'none' as const }) };
}
export function manualBtnStyle(selected: boolean): CSSProperties {
    return {
        padding: '9px 16px',
        background: selected ? 'rgba(51,198,255,.14)' : 'rgba(255,255,255,.03)',
        border: `1.5px solid ${selected ? ACCENT : 'rgba(79,216,255,.18)'}`,
        clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)',
        cursor: 'pointer',
        boxShadow: selected ? '0 0 14px rgba(51,198,255,.14)' : undefined,
    };
}
export function manualBtnTextStyle(selected: boolean): CSSProperties {
    return {
        fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 1,
        color: selected ? '#DFF7FF' : '#5C7EA6', whiteSpace: 'nowrap',
    };
}
export function dangerBtnStyle(): CSSProperties {
    return {
        padding: '9px 18px', background: 'rgba(255,59,92,.10)', border: '1.5px solid #FF3B5C',
        clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)', cursor: 'pointer',
    };
}
export function neutralBtnStyle(): CSSProperties {
    return {
        padding: '9px 18px', background: 'rgba(255,255,255,.04)', border: '1.5px solid #3A4B63',
        clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)', cursor: 'pointer',
    };
}
export const DANGER_BTN_TEXT: CSSProperties = { fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#FFE3E8' };
export const NEUTRAL_BTN_TEXT: CSSProperties = { fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 1, color: '#9FB4D6' };

// 統計カード（Cowork Design の AdminThirdRound*.dc.html と同じ面取り 14px）
export const STAT_CARD_STYLE: CSSProperties = {
    flex: 1, boxSizing: 'border-box', padding: '18px 22px', background: 'rgba(12,22,40,.75)',
    border: '1px solid rgba(79,216,255,.22)',
    clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
};
export const STAT_LABEL_STYLE: CSSProperties = { fontFamily: 'Orbitron, sans-serif', fontSize: 12, letterSpacing: 3, color: '#5C7EA6' };

// 正誤判定ボタン（4コース共通と同じ面取り 5px）
export function opBtnStyle(kind: 'correct' | 'wrong', enabled: boolean): CSSProperties {
    return {
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '9px 0',
        background: kind === 'correct' ? 'rgba(51,198,255,.12)' : 'rgba(255,59,92,.10)',
        border: `1.5px solid ${kind === 'correct' ? '#33C6FF' : '#FF3B5C'}`,
        clipPath: 'polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)',
        cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.35,
    };
}
export function opBtnTextStyle(kind: 'correct' | 'wrong'): CSSProperties {
    return {
        fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: 2,
        color: kind === 'correct' ? '#DFF7FF' : '#FFE3E8',
    };
}

/** 画面上部の「いま押すべき操作」ボタン。action が無いときは無効の見た目 */
export function primaryButtonStyle(enabled: boolean, doneColor?: string): CSSProperties {
    return enabled
        ? {
            padding: '18px 40px', background: 'rgba(51,198,255,.14)', border: '2px solid #33C6FF',
            clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
            boxShadow: '0 0 22px rgba(51,198,255,.35)', cursor: 'pointer',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 20, letterSpacing: 2, color: '#DFF7FF',
        }
        : {
            padding: '18px 40px', background: 'rgba(255,255,255,.04)', border: '2px solid #3A4B63',
            clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 18, letterSpacing: 1,
            color: doneColor ?? '#5C7EA6', cursor: 'default',
        };
}

/** 主操作の隣に並べる副操作（「次のフェーズに進む」など）。金色の枠で主操作と見分ける */
export function secondaryActionStyle(): CSSProperties {
    return {
        padding: '18px 40px', background: 'rgba(255,201,60,.10)', border: '2px solid #FFC93C',
        clipPath: 'polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)',
        boxShadow: '0 0 18px rgba(255,201,60,.25)', cursor: 'pointer',
        fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 20, letterSpacing: 2, color: '#FFF1C7',
    };
}
