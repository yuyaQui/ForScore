import { useEffect, useMemo, useState } from "react";
import { REVEAL_START_DELAY_MS, REVEAL_TAIL_MS, revealStepMs, splitGraphemes } from "@/lib/revealText";

type Props = {
    text: string;
    /** 中身を出してよいか。false の間は場所だけ確保して何も見せない */
    revealed: boolean;
    /** 1文字ごとの間隔の上限（短い文はこの速さで現れる） */
    maxStepMs: number;
    /** 全体にかける時間の上限（長い文は、これに収まるよう速くなる） */
    totalMaxMs: number;
    /** 現れた直後の数文字を包む色とグロー */
    freshColor: string;
    freshShadow: string;
};

/**
 * 文字が1文字ずつ徐々に現れる表示（Extra Round の問題文・解答）。
 *
 * - revealed が false → true に変わったのを見たときだけアニメーションする。
 *   最初から true（Main のリロード・別のステップへ移動・「ひとつ戻る」）のときは
 *   アニメーションなしで即座に全文を出す。
 * - false の間は visibility:hidden で同じ文を置き、行の折り返しや枠の大きさが
 *   表示のあとで変わらないようにする（内容は見えない）。
 * - 1文字ずつ <span>（display:inline のまま）に分けて opacity / blur / 位置を変える。
 *   inline-block にすると、1文字ごとが別の部品とみなされて禁則処理（句読点が行頭に来ない）
 *   が効かなくなり、アニメーション後の折り返しと変わってしまうため。
 * - 出きって少し待ったら、1文字ずつの span をやめて通常の文字表示に戻す。
 */
export default function RevealText({ text, revealed, maxStepMs, totalMaxMs, freshColor, freshShadow }: Props) {
    const chars = useMemo(() => splitGraphemes(text), [text]);
    const count = chars.length;
    const stepMs = revealStepMs(count, maxStepMs, totalMaxMs);
    const delayTicks = Math.round(REVEAL_START_DELAY_MS / stepMs);
    const tailTicks = Math.ceil(REVEAL_TAIL_MS / stepMs);

    // progress: アニメーション中の進み具合（tick 数）。null = アニメーションしていない。
    // 負の値は「最初の文字が出るまでの待ち」。
    // 描画中に前回の revealed と比べて切り替える（React 公式の「props 変更に合わせて state を
    // 調整する」書き方）。effect 内で同期的に setState すると1フレーム古い表示が出るため。
    const [prevRevealed, setPrevRevealed] = useState(revealed);
    const [progress, setProgress] = useState<number | null>(null);
    if (revealed !== prevRevealed) {
        setPrevRevealed(revealed);
        setProgress(revealed && count > 0 ? -delayTicks : null);
    }

    const animating = progress !== null;
    useEffect(() => {
        if (!animating) return;
        const id = setInterval(() => {
            setProgress(p => (p === null || p + 1 >= count + tailTicks ? null : p + 1));
        }, stepMs);
        return () => clearInterval(id);
    }, [animating, count, tailTicks, stepMs]);

    if (!revealed) {
        return <span aria-hidden style={{ visibility: 'hidden' }}>{text}</span>;
    }
    if (progress === null) {
        return <>{text}</>;
    }

    const shown = Math.min(count, Math.max(0, progress));
    const inProgress = shown < count;
    return (
        <>
            {chars.map((ch, i) => {
                const on = i < shown;
                const fresh = on && inProgress && i >= shown - 3;
                return (
                    <span
                        key={i}
                        style={{
                            position: 'relative',
                            top: on ? 0 : 14,
                            opacity: on ? 1 : 0,
                            filter: `blur(${on ? 0 : 10}px)`,
                            color: fresh ? freshColor : undefined,
                            textShadow: fresh ? freshShadow : undefined,
                            transition: 'opacity .5s ease-out, filter .5s ease-out, top .5s ease-out, color .7s, text-shadow .7s',
                        }}
                    >
                        {ch}
                    </span>
                );
            })}
        </>
    );
}

type WholeProps = {
    text: string;
    /** 中身を出してよいか。false の間は場所だけ確保して何も見せない */
    revealed: boolean;
    /** 現れる瞬間に全体を包む色とグロー。省略すると色は変えない（問題文。2026-10-11 ユーザー指示） */
    freshColor?: string;
    freshShadow?: string;
    /** 現れ始めるまでの待ち時間（省略時は RevealText と同じ） */
    delayMs?: number;
};

/** 全体がふわっと現れるのにかける時間 */
const WHOLE_FADE_MS = 700;
/** 現れたあと、グローを保つ時間 */
const WHOLE_GLOW_HOLD_MS = 500;
/** グローが消えるのにかける時間（RevealText の色の戻りと同じ） */
const WHOLE_GLOW_FADE_MS = 700;

/**
 * 文全体が一度に現れる表示（Extra Round の問題文。2026-10-11 のユーザー指示で、
 * 1文字ずつではなく全体が一度に現れるようにした）。
 * 切り替えの考え方（false → true を見たときだけアニメーションする、false の間は
 * visibility:hidden で場所を確保する）は RevealText と同じ。
 * 見え方は RevealText の1文字分と同じ（ぼかし＋少し下から＋グロー）を文全体にかける。
 */
export function RevealWhole({ text, revealed, freshColor, freshShadow, delayMs = REVEAL_START_DELAY_MS }: WholeProps) {
    // phase: null = アニメーションしていない / 'hidden' = 出る直前 / 'shown' = 出た直後（グローあり）
    // / 'settling' = グローが消えていく途中
    const [prevRevealed, setPrevRevealed] = useState(revealed);
    const [phase, setPhase] = useState<'hidden' | 'shown' | 'settling' | null>(null);
    if (revealed !== prevRevealed) {
        setPrevRevealed(revealed);
        setPhase(revealed && text.length > 0 ? 'hidden' : null);
    }

    useEffect(() => {
        if (phase === null) return;
        const next = { hidden: 'shown', shown: 'settling', settling: null } as const;
        const wait = { hidden: delayMs, shown: WHOLE_FADE_MS + WHOLE_GLOW_HOLD_MS, settling: WHOLE_GLOW_FADE_MS }[phase];
        const id = setTimeout(() => setPhase(next[phase]), wait);
        return () => clearTimeout(id);
    }, [phase, delayMs]);

    if (!revealed) {
        return <span aria-hidden style={{ visibility: 'hidden' }}>{text}</span>;
    }
    if (phase === null) {
        return <>{text}</>;
    }
    const on = phase !== 'hidden';
    const glow = phase !== 'settling';
    return (
        <span
            style={{
                position: 'relative',
                top: on ? 0 : 14,
                opacity: on ? 1 : 0,
                filter: `blur(${on ? 0 : 10}px)`,
                color: glow ? freshColor : undefined,
                textShadow: glow ? freshShadow : undefined,
                transition: `opacity ${WHOLE_FADE_MS}ms ease-out, filter ${WHOLE_FADE_MS}ms ease-out, top ${WHOLE_FADE_MS}ms ease-out, color ${WHOLE_GLOW_FADE_MS}ms, text-shadow ${WHOLE_GLOW_FADE_MS}ms`,
            }}
        >
            {text}
        </span>
    );
}
