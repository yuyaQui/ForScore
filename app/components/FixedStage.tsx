import { useEffect, useRef, useState } from "react";

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
export default function FixedStage({ children }: Props) {
    const outerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
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
