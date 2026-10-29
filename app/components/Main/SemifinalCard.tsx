import { useEffect, useState } from "react";
import {
    ACCENT, GUNMETAL_DARK, INNER_BG, HONEYCOMB_BG, OCTAGON_CLIP_PERCENT,
    tierOf, shade, outlineShadow,
} from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import { NEUTRAL_FRAME, ELIMINATED_FRAME_FILTER, ELIMINATED_NAME_COLOR, ELIMINATED_NAME_OUTLINE } from "./PlayerCardFrame";
import { LightningBoltsVertical } from "@/app/components/LightningBolts";
import { BELOW_NUMBER_H } from "@/app/components/Main/belowSizes";

// 準決勝の選手カード（2026-10-15。Design アーティファクト「【設計案】Semifinal 選手カード」を移植）。
//
// 枠（八角形・順位帯の色・ガンメタル・開扉演出）は 2nd Round 〜 Extra Round の PlayerCardFrame と同じ。
// 寸法と中身が違う: 上から 写真（3:4）→ 1st Round の順位 → 学校名 → 学年 → 名前（すべて横書き）。
//
// クイズ中（compact）は文字を消し、枠の下辺を写真の下端まで上げる。切り替えは CSS の transition で、
// 文字が消えてから枠が縮む（戻すときは枠が伸びてから文字が出る）。

// ---- 寸法 ----
// 9名が 1776px（左右 72px の余白の内側）に収まる幅（間隔 10px）
export const SF_CHASSIS_W = 188;
const SF_OUTER_W = 184;
const SF_CUT_PAD = 10;
const SF_FULL_OUTER_H = 560;
export const SF_FULL_CHASSIS_H = 574;
const COLLAPSED_CHASSIS_H = 144, COLLAPSED_OUTER_H = 130, COLLAPSED_STRIP_H = 7;
const FULL_STRIP_H = Math.round(COLLAPSED_STRIP_H * (SF_FULL_OUTER_H / COLLAPSED_OUTER_H));
const SF_INNER_W = SF_OUTER_W - SF_CUT_PAD * 2;              // 164
const SF_INNER_H = SF_FULL_OUTER_H - SF_CUT_PAD * 2;          // 540
const SF_PHOTO_H = Math.round(SF_INNER_W * 4 / 3);            // 219（3:4）
// クイズ中: 枠の下辺を写真の下端まで上げる
const SF_COMPACT_OUTER_H = SF_PHOTO_H + SF_CUT_PAD * 2 + 6;   // 245
export const SF_COMPACT_CHASSIS_H = SF_COMPACT_OUTER_H + 14;  // 259
// 1st Round の順位バッジ（写真の下）。高さは PlayerCardFrame のバッジと同じ
const BADGE_H = 38, BADGE_GAP = 12, BADGE_TEXT_GAP = 10;
const TEXT_SIDE_PAD = 12;
const TEXT_W = SF_INNER_W - TEXT_SIDE_PAD * 2;                // 140
// 文字の行の高さ（固定）。文字の大きさが選手ごとに違っても、行の位置は全員でそろう
const META_ROW_H = 24, NAME_ROW_H = 50, META_NAME_GAP = 8;
/** 名を何文字ぶん右へずらすか（姓は左端から。左上 → 右下へ視線が流れる） */
const NAME_STAGGER_EM = 1;
const BRUSHED_TEXTURE = 'repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0px, rgba(255,255,255,.06) 1px, transparent 1px, transparent 7px)';
const EASE = 'cubic-bezier(.22,1,.36,1)';

/**
 * 縁だけを色付きに残すガンメタルの重ね（buildTopBottomCutClip と同じ形）。
 * 縦方向を % と calc() で表すので、枠の高さが変わっても clip-path 自体は変わらない
 * （開扉・縮小の途中でも止まっているときと同じ描かれ方になる）。
 *   内側八角形の頂点 = cutPad + 内側の高さの 4.5% = 4.5% + 0.91 × cutPad
 */
const CUT_CLIP_PCT = (() => {
    const w = SF_OUTER_W, pad = SF_CUT_PAD;
    const ox1 = 0.05 * w, ox2 = 0.95 * w;
    const ix1 = pad + 0.05 * (w - pad * 2), ix2 = pad + 0.95 * (w - pad * 2);
    const d = (0.91 * pad).toFixed(2);
    const x = (v: number) => `${v.toFixed(2)}px`;
    return `polygon(${x(ox1)} 4.5%, ${x(ix1)} calc(4.5% + ${d}px), ${x(ix2)} calc(4.5% + ${d}px), ${x(ox2)} 4.5%, ${x(ox2)} 95.5%, ${x(ix2)} calc(95.5% - ${d}px), ${x(ix1)} calc(95.5% - ${d}px), ${x(ox1)} 95.5%)`;
})();

export type SfIntro = {
    chassisH: number; outerH: number; stripH: number;
    appearOpacity: number; appearScale: number; revealOpacity: number; isExpanding: boolean;
    /** transition を付けてよいか（最初の1フレームは付けない） */
    animated: boolean;
};

/**
 * 開扉演出（PlayerCardFrame の useCardIntroPhase と同じ手順・タイミング）。
 * delayMs が null なら演出せず、最初から開いた状態にする（リロードや途中から開いたとき）。
 * 演出をやり直すときは、呼び出し側でカードの key を変えて作り直す。
 */
export function useSfCardIntro(delayMs: number | null): SfIntro {
    const skip = delayMs === null;
    const [door, setDoor] = useState<'hidden' | 'collapsed' | 'expanding' | 'open'>(skip ? 'open' : 'hidden');
    const [animated, setAnimated] = useState(false);
    useEffect(() => {
        if (delayMs === null) {
            // 最初の描画のあとから transition を有効にする（縮小・伸長の切り替えで動かすため）
            const id = requestAnimationFrame(() => setAnimated(true));
            return () => cancelAnimationFrame(id);
        }
        const d = delayMs;
        const timers = [
            setTimeout(() => setAnimated(true), d + 50),
            setTimeout(() => setDoor('collapsed'), d + 350),
            setTimeout(() => setDoor('expanding'), d + 1050),
            setTimeout(() => setDoor('open'), d + 1900),
        ];
        return () => timers.forEach(clearTimeout);
    }, [delayMs]);
    const full = door === 'expanding' || door === 'open';
    return {
        chassisH: full ? SF_FULL_CHASSIS_H : COLLAPSED_CHASSIS_H,
        outerH: full ? SF_FULL_OUTER_H : COLLAPSED_OUTER_H,
        stripH: full ? FULL_STRIP_H : COLLAPSED_STRIP_H,
        appearOpacity: door === 'hidden' ? 0 : 1,
        appearScale: door === 'hidden' ? 0.82 : 1,
        revealOpacity: door === 'open' ? 1 : 0,
        isExpanding: door === 'expanding',
        animated,
    };
}

/** 横書きの名前: 姓と名で改行し、名を1文字右へずらす。大きさは「姓の幅」と「ずらし幅＋名の幅」の広い方が収まる最大値 */
function layoutName(name: string, maxSize = 44, minSize = 18): { lines: string[]; size: number } {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const lines = parts.length <= 1 ? [name.trim()] : [parts[0], parts.slice(1).join(' ')];
    const len = (t: string) => Array.from(t).length;
    const widthEm = lines.length > 1 ? Math.max(len(lines[0]), NAME_STAGGER_EM + len(lines[1])) : len(lines[0]);
    return { lines, size: Math.max(minSize, Math.min(maxSize, Math.floor(TEXT_W / (widthEm + 0.1)))) };
}

/** 学校名・学年（常に2行。長い方の行に合わせて縮める） */
function layoutMeta(school: string, grade: string, maxSize = 20, minSize = 13): { lines: string[]; size: number } {
    const longest = Math.max(Array.from(school).length, Array.from(grade).length, 1);
    return { lines: [school, grade], size: Math.max(minSize, Math.min(maxSize, Math.floor(TEXT_W / longest))) };
}

type SemifinalCardProps = {
    intro: SfIntro;
    paperRank: number;
    name: string;
    school: string | null;
    grade: string | null;
    /** 写真の URL。未登録なら null（NO PHOTO を出す） */
    photo: string | null;
    eliminated?: boolean;
    winner?: boolean;
    /** 写真の下の領域に対するバーの高さ（%）。100% で写真の下端まで */
    pct?: number;
    barColor?: string;
    /** 枠の下に出す表示（点数・WIN・LOST など）。compact では消える */
    belowContent?: React.ReactNode;
    /** クイズ中の小さいカード（文字を消し、枠が写真だけを囲む） */
    compact?: boolean;
    /** compact で写真の下端に重ねる表示。勝ち抜けは何セット目か（'1st' など）、敗退は 'LOST' */
    statusLabel?: string | null;
};

export function SemifinalCard({
    intro, paperRank, name, school, grade, photo, eliminated = false, winner = false,
    pct = 0, barColor = 'rgba(51,198,255,.55)', belowContent, compact = false, statusLabel = null,
}: SemifinalCardProps) {
    const tier = tierOf(paperRank, ACCENT);
    const outline = shade(tier.color, -0.35);
    const metal = eliminated ? NEUTRAL_FRAME : tier.color;
    const outerFilter = eliminated
        ? ELIMINATED_FRAME_FILTER
        : winner
            ? `drop-shadow(0 0 16px ${tier.glowA}) drop-shadow(0 0 36px ${tier.glowB})`
            : `drop-shadow(0 0 10px ${tier.glowA}) drop-shadow(0 0 24px ${tier.glowB})`;
    const nm = layoutName(name);
    const meta = layoutMeta(school || '未登録', grade || '-');
    const textColor = eliminated ? ELIMINATED_NAME_COLOR : '#F3FAFF';
    const trackH = SF_INNER_H - SF_PHOTO_H;

    // 高さ: compact なら写真だけを囲む高さ、そうでなければ開扉演出の高さ
    const chassisH = compact ? SF_COMPACT_CHASSIS_H : intro.chassisH;
    const outerH = compact ? SF_COMPACT_OUTER_H : intro.outerH;
    const textOpacity = compact ? 0 : intro.revealOpacity;
    // 縮むときは「文字が消える → 枠が縮む」、伸びるときは「枠が伸びる → 文字が出る」の順にする
    const heightDelay = compact ? '.3s' : '0s';
    const textDelay = compact ? '0s' : '.75s';
    const tr = (s: string) => (intro.animated ? s : 'none');
    const HEIGHT_T = tr(`height .7s ${EASE} ${heightDelay}`);
    const TEXT_T = tr(`opacity .35s ease ${textDelay}`);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: SF_CHASSIS_W, flexShrink: 0 }}>
            {/* 入れ物の高さも一緒に変える（クイズ中は下にタイマーを出すため、カードの段を低くする） */}
            <div style={{ width: SF_CHASSIS_W, height: compact ? SF_COMPACT_CHASSIS_H : SF_FULL_CHASSIS_H, display: 'flex', alignItems: compact ? 'flex-start' : 'center', justifyContent: 'center', transition: HEIGHT_T }}>
                <div style={{
                    position: 'relative', width: SF_CHASSIS_W, height: chassisH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    clipPath: OCTAGON_CLIP_PERCENT, background: GUNMETAL_DARK, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.05)',
                    opacity: intro.appearOpacity, transform: `scale(${intro.appearScale})`,
                    transition: tr(`height .7s ${EASE} ${heightDelay}, opacity .4s ease, transform .4s ${EASE}`),
                }}>
                    <div style={{
                        position: 'relative', width: SF_OUTER_W, height: outerH, flexShrink: 0, clipPath: OCTAGON_CLIP_PERCENT,
                        backgroundImage: `${BRUSHED_TEXTURE}, linear-gradient(0deg, ${metal}, ${metal})`, padding: SF_CUT_PAD, boxSizing: 'border-box',
                        filter: outerFilter, transition: HEIGHT_T,
                    }}>
                        <div style={{ position: 'absolute', inset: 0, background: GUNMETAL_DARK, clipPath: CUT_CLIP_PCT, pointerEvents: 'none' }} />
                        <div style={{
                            position: 'relative', width: '100%', height: '100%', clipPath: OCTAGON_CLIP_PERCENT, overflow: 'hidden',
                            backgroundColor: INNER_BG, backgroundImage: HONEYCOMB_BG, backgroundRepeat: 'repeat', backgroundSize: '56px 100px',
                            boxShadow: 'inset 0 3px 6px rgba(255,255,255,.06), inset 0 -6px 16px rgba(0,0,0,.65), inset 0 0 26px rgba(0,0,0,.35)',
                        }}>
                            {/* 写真（上部いっぱい。下端は本体へなじませる） */}
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: SF_PHOTO_H, opacity: intro.revealOpacity, transition: tr(`opacity .5s ease ${intro.revealOpacity ? '.1s' : '0s'}`) }}>
                                {photo ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: eliminated ? 'grayscale(1) brightness(.55)' : undefined }} />
                                ) : (
                                    <NoPhoto color={metal} />
                                )}
                                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 46, background: `linear-gradient(180deg, rgba(26,26,26,0), ${INNER_BG})` }} />
                                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: `linear-gradient(90deg, transparent, ${metal}, transparent)`, opacity: .85 }} />
                            </div>
                            {/* クイズ中: 勝ち抜け（何セット目か）・敗退を写真の下端に重ねる */}
                            {compact && statusLabel && (
                                <div style={{
                                    position: 'absolute', left: 0, right: 0, top: 0, height: SF_PHOTO_H, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 14, boxSizing: 'border-box',
                                    background: statusLabel !== 'LOST' ? 'linear-gradient(180deg, rgba(255,140,45,0) 35%, rgba(255,140,45,.55))' : undefined,
                                }}>
                                    <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 30, letterSpacing: 2, color: statusLabel !== 'LOST' ? '#FFE28A' : '#8A93A3', textShadow: '0 2px 10px rgba(0,0,0,.8)' }}>{statusLabel}</span>
                                </div>
                            )}
                            {/* ポイントバー（写真の下の領域だけを使う。100% で写真の下端まで） */}
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: (trackH * Math.max(0, Math.min(100, pct))) / 100, background: barColor, opacity: textOpacity, transition: TEXT_T }} />
                            {/* 上端の帯（順位帯の色） */}
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: intro.stripH, backgroundImage: `linear-gradient(90deg, transparent, ${tier.color}, transparent)`, opacity: 0.95, transition: tr(`height .7s ${EASE}`) }} />
                            {/* 1st Round の順位（写真のすぐ下） */}
                            <div style={{ position: 'absolute', top: SF_PHOTO_H + BADGE_GAP, left: 0, right: 0, height: BADGE_H, display: 'flex', justifyContent: 'center', opacity: textOpacity, transition: TEXT_T }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', height: BADGE_H, padding: '0 12px', border: `3px solid ${metal}`, clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', fontFamily: 'Orbitron,sans-serif', fontWeight: 900, fontSize: 24, color: eliminated ? ELIMINATED_NAME_COLOR : '#FFFFFF', letterSpacing: 1 }}>
                                    {toOrdinal(paperRank)}
                                </span>
                            </div>
                            {/* 学校名 → 学年 → 名前（横書き・縦並び。各行の高さは固定） */}
                            <div style={{
                                position: 'absolute', top: SF_PHOTO_H + BADGE_GAP + BADGE_H + BADGE_TEXT_GAP, left: TEXT_SIDE_PAD, right: TEXT_SIDE_PAD,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', opacity: textOpacity, transition: TEXT_T,
                            }}>
                                {meta.lines.map((l, i) => (
                                    <div key={i} style={{ height: META_ROW_H, display: 'flex', alignItems: 'center', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: meta.size, lineHeight: 1, color: eliminated ? ELIMINATED_NAME_COLOR : '#FFFFFF', textShadow: outlineShadow(outline, 1.1), whiteSpace: 'nowrap' }}>
                                        {l}
                                    </div>
                                ))}
                                <div style={{ marginTop: META_NAME_GAP, display: 'flex', flexDirection: 'column', alignSelf: 'center', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: nm.size, lineHeight: 1, letterSpacing: 1, color: textColor, textShadow: eliminated ? outlineShadow(ELIMINATED_NAME_OUTLINE.color, ELIMINATED_NAME_OUTLINE.width) : outlineShadow(outline, 1.5), whiteSpace: 'nowrap' }}>
                                    {nm.lines.map((l, i) => (
                                        <div key={i} style={{ height: NAME_ROW_H, display: 'flex', alignItems: 'center', alignSelf: 'flex-start', marginLeft: i > 0 ? `${NAME_STAGGER_EM}em` : 0 }}>{l}</div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ position: 'absolute', top: '6%', bottom: '6%', left: '50%', width: 64, transform: 'translateX(-50%)', opacity: intro.isExpanding ? 1 : 0, transition: 'opacity .15s linear', pointerEvents: 'none', zIndex: 6 }}>
                                <LightningBoltsVertical />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* 枠の下の表示。クイズ中は高さごと消して、空いた所にタイマーを出す */}
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden',
                height: compact ? 0 : BELOW_H, opacity: textOpacity, transition: tr(`opacity .35s ease ${textDelay}, height .7s ${EASE} ${heightDelay}`),
            }}>
                {belowContent}
            </div>
        </div>
    );
}

/** 枠の下の表示（点数・WIN・LOST）の高さ。BelowText（marginTop 16 + 70）と同じ */
export const BELOW_H = 16 + BELOW_NUMBER_H;   // 数字の大きさは belowSizes.ts（2026-10-29）

/** 写真が未登録の選手の代わりの表示 */
export function NoPhoto({ color }: { color: string }) {
    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', background: `radial-gradient(120% 90% at 50% 30%, ${color}26, rgba(0,0,0,0) 70%)` }}>
            <svg viewBox="0 0 300 400" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0 }}>
                <circle cx="150" cy="150" r="62" fill="none" stroke={color} strokeOpacity=".55" strokeWidth="5" />
                <path d="M40 400 C 52 290 100 240 150 240 C 200 240 248 290 260 400" fill="none" stroke={color} strokeOpacity=".55" strokeWidth="5" />
            </svg>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 30, textAlign: 'center', fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 11, letterSpacing: 3, color, opacity: .8 }}>NO PHOTO</div>
        </div>
    );
}

/**
 * 準決勝の5分タイマー（2026-10-15 ユーザー指定）。
 * 中央に残り時間の数値だけを出し、枠の縁そのものをゲージにする。3rd Round の円形タイマーと同じく、
 * 上辺の中央から時計回りに伸び、残り時間が減るほど短くなる（色・下地・グロー・数値の書体も同じ）。
 * 残り1分を切ると赤（1セット5分なので、15分の 3rd Round の「残り2分」より短くしている）。
 */
export function SemifinalTimerGauge({ remaining, total, width }: { remaining: number; total: number; width: number }) {
    const W = width, H = 230, SW = 14, C = 30;          // 幅・高さ・縁の太さ・角の面取り
    const frac = Math.max(0, Math.min(1, remaining / total));
    const urgent = remaining <= 60;
    const ringColor = urgent ? '#FF3B5C' : '#4FD8FF';
    const glow = urgent ? 'rgba(255,59,92,.65)' : 'rgba(79,216,255,.55)';
    const mm = String(Math.floor(Math.max(0, remaining) / 60)).padStart(2, '0');
    const ss = String(Math.max(0, remaining) % 60).padStart(2, '0');
    // 縁の中心線（上辺の中央から時計回り）
    const i = SW / 2, x0 = i, y0 = i, x1 = W - i, y1 = H - i;
    const d = `M ${W / 2} ${y0} L ${x1 - C} ${y0} L ${x1} ${y0 + C} L ${x1} ${y1 - C} L ${x1 - C} ${y1} L ${x0 + C} ${y1} L ${x0} ${y1 - C} L ${x0} ${y0 + C} L ${x0 + C} ${y0} Z`;
    return (
        <div style={{ position: 'relative', width: W, height: H, flexShrink: 0 }}>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
                <path d={d} fill="rgba(7,12,22,.85)" stroke="rgba(255,255,255,.08)" strokeWidth={SW} strokeLinejoin="round" />
                {frac > 0 && (
                    <path d={d} pathLength={1000} fill="none" stroke={ringColor} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"
                        strokeDasharray={`${(frac * 1000).toFixed(1)} 1000`} style={{ filter: `drop-shadow(0 0 10px ${glow})` }} />
                )}
            </svg>
            <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: 112, letterSpacing: 2,
                fontVariantNumeric: 'tabular-nums', color: '#FFFFFF', textShadow: `0 0 18px ${glow}`,
            }}>
                {mm}:{ss}
            </div>
        </div>
    );
}
