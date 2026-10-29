// 決勝の選手カード（2026-10-15 追加。Design アーティファクトの試作を移植）
//
// 中身の並びは準決勝のカードと同じ（写真 → 1st Round 順位 → 学校名 → 学年 → 名前）。
// 2026-10-15 ユーザー指示: 横幅を画面に合わせて広げ、名前は1行で表示する。
// 枠の形は準決勝・2nd〜Extra Round と同じ。横に広い分、面取りの寸法は % ではなく px で
// 細いカードと同じ大きさにそろえる（% のままだと角が横に引き伸ばされるため）。
import {
    ACCENT, GUNMETAL_DARK, INNER_BG, HONEYCOMB_BG, tierOf, shade, outlineShadow,
} from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import { NEUTRAL_FRAME, ELIMINATED_FRAME_FILTER, ELIMINATED_NAME_COLOR, ELIMINATED_NAME_OUTLINE } from "./PlayerCardFrame";
import { NoPhoto } from "./SemifinalCard";

export const F_CHASSIS_W = 556, F_OUTER_W = 552, F_PAD = 10;
export const F_CHASSIS_H = 574, F_OUTER_H = 560;
const F_INNER_W = F_OUTER_W - F_PAD * 2;     // 532
const F_INNER_H = F_OUTER_H - F_PAD * 2;     // 540
export const F_PHOTO_H = 300;
const STRIP_H = 30;
const BADGE_H = 38, BADGE_GAP = 12, BADGE_TEXT_GAP = 10;
const META_ROW_H = 30, NAME_ROW_H = 72, META_NAME_GAP = 8;
const TEXT_W = F_INNER_W - 48;
const BRUSHED_TEXTURE = 'repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0px, rgba(255,255,255,.06) 1px, transparent 1px, transparent 7px)';

/** 細いカード（幅 refW）の OCTAGON_CLIP_PERCENT と同じ角の大きさを、幅 w のカードに px で当てはめる */
function octagonPx(w: number, refW: number): string {
    const cx = 0.2 * refW, ix = 0.05 * refW;
    const px = (v: number) => `${v.toFixed(2)}px`;
    return `polygon(${px(cx)} 1%, ${px(w - cx)} 1%, ${px(w - ix)} 4.5%, ${px(w - ix)} 95.5%, ${px(w - cx)} 99%, ${px(cx)} 99%, ${px(ix)} 95.5%, ${px(ix)} 4.5%)`;
}
/** CUT_CLIP_PCT（準決勝）の横に広い版。x は細いカードと同じ px、y は % */
function cutClipPx(w: number, refW: number, pad: number): string {
    const ox = 0.05 * refW, ix = pad + 0.05 * (refW - pad * 2);
    const d = (0.91 * pad).toFixed(2);
    const px = (v: number) => `${v.toFixed(2)}px`;
    return `polygon(${px(ox)} 4.5%, ${px(ix)} calc(4.5% + ${d}px), ${px(w - ix)} calc(4.5% + ${d}px), ${px(w - ox)} 4.5%, ${px(w - ox)} 95.5%, ${px(w - ix)} calc(95.5% - ${d}px), ${px(ix)} calc(95.5% - ${d}px), ${px(ox)} 95.5%)`;
}

/** 名前を1行で、カードの幅に収まる最大の大きさに（最大 64px） */
function oneLineName(name: string, max = 64, min = 28): number {
    const parts = name.trim().split(/\s+/);
    const chars = parts.reduce((n, p) => n + Array.from(p).length, 0);
    const ems = chars + (parts.length - 1) * 0.35;
    return Math.max(min, Math.min(max, Math.floor((TEXT_W - chars * 2) / ems)));
}

export function FinalCard({ paperRank, name, school, grade, photo, eliminated = false, winner = false, pct = 0, barColor = 'rgba(51,198,255,.55)', setsWon = null }: {
    paperRank: number; name: string; school: string; grade: string; photo: string | null; eliminated?: boolean; winner?: boolean; pct?: number; barColor?: string;
    /** 獲得セット数（写真の右側の余白に出す。null なら出さない） */
    setsWon?: number | null;
}) {
    const tier = tierOf(paperRank, ACCENT);
    const outline = shade(tier.color, -0.35);
    const metal = eliminated ? NEUTRAL_FRAME : tier.color;
    const outerFilter = eliminated
        ? ELIMINATED_FRAME_FILTER
        : winner
            ? `drop-shadow(0 0 16px ${tier.glowA}) drop-shadow(0 0 36px ${tier.glowB})`
            : `drop-shadow(0 0 10px ${tier.glowA}) drop-shadow(0 0 24px ${tier.glowB})`;
    const textColor = eliminated ? ELIMINATED_NAME_COLOR : '#F3FAFF';
    const metaSize = Math.min(28, Math.floor(TEXT_W / Math.max(Array.from(school).length, Array.from(grade).length)));
    const nameSize = oneLineName(name);
    const trackH = F_INNER_H - F_PHOTO_H;
    const textTop = F_PHOTO_H + BADGE_GAP + BADGE_H + BADGE_TEXT_GAP;

    return (
        <div style={{ width: F_CHASSIS_W, height: F_CHASSIS_H, flexShrink: 0, position: 'relative', clipPath: octagonPx(F_CHASSIS_W, 188), background: GUNMETAL_DARK, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: F_OUTER_W, height: F_OUTER_H, clipPath: octagonPx(F_OUTER_W, 184), backgroundImage: `${BRUSHED_TEXTURE}, linear-gradient(0deg, ${metal}, ${metal})`, padding: F_PAD, boxSizing: 'border-box', filter: outerFilter }}>
                <div style={{ position: 'absolute', inset: 0, background: GUNMETAL_DARK, clipPath: cutClipPx(F_OUTER_W, 184, F_PAD), pointerEvents: 'none' }} />
                <div style={{
                    position: 'relative', width: '100%', height: '100%', clipPath: octagonPx(F_INNER_W, 164), overflow: 'hidden',
                    backgroundColor: INNER_BG, backgroundImage: HONEYCOMB_BG, backgroundRepeat: 'repeat', backgroundSize: '56px 100px',
                    boxShadow: 'inset 0 3px 6px rgba(255,255,255,.06), inset 0 -6px 16px rgba(0,0,0,.65), inset 0 0 26px rgba(0,0,0,.35)',
                }}>
                    {/* 写真: 登録した 3:4 の写真をそのまま中央に置き、左右は同じ写真をぼかして敷く（顔が切れない） */}
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: F_PHOTO_H, overflow: 'hidden', background: '#0B0F16' }}>
                        {photo ? (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={photo} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.25)', filter: `blur(18px) brightness(.45)${eliminated ? ' grayscale(1)' : ''}` }} />
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={photo} alt="" style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', height: '100%', aspectRatio: '3 / 4', objectFit: 'cover', filter: eliminated ? 'grayscale(1) brightness(.55)' : undefined, boxShadow: '0 0 30px rgba(0,0,0,.6)' }} />
                            </>
                        ) : (
                            <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', height: '100%', aspectRatio: '3 / 4' }}><NoPhoto color={eliminated ? NEUTRAL_FRAME : tier.color} /></div>
                        )}
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 40, background: `linear-gradient(180deg, rgba(26,26,26,0), ${INNER_BG})` }} />
                        {setsWon !== null && <SetsWon count={setsWon} color={metal} dim={eliminated} />}
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: `linear-gradient(90deg, transparent, ${metal}, transparent)`, opacity: .85 }} />
                    </div>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${(trackH * Math.max(0, Math.min(100, pct))) / 100}px`, background: barColor }} />
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: STRIP_H, backgroundImage: `linear-gradient(90deg, transparent, ${tier.color}, transparent)`, opacity: 0.95 }} />
                    <div style={{ position: 'absolute', top: F_PHOTO_H + BADGE_GAP, left: 0, right: 0, height: BADGE_H, display: 'flex', justifyContent: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', height: BADGE_H, padding: '0 12px', border: `3px solid ${metal}`, clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', fontFamily: 'Orbitron,sans-serif', fontWeight: 900, fontSize: 24, color: eliminated ? ELIMINATED_NAME_COLOR : '#FFFFFF', letterSpacing: 1 }}>
                            {toOrdinal(paperRank)}
                        </span>
                    </div>
                    <div style={{ position: 'absolute', top: textTop, left: 24, right: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        {[school, grade].map((l, i) => (
                            <div key={i} style={{ height: META_ROW_H, display: 'flex', alignItems: 'center', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: metaSize, lineHeight: 1, color: eliminated ? ELIMINATED_NAME_COLOR : '#FFFFFF', textShadow: outlineShadow(outline, 1.1), whiteSpace: 'nowrap' }}>{l}</div>
                        ))}
                        <div style={{ marginTop: META_NAME_GAP, height: NAME_ROW_H, display: 'flex', alignItems: 'center', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: nameSize, lineHeight: 1, letterSpacing: 2, color: textColor, textShadow: eliminated ? outlineShadow(ELIMINATED_NAME_OUTLINE.color, ELIMINATED_NAME_OUTLINE.width) : outlineShadow(outline, 1.8), whiteSpace: 'nowrap' }}>
                            {name.trim().split(/\s+/).map((part, i) => <span key={i} style={{ marginLeft: i === 0 ? 0 : '0.35em' }}>{part}</span>)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** 獲得セット数（3セット先取）。写真の右側の余白（ぼかした部分）の中央に、図形だけを縦に3つ並べる
 *  （獲得した分だけ点灯。数字・ラベルは出さない。2026-10-15 ユーザー指示）。下から順に点灯する */
const SETS_TO_WIN = 3;
function SetsWon({ count, color, dim }: { count: number; color: string; dim: boolean }) {
    const sideW = (F_INNER_W - F_PHOTO_H * 3 / 4) / 2;   // 写真の右側の余白の幅（約153px）
    return (
        <div style={{ position: 'absolute', top: STRIP_H, bottom: 0, right: 0, width: sideW, display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', justifyContent: 'center', gap: 30, opacity: dim ? 0.55 : 1 }}>
            {Array.from({ length: SETS_TO_WIN }, (_, i) => {
                const on = i < count;
                return (
                    <span key={i} style={{
                        width: 40, height: 40, transform: 'rotate(45deg)', boxSizing: 'border-box',
                        background: on ? color : 'rgba(7,12,22,.55)', border: `3px solid ${on ? color : 'rgba(159,180,214,.45)'}`,
                        boxShadow: on ? `0 0 16px ${color}, 0 0 32px ${color}88` : undefined,
                    }} />
                );
            })}
        </div>
    );
}
