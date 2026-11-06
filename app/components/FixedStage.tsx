import { useLayoutEffect, useRef, useState } from "react";

type Props = {
    children: React.ReactNode;
};

const STAGE_W = 1920;
const STAGE_H = 1080;

/**
 * 会場のスクリーン表示（Main画面）を 1920×1080 固定のキャンバスとして描画し、
 * 実際のウィンドウ／モニターのサイズに合わせて transform:scale() で拡大縮小する。
 *
 * Design アーティファクトで作り込んだ見た目（px単位の八角形カット、電撃エフェクトなど）
 * をそのまま実装に持ち込めるようにするための土台。会場のスクリーンは常に16:9で運用する
 * 前提（2026-09-25 決定。詳細は docs/visual-design-system.md）。他ラウンドのMain画面も
 * これで包む形に統一する。
 */
/**
 * 最初の描画から正しい倍率を使うための初期値（2026-11-06）。この部品は position:fixed で表示領域いっぱいを占めるので、
 * 大きさは窓の大きさと同じ。サーバ側の描画（window がない）では 1。
 * （覆いを外した直後などにラウンドの画面が新しくマウントされるとき、倍率 1 のまま1コマ描かれて、画面が大きく映っていた）
 */
function initialScale(): number {
    if (typeof window === "undefined" || window.innerWidth <= 0 || window.innerHeight <= 0) return 1;
    return Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
}

export default function FixedStage({ children }: Props) {
    const outerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(initialScale);

    // useLayoutEffect: 最初の描画の前に、実際の大きさで倍率を決め直す（useEffect だと描画のあとになる）
    useLayoutEffect(() => {
        const outer = outerRef.current;
        if (!outer) return;

        const updateScale = () => {
            const { width, height } = outer.getBoundingClientRect();
            // 16:9 前提だが、万一縦横比がズレても上下 or 左右が黒く余るだけで
            // 中身が画面からはみ出さないよう、小さいほうの比率を採用する
            setScale(Math.min(width / STAGE_W, height / STAGE_H));
        };

        updateScale();
        const observer = new ResizeObserver(updateScale);
        observer.observe(outer);
        return () => observer.disconnect();
    }, []);

    return (
        // position:fixed で常にブラウザの表示領域いっぱいを占める。MainSecondRound の
        // 呼び出し元(app/main/page.tsx)は他ラウンド用に padding 付きの flex コンテナに
        // なっているが、fixed にすることでその制約を受けずに済み、他ラウンドの見た目にも
        // 影響しない。
        <div
            ref={outerRef}
            style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000000", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 0 }}
        >
            <div style={{ width: STAGE_W, height: STAGE_H, flexShrink: 0, transform: `scale(${scale})`, transformOrigin: "center center" }}>
                {children}
            </div>
        </div>
    );
}
