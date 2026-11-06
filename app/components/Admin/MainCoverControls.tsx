// Main を覆う表示（待機画面・ブランク。2026-11-04 ユーザー承認）の Admin 側の部品。
//   ・coverStartPrimary … 「これから始まる場面」の覆いを進めるボタン（待機画面を消す → ○○を始める）
//   ・CoverButtons … どの場面でも使える2つの手動の操作
//        「待機画面」 … 手動で PLEASE STAND BY を出す（外すと必ず元の覆いに戻る）
//        「覆いを外す」… 強制解除。どんな覆いでも外して本編に戻す（行き止まりの脱出口。覆っている間だけ出る）
//   ・AdminMainCoverBar … 運営コンソールに載せ替え前のラウンド用に、上の部品と状況をまとめた帯
// 「クイズを終了する」「待機画面を表示する」など、ラウンドの終わりの操作は各ラウンドの Admin が出す
import type { Socket } from "socket.io-client";
import type { CoverTarget, MainCover } from "@/lib/mainCover";
import { NO_COVER, MANUAL_STANDBY_COVER, blankStartCover, describeCover } from "@/lib/mainCover";
import { useMainCover } from "../useMainCover";

/**
 * 覆いが「これから始まる場面」か手動のときの、進行ボタン。それ以外は null（各ラウンドのボタンのまま）
 *   待機画面（start）→「待機画面を消す ▶」でブランクに
 *   ブランク（start）→「○○を始める ▶」で覆いを外す（ラウンドの画面が出る）
 *   手動の待機画面   →「待機画面を消す ▶」で覆いを外す（割り込む前の覆いに戻る）
 */
export function coverStartPrimary(cover: CoverWithBlock, setCover: (c: CoverTarget) => void): { label: string; action: (() => void) | null } | null {
    if (cover.kind === 'standby' && cover.at === 'start') {
        return { label: '待機画面を消す ▶', action: () => setCover(blankStartCover(cover.startLabel ?? '画面を表示する')) };
    }
    // 覆いを外す（ラウンドの画面を出す）操作は、Main の準備ができるまで押せない（2026-11-06。理由と対処はバーの下の帯に出る）
    const released = (label: string) => cover.mainBlock
        ? { label: cover.mainBlock, action: null }
        : { label, action: () => setCover(NO_COVER) };
    if (cover.kind === 'blank' && cover.at === 'start') {
        return released(`${cover.startLabel ?? '画面を表示する'} ▶`);
    }
    if (cover.at === 'manual') {
        return released('待機画面を消す ▶');
    }
    return null;
}

/** Admin の useMainCover が返す覆い（Main の準備ができていないときの理由つき） */
type CoverWithBlock = CoverTarget & { mainBlock?: string | null };

/**
 * 手動の操作の2つ。どちらも「どの場面でも」使える。
 * 待機画面は割り込みなので、すでに手動の待機画面のときだけ押せない（外すのは進行ボタンの「待機画面を消す」）
 */
export function CoverButtons({ cover, setCover, forceRelease, className, style }: {
    cover: CoverWithBlock; setCover: (c: CoverTarget) => void; forceRelease: () => void;
    className?: string; style?: React.CSSProperties;
}) {
    const isManual = cover.at === 'manual';
    return (
        <>
            <button type="button" className={className} style={{ ...style, opacity: isManual ? 0.45 : 1, cursor: isManual ? 'default' : 'pointer' }}
                disabled={isManual} onClick={() => setCover(MANUAL_STANDBY_COVER)}
                title="Main を「PLEASE STAND BY」だけの待機画面にします。外すと、直前の表示に戻ります">
                待機画面
            </button>
            {cover.kind !== 'none' && (
                <button type="button" className={className} style={style}
                    onClick={() => {
                        const msg = cover.mainBlock
                            ? `Main の準備ができていません（${cover.mainBlock}）。\n覆いを外しても、必要なデータがそろうまで会場の画面は黒いままです。外しますか？`
                            : 'Main の待機画面・ブランクを外して、いまのラウンドの画面をすぐ表示します。よろしいですか？';
                        if (window.confirm(msg)) forceRelease();
                    }}
                    title="どの覆いでも外して、ラウンドの画面を表示します（進行が行き止まりになったときの脱出口）">
                    覆いを外す
                </button>
            )}
        </>
    );
}

/** 運営コンソールに載せ替える前のラウンド用の帯（画面の上に置く） */
export function AdminMainCoverBar({ socket }: { socket: Socket | null }) {
    const [cover, setCover, { forceRelease }] = useMainCover(socket);
    const start = coverStartPrimary(cover, setCover);
    const covered = cover.kind !== 'none';
    const btn: React.CSSProperties = { padding: '10px 18px', background: 'transparent', border: '1px solid #3A4B63', borderRadius: 6, color: '#E8F1FF', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14 };
    return (
        <div className="w-full flex flex-wrap items-center gap-4 px-5 py-3"
            style={{ background: covered ? 'rgba(244,178,62,.10)' : '#0B111B', border: `1px solid ${covered ? '#F4B23E' : '#1E2A3B'}`, borderRadius: 8 }}>
            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, color: '#9CB0C9' }}>Main</span>
            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 16, color: covered ? '#F4B23E' : '#E8F1FF', flex: 1, minWidth: 0 }}>
                {describeCover(cover)}
            </span>
            {start && (
                <button type="button" onClick={start.action ?? undefined} disabled={!start.action}
                    style={{ padding: '10px 22px', background: 'rgba(60,200,242,.16)', border: '2px solid #3CC8F2', borderRadius: 6, color: '#DFF7FF', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                    {start.label}
                </button>
            )}
            <CoverButtons cover={cover} setCover={setCover} forceRelease={forceRelease} style={btn} />
        </div>
    );
}

/** 型の再エクスポート（呼び出し側が lib/mainCover から二重に import しなくて済むように） */
export type { MainCover };
