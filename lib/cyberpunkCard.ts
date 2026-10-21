/**
 * 「サイバーパンク」デザインシステムの共通部品。
 *
 * 2nd Round (MainSecondRound.tsx / AdminSecondRound.tsx) で最初に作り込んだ見た目を、
 * 他のラウンドでも一貫させるためにここへ切り出している。ラウンドごとの選手カードは
 * 色・縁取り・八角形カットの寸法だけが違うことが多く、その計算式をここに置くことで
 * 次のラウンドのカードもここを import するだけで同じ質感になる。
 *
 * 詳しい経緯・使い方は `docs/visual-design-system.md` を参照。
 */

/** デザインシステム全体のアクセント色（見出し下線、5〜12位帯の色など）。ラウンドをまたいで統一する */
export const ACCENT = "#2F7BFF";

/** カードの内側背景（ほぼ黒） */
export const GUNMETAL_DARK = "#1D1F20";
/** カードの内側背景（ほぼ黒） */
export const INNER_BG = "#1A1A1A";

/**
 * Turn Over のカード枠だけに使う、やや明るいガンメタル。Quiz View 側は制作過程で
 * 黒に近づける調整が入ったが(#3A3F46→…→#1D1F20)、Turn Over 側のアーティファクトは
 * 調整前の値のまま。見た目をアーティファクトと完全に一致させるため、あえて
 * 統一せずこの専用定数として残している。
 */
export const GUNMETAL_MID = "#3A3F46";

/**
 * 内側背景に重ねる、ごく薄い白のハニカム（六角形）線パターン。
 * data URI 化した SVG を background-image として敷く。
 */
export const HONEYCOMB_BG =
    "url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2756%27%20height=%27100%27%20viewBox=%270%200%2056%20100%27%3E%3Cpath%20d=%27M28%2066L0%2050L0%2016L28%200L56%2016L56%2050L28%2066L28%20100%27%20fill=%27none%27%20stroke=%27white%27%20stroke-width=%271%27%20stroke-opacity=%270.16%27/%3E%3Cpath%20d=%27M28%200L28%2034L0%2050L0%2084L28%20100L56%2084L56%2050L28%2034%27%20fill=%27none%27%20stroke=%27white%27%20stroke-width=%271%27%20stroke-opacity=%270.16%27/%3E%3C/svg%3E')";

/** ペーパー順位帯ごとの色。境界(4/12/24)は lib/advantage.ts のアドバンテージ区分と同じ */
export type Tier = { color: string; glowA: string; glowB: string };

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const num = parseInt(hex.replace("#", ""), 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/**
 * 明るく/暗くした色を rgb() 文字列で返す。amt は -1〜1（負で暗く、正で明るく）。
 * 縁取り色を少し暗くする、などに使う。
 */
export function shade(hex: string, amt: number): string {
    const num = parseInt(hex.replace("#", ""), 16);
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    const adj = (c: number) => {
        const v = amt < 0 ? c * (1 + amt) : c + (255 - c) * amt;
        return Math.max(0, Math.min(255, Math.round(v)));
    };
    return `rgb(${adj(r)},${adj(g)},${adj(b)})`;
}

/**
 * ペーパー順位からその帯の色を返す。2〜12位帯だけは accent(見出し下線の色)と
 * 常に同じ色になるようにしていて、accent を変えると自動で連動する。
 * 1〜4位: 赤 / 5〜12位: accent / 13〜24位: 黄 / 25〜48位: 緑 / 49位〜: 紫
 * （49位以下＝2nd Round に進めず Extra Round から出る選手。2026-10-11 のユーザー指示で紫を追加。
 *  Extra Round の Main の見出し下線も同じ紫 TIER_PURPLE にそろえている）
 */
export function tierOf(rank: number, accent: string): Tier {
    if (rank <= 4) return { color: "#FF3B5C", glowA: "rgba(255,59,92,.55)", glowB: "rgba(255,59,92,.28)" };
    if (rank <= 12) {
        const ac = hexToRgb(accent);
        return { color: accent, glowA: `rgba(${ac.r},${ac.g},${ac.b},.55)`, glowB: `rgba(${ac.r},${ac.g},${ac.b},.28)` };
    }
    if (rank <= 24) return { color: "#FFC93C", glowA: "rgba(255,201,60,.55)", glowB: "rgba(255,201,60,.28)" };
    if (rank <= 48) return { color: "#35FFA0", glowA: "rgba(53,255,160,.5)", glowB: "rgba(53,255,160,.25)" };
    return { color: TIER_PURPLE, glowA: "rgba(185,139,255,.55)", glowB: "rgba(185,139,255,.28)" };
}

/** 49位以下の順位帯の色（Extra Round の見出し下線にも使う） */
export const TIER_PURPLE = "#B98BFF";

/**
 * CJK文字向けの「本当の輪郭線」用 text-shadow を作る。同じ色のコピーを円状に w px
 * オフセットして重ねることで、複数画数からなる漢字でも文字全体の外形をなぞった
 * 縁取りになる（-webkit-text-stroke は画数ごとに縁取ってしまい、漢字では隙間が空く）。
 */
export function outlineShadow(color: string, w: number): string {
    const n = 14;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n;
        const dx = (w * Math.cos(angle)).toFixed(2);
        const dy = (w * Math.sin(angle)).toFixed(2);
        parts.push(`${dx}px ${dy}px 0 ${color}`);
    }
    return parts.join(", ");
}

/**
 * 縦長カード（Quiz View）向けの八角形 clip-path。パーセンテージ指定なので、
 * 高さが登場アニメーションで変化してもこの1つの定数のまま歪まない。
 */
export const OCTAGON_CLIP_PERCENT =
    "polygon(20% 1%,80% 1%,95% 4.5%,95% 95.5%,80% 99%,20% 99%,5% 95.5%,5% 4.5%)";

/**
 * カードの「金属の縁」だけを色付きに見せるためのガンメタル重ね(cut)の clip-path。
 * 外側八角形(outerW × outerH)の頂点から、内側八角形(cutPad ぶん内側)の対応する
 * 頂点へ斜めにつなぐことで、額縁の縁だけが色付きに残る。Quiz View 用(縦方向に
 * 頂点を打つ版)。Turn Over 用は buildSideCutClip を使う。
 */
export function buildTopBottomCutClip(outerW: number, outerH: number, cutPad: number): string {
    const innerH = outerH - cutPad * 2;
    const oy1 = 0.045 * outerH, oy2 = 0.955 * outerH;
    const ox1 = 0.05 * outerW, ox2 = 0.95 * outerW;
    const iy1 = cutPad + 0.045 * innerH, iy2 = cutPad + 0.955 * innerH;
    const ix1 = cutPad + 0.05 * (outerW - cutPad * 2), ix2 = cutPad + 0.95 * (outerW - cutPad * 2);
    const pt = (x: number, y: number) => `${x.toFixed(2)}px ${y.toFixed(2)}px`;
    return `polygon(${[pt(ox1, oy1), pt(ix1, iy1), pt(ix2, iy1), pt(ox2, oy1), pt(ox2, oy2), pt(ix2, iy2), pt(ix1, iy2), pt(ox1, oy2)].join(", ")})`;
}

/** 横長カード（Turn Over）向けの、角を均等に斜めカットした八角形 clip-path */
export function chamferClip(w: number, h: number, chamfer = 16): string {
    const c = chamfer;
    return `polygon(${c}px 0,${w - c}px 0,${w}px ${c}px,${w}px ${h - c}px,${w - c}px ${h}px,${c}px ${h}px,0 ${h - c}px,0 ${c}px)`;
}

/**
 * buildTopBottomCutClip の横長版(Turn Over 用)。カードの高さは伸縮しないため、
 * 変化するのは幅(w)だけで、Y座標は固定でよい。左右の辺だけ色付きが見える。
 */
export function buildSideCutClip(w: number, cardH: number, cutPad: number, chamfer = 16): string {
    const outerX1 = chamfer, outerX2 = w - chamfer;
    const innerX1 = cutPad + chamfer, innerX2 = w - cutPad - chamfer;
    return (
        `polygon(${outerX1}px 0px, ${innerX1}px ${cutPad}px, ${innerX1}px ${cardH - cutPad}px, ${outerX1}px ${cardH}px, ` +
        `${outerX2}px ${cardH}px, ${innerX2}px ${cardH - cutPad}px, ${innerX2}px ${cutPad}px, ${outerX2}px 0px)`
    );
}

/**
 * 文字数に応じて「枠の横幅(縦書きなら高さ)にちょうど収まる」フォントサイズを逆算する。
 * 文字数が少ないほど大きく、多いほど小さくなる。全角の日本語文字はほぼ正方形
 * (1文字 ≒ 1em)として見積もる。MainSecondRound(会場画面)と AdminSecondRound
 * (進行卓の正誤判定画面)の両方で、選手名を6文字級まではみ出させずに表示するために使う
 * (2026-09-26、元は MainSecondRound.tsx にのみあったものをここへ集約)。
 */
export function fitFontSizeToWidth(text: string, availWidth: number, letterSpacing: number, minSize: number, maxSize: number): number {
    const n = Math.max(1, Array.from(text || '').length);
    const raw = Math.floor((availWidth - (n - 1) * letterSpacing) / n);
    return Math.max(minSize, Math.min(maxSize, raw));
}
