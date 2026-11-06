"use client";
// クイズ画面の見出しの中央に出す「大会ロゴ ＋ 大会名」（2026-11-06 ユーザー承認）。
// 左がロゴ、右が大会名。見出しの帯（高さ 108px）の上下中央・画面の左右中央に置く（RoundStage）。
// Admin の大会準備の「クイズ画面での見え方」の見本でも同じ部品を使う。
//
// 大会名の長さは入力時に全角12文字（半角24文字）までに抑えている（lib/tournamentName.ts）。
// それでも幅の広い文字（W など）が続いて入りきらないときだけ、字を小さくして収める（省略はしない）。
import { useLayoutEffect, useRef, useState } from "react";
import { BRAND_GAP, BRAND_MAX_W, BRAND_NAME_FONT, brandLogoSize } from "@/lib/tournamentLogo";

export function TournamentBrandView({ name, logoSrc, logoWidth, logoHeight }: {
    name: string;
    /** ロゴの画像の URL（無ければ大会名だけ） */
    logoSrc: string | null;
    logoWidth: number;
    logoHeight: number;
}) {
    const logo = logoSrc ? brandLogoSize(logoWidth, logoHeight) : null;
    const nameMax = BRAND_MAX_W - (logo ? logo.width + BRAND_GAP : 0);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [fontSize, setFontSize] = useState(BRAND_NAME_FONT);
    useLayoutEffect(() => {
        const el = measureRef.current;
        if (!el) return;
        const natural = el.scrollWidth;
        setFontSize(natural > nameMax ? Math.floor(BRAND_NAME_FONT * nameMax / natural) : BRAND_NAME_FONT);
    }, [name, nameMax]);

    if (!name && !logo) return null;
    const nameStyle = {
        fontFamily: '"Noto Sans JP", sans-serif', fontWeight: 700, color: "#FFFFFF", letterSpacing: 1,
        whiteSpace: "nowrap" as const, lineHeight: 1.2,
    };
    return (
        <div data-brand="" style={{ display: "flex", alignItems: "center", gap: BRAND_GAP, maxWidth: BRAND_MAX_W }}>
            {logo && logoSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoSrc} alt="大会ロゴ" width={logo.width} height={logo.height}
                    style={{ display: "block", width: logo.width, height: logo.height, objectFit: "contain", flexShrink: 0 }} />
            )}
            {name && (
                <div style={{ position: "relative", maxWidth: nameMax }}>
                    {/* 幅を測るための見えない写し（もとの字の大きさ） */}
                    <span ref={measureRef} aria-hidden style={{ ...nameStyle, fontSize: BRAND_NAME_FONT, position: "absolute", visibility: "hidden", left: 0, top: 0 }}>{name}</span>
                    <span style={{ ...nameStyle, fontSize, display: "block" }}>{name}</span>
                </div>
            )}
        </div>
    );
}
