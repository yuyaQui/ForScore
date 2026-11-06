import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { splitName, splitNameFontSize } from "@/lib/playerName";
import { toOrdinal } from "@/lib/ordinal";
import {
    ACCENT,
    GUNMETAL_DARK,
    INNER_BG,
    HONEYCOMB_BG,
    OCTAGON_CLIP_PERCENT,
    buildTopBottomCutClip,
    tierOf,
    shade,
    outlineShadow,
    fitFontSizeToWidth,
} from "@/lib/cyberpunkCard";
import { LightningBoltsVertical } from "@/app/components/LightningBolts";

// 2nd Round 以降の Quiz View 系カード（縦長の八角形の額縁＋開扉演出）の共通部品。
// もともと MainThirdRound.tsx 内にあったものを、Extra Round の Second Step からも
// 同じ見た目で使えるよう切り出した（見た目・挙動は変えていない）。
// 外から使うもの: useCardIntroPhase / PlayerCardFrame / CardIntroPhase

// カード本体の寸法。Design アーティファクトの値をそのまま使う。
// 2026-10-03 ユーザー指示: カードの横幅も2nd Round(MainSecondRound.tsx)に揃える。
// 元のCowork Designアーティファクト(ThirdRound10UpDown.dc.html等)では158/14だったが、
// 明示的な指示により2nd Roundの168/10に変更している(アーティファクトとの相違点)。
const CARD_OUTER_W = 168, CARD_CUT_PAD = 10;
// 2026-11-07 ユーザー承認: 枠の高さを 694 → 600 に詰めた（名の下端から枠の下端までの空きを詰め、
// 画面の下部に大会名・ロゴを置く場所を作る。2nd Round と同じ値）
const FULL_CHASSIS_H = 600, FULL_OUTER_H = 586;
/** 枠の高さ（3rd Round・Extra Round の本体の高さの計算に使う） */
export const PLAYER_CARD_CHASSIS_H = FULL_CHASSIS_H;
const COLLAPSED_CHASSIS_H = 144, COLLAPSED_OUTER_H = 130;
const COLLAPSED_STRIP_H = 7;
// 上の帯の太さは枠を詰める前（外枠 680）のまま
const FULL_STRIP_H = Math.round(COLLAPSED_STRIP_H * (680 / COLLAPSED_OUTER_H));
const COLLAPSED_BADGE_TOP = 14;
const FULL_BADGE_TOP = FULL_STRIP_H + 10;

// 名前・学校名/学年のフォントサイズとゾーン。2nd Round(MainSecondRound.tsx)のQuizViewと
// 同じ考え方(fitFontSizeToWidthで縦書きの高さに収まる最大サイズを逆算し、横幅もはみ出さない
// よう事後調整する)を移植した。バッジ下のクリアランス(top:105)と八角形コーナーの手前で
// 止める下端マージン(bottom:36)は、OCTAGON_CLIP_PERCENTとバッジの縦位置(FULL_BADGE_TOP)が
// 2nd Roundとまったく同じ値のため、同じ数値をそのまま使える。横幅側もCARD_OUTER_W/
// CARD_CUT_PADが2nd Roundと同じ値になったため、計算結果も2nd Roundと一致する。
const NAME_META_INNER_W = CARD_OUTER_W - CARD_CUT_PAD * 2; // 130
const NAME_ZONE_H = (FULL_OUTER_H - CARD_CUT_PAD * 2) - 105 - 36; // 566 - 105 - 36 = 425（2026-11-07 枠を詰めた後）
const META_ZONE_H = NAME_ZONE_H - 14; // 2nd Roundと同じく少し余裕を多めに取る
const NAME_META_WIDTH_BUDGET = NAME_META_INNER_W - 18; // 左右9pxずつの余白を引く
const NAME_META_SAFETY_GAP = 8;
export const NEUTRAL_FRAME = '#4A5568'; // 失格した選手の枠色（順位帯の色に関わらずこのグレーに固定）
// 失格した選手のカード（2026-10-29 ユーザー決定の案B）。半透明にすると名前まで透けて読めなかったので、
// 明るさで暗くし、名前は明るい灰色＋黒い縁にする。2nd Round・3rd Round・Extra Round・Semi-Final・Final で共通
export const ELIMINATED_FRAME_FILTER = 'grayscale(1) brightness(.75)';
export const ELIMINATED_NAME_COLOR = '#C3CAD5';
/** 失格した選手の名前の縁取り（outlineShadow に渡す色と太さ） */
export const ELIMINATED_NAME_OUTLINE = { color: '#000000', width: 2.5 };
// 3rd Round のコース選択で、別のコースに決まった選手のカード（失格ではないので、上の変更前の見た目のまま）
export const COURSE_DONE_FRAME_FILTER = 'grayscale(1) opacity(.55)';
export const COURSE_DONE_NAME_COLOR = '#6E7685';
const BRUSHED_TEXTURE = 'repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0px, rgba(255,255,255,.06) 1px, transparent 1px, transparent 7px)';

export type CardIntroPhase = {
    chassisH: number;
    outerH: number;
    cutClip: string;
    stripH: number;
    badgeTop: number;
    appearOpacity: number;
    appearScale: number;
    CHASSIS_TRANSITION: string;
    HEIGHT_TRANSITION: string;
    CUT_TRANSITION: string;
    STRIP_POS_TRANSITION: string;
    REVEAL_TRANSITION: string;
    revealOpacity: number;
    isExpanding: boolean;
}

/**
 * 3rd Round のクイズ画面カード（10 up-down / Freeze 10 / Swedish 10 / 10 by 10 共通）の
 * 「開扉」イントロ演出。MainSecondRound.tsx の QuizView とまったく同じ手順・タイミングを
 * そのまま流用している（Cowork Design アーティファクトの playIntro() を移植したもの）。
 * コースごとに別アートボードだが演出自体は共通なので、ここに1つだけ用意する。
 */
export function useCardIntroPhase(): CardIntroPhase {
    const [doorPhase, setDoorPhase] = useState<'hidden' | 'collapsed' | 'expanding' | 'open'>('hidden');
    const [noTransition, setNoTransition] = useState(true);

    useEffect(() => {
        // マウント時に一度だけ再生する額縁展開アニメーションの初期化。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDoorPhase('hidden');
        setNoTransition(true);
        const timers = [
            setTimeout(() => { setNoTransition(false); setDoorPhase('hidden'); }, 50),
            setTimeout(() => setDoorPhase('collapsed'), 50 + 300),
            setTimeout(() => setDoorPhase('expanding'), 50 + 300 + 400 + 300),
            setTimeout(() => setDoorPhase('open'), 50 + 300 + 400 + 300 + 700 + 150),
        ];
        return () => timers.forEach(clearTimeout);
    }, []);

    const isAppeared = doorPhase !== 'hidden';
    const isExpanding = doorPhase === 'expanding';
    const isOpen = doorPhase === 'open';
    const isFullHeight = doorPhase === 'expanding' || doorPhase === 'open';
    const revealOpacity = isOpen ? 1 : 0;
    const REVEAL_TRANSITION = noTransition ? 'none' : `opacity .5s ease ${isOpen ? '.1s' : '0s'}`;
    const chassisH = isFullHeight ? FULL_CHASSIS_H : COLLAPSED_CHASSIS_H;
    const outerH = isFullHeight ? FULL_OUTER_H : COLLAPSED_OUTER_H;
    const HEIGHT_TRANSITION = noTransition ? 'none' : 'height .7s cubic-bezier(.22,1,.36,1)';
    const CHASSIS_TRANSITION = noTransition ? 'none' : `${HEIGHT_TRANSITION}, opacity .4s ease, transform .4s cubic-bezier(.22,1,.36,1)`;
    const appearOpacity = isAppeared ? 1 : 0;
    const appearScale = isAppeared ? 1 : 0.82;
    const stripH = isFullHeight ? FULL_STRIP_H : COLLAPSED_STRIP_H;
    const badgeTop = isFullHeight ? FULL_BADGE_TOP : COLLAPSED_BADGE_TOP;
    const STRIP_POS_TRANSITION = noTransition ? 'none' : 'height .7s cubic-bezier(.22,1,.36,1), top .7s cubic-bezier(.22,1,.36,1)';
    const cutClip = buildTopBottomCutClip(CARD_OUTER_W, outerH, CARD_CUT_PAD);
    const CUT_TRANSITION = noTransition ? 'none' : 'clip-path .7s cubic-bezier(.22,1,.36,1)';

    return {
        chassisH, outerH, cutClip, stripH, badgeTop, appearOpacity, appearScale,
        CHASSIS_TRANSITION, HEIGHT_TRANSITION, CUT_TRANSITION, STRIP_POS_TRANSITION,
        REVEAL_TRANSITION, revealOpacity, isExpanding,
    };
}

/** 勝ち抜けた選手の進捗バーの色。2nd Round（MainSecondRound）・3rd Round・Extra Round で共通 */
export const WINNER_BAR_COLOR = 'rgba(255,140,45,.75)';

type PlayerCardFrameProps = {
    phase: CardIntroPhase;
    paperRank: number;
    eliminated: boolean;
    winner: boolean;
    name: string;
    school: string | null;
    grade: string | null;
    /** 枠内下部の進捗バー（%、0〜100）。10問正解系は正解数/10、10 by 10は総合pt/100 */
    pct: number;
    /** 進捗バーの色。省略時は水色(従来どおり) */
    barColor?: string;
    /** inner内、稲妻の後ろに重ねる追加演出（Freeze 10の氷オーバーレイなど） */
    extraOverlay?: React.ReactNode;
    /** 枠の下に出す表示（below）。コースごとに内容が違う */
    belowContent: React.ReactNode;
}

/**
 * 4コース共通のカード額縁。chassis(外枠)→outer(ティアカラー)→cut(縁だけ色付ける切り抜き)→
 * inner(内側の暗い本体)の構造・開扉演出は Cowork Design アーティファクトの4つのMainモック
 * アップで完全に同一だったため、ここに1つだけ用意して全コースで共有する。
 */
export function PlayerCardFrame({ phase, paperRank, eliminated, winner, name, school, grade, pct, barColor = 'rgba(51,198,255,.55)', extraOverlay, belowContent }: PlayerCardFrameProps) {
    const tier = tierOf(paperRank, ACCENT);
    const textOutlineColor = shade(tier.color, -0.35);
    const metalBase = eliminated ? NEUTRAL_FRAME : tier.color;
    const outerFilter = eliminated
        ? ELIMINATED_FRAME_FILTER
        : winner
            ? `drop-shadow(0 0 16px ${tier.glowA}) drop-shadow(0 0 36px ${tier.glowB})`
            : `drop-shadow(0 0 10px ${tier.glowA}) drop-shadow(0 0 24px ${tier.glowB})`;

    // 名前・学校名/学年のフォントサイズ。2nd Roundと同じく、縦書きの高さに収まる
    // 最大サイズをfitFontSizeToWidthで逆算したうえで、名前と学校名・学年の合計が
    // カードの横幅をはみ出す場合は両方を同じ比率で縮めて必ず収める。
    let nameFontSize = fitFontSizeToWidth(name, NAME_ZONE_H, 4, 40, 90);
    const metaCharCount = (school || '未登録').length + (grade || '-').length;
    let metaFontSize = fitFontSizeToWidth('*'.repeat(metaCharCount), META_ZONE_H, 1, 20, 40);
    const nameMetaWidthSum = nameFontSize + metaFontSize;
    if (nameMetaWidthSum + NAME_META_SAFETY_GAP > NAME_META_WIDTH_BUDGET) {
        const shrink = (NAME_META_WIDTH_BUDGET - NAME_META_SAFETY_GAP) / nameMetaWidthSum;
        nameFontSize = Math.max(40, Math.floor(nameFontSize * shrink));
        metaFontSize = Math.max(20, Math.floor(metaFontSize * shrink));
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 172, flexShrink: 0 }}>
            <div style={{ width: 172, height: FULL_CHASSIS_H, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div
                    style={{
                        position: 'relative', width: 172, height: phase.chassisH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        clipPath: OCTAGON_CLIP_PERCENT, background: GUNMETAL_DARK, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.05)',
                        opacity: phase.appearOpacity, transform: `scale(${phase.appearScale})`, transition: phase.CHASSIS_TRANSITION,
                    }}
                >
                    <div
                        style={{
                            position: 'relative', width: CARD_OUTER_W, height: phase.outerH, flexShrink: 0, clipPath: OCTAGON_CLIP_PERCENT,
                            backgroundImage: `${BRUSHED_TEXTURE}, linear-gradient(0deg, ${metalBase}, ${metalBase})`, padding: CARD_CUT_PAD, boxSizing: 'border-box',
                            filter: outerFilter, transition: phase.HEIGHT_TRANSITION,
                        }}
                    >
                        <div style={{ position: 'absolute', inset: 0, background: GUNMETAL_DARK, clipPath: phase.cutClip, transition: phase.CUT_TRANSITION, pointerEvents: 'none' }} />
                        <div
                            style={{
                                position: 'relative', width: '100%', height: '100%', clipPath: OCTAGON_CLIP_PERCENT, overflow: 'hidden',
                                backgroundColor: INNER_BG, backgroundImage: HONEYCOMB_BG, backgroundRepeat: 'repeat', backgroundSize: '56px 100px',
                                boxShadow: 'inset 0 3px 6px rgba(255,255,255,.06), inset 0 -6px 16px rgba(0,0,0,.65), inset 0 0 26px rgba(0,0,0,.35)',
                            }}
                        >
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${pct}%`, background: barColor, opacity: phase.revealOpacity, transition: phase.REVEAL_TRANSITION }} />
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: phase.stripH, backgroundImage: `linear-gradient(90deg, transparent, ${tier.color}, transparent)`, opacity: 0.95, transition: phase.STRIP_POS_TRANSITION }} />
                            <div style={{ position: 'absolute', top: phase.badgeTop, left: 0, right: 0, display: 'flex', justifyContent: 'center', transition: phase.STRIP_POS_TRANSITION }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px 12px', background: 'transparent', border: `3px solid ${tier.color}`, clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)', fontFamily: 'Orbitron,"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 24, color: '#FFFFFF', letterSpacing: 1 }}>
                                    {toOrdinal(paperRank)}
                                </span>
                            </div>
                            {/* 名前は姓を上・名を下に分け、帯の上端からそろえる（2026-11-04 ユーザー指示） */}
                            <div style={{ position: 'absolute', top: 105, left: 0, right: 0, bottom: 36, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', paddingLeft: 9, boxSizing: 'border-box', opacity: phase.revealOpacity, transition: phase.REVEAL_TRANSITION }}>
                                <VerticalSplitName name={name} baseSize={nameFontSize} zoneH={NAME_SPLIT_H}
                                    style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, letterSpacing: 4, color: eliminated ? ELIMINATED_NAME_COLOR : '#F3FAFF', textShadow: eliminated ? outlineShadow(ELIMINATED_NAME_OUTLINE.color, ELIMINATED_NAME_OUTLINE.width) : outlineShadow(textOutlineColor, 1.5) }} />
                            </div>
                            <div style={{ position: 'absolute', top: '16%', right: 9, writingMode: 'vertical-rl', textOrientation: 'upright', display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-start', opacity: phase.revealOpacity, transition: phase.REVEAL_TRANSITION }}>
                                <span style={{ writingMode: 'vertical-rl', textOrientation: 'upright', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: metaFontSize, lineHeight: 1, color: '#FFFFFF', letterSpacing: 1, textShadow: outlineShadow(textOutlineColor, 1.1) }}>
                                    {school || '未登録'}
                                </span>
                                <span style={{ writingMode: 'vertical-rl', textOrientation: 'upright', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: metaFontSize, lineHeight: 1, color: '#FFFFFF', letterSpacing: 1, textShadow: outlineShadow(textOutlineColor, 1.1) }}>
                                    {grade || '-'}
                                </span>
                            </div>
                            <div style={{ position: 'absolute', top: '6%', bottom: '6%', left: '50%', width: 64, transform: 'translateX(-50%)', opacity: phase.isExpanding ? 1 : 0, transition: 'opacity .15s linear', pointerEvents: 'none', zIndex: 6 }}>
                                <LightningBoltsVertical />
                            </div>
                            {extraOverlay}
                        </div>
                    </div>
                </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: phase.revealOpacity, transition: phase.REVEAL_TRANSITION }}>
                {belowContent}
            </div>
        </div>
    );
}

/** 縦書きの選手名で、姓の先頭から名の末尾までの高さ（全員そろえる。キャンバスの値） */
export const NAME_SPLIT_H = 420;

/**
 * 縦書きの選手名（2026-11-04 ユーザー指示）。姓を帯の上端、名を下端に置き、全員の名前の先頭と末尾の高さをそろえる。
 * 姓・名に分けられない名前は上端から1本で出す。文字の大きさは帯の高さに収まるよう splitNameFontSize で決める
 */
export function VerticalSplitName({ name, baseSize, zoneH, style }: { name: string; baseSize: number; zoneH: number; style: CSSProperties }) {
    const { surname, given } = splitName(name);
    const fontSize = splitNameFontSize(name, baseSize, zoneH);
    const span: CSSProperties = { ...style, fontSize, display: 'block', writingMode: 'vertical-rl', textOrientation: 'upright', lineHeight: 1 };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', height: given ? zoneH : 'auto', width: fontSize, flexShrink: 0 }}>
            <span style={span}>{surname}</span>
            {given && <span style={span}>{given}</span>}
        </div>
    );
}
