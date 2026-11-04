// Main を覆う表示（待機画面・ブランク。2026-11-04 ユーザー承認）の Admin 側の部品。
//   ・coverStartPrimary … 「これから始まる場面」の覆いを進めるボタン（待機画面を消す → ○○を始める）
//   ・ManualStandbyButton … どの場面でも手動で待機画面（PLEASE STAND BY）にするボタン
//   ・AdminMainCoverBar … 運営コンソールに載せ替え前のラウンド用に、上の2つと状況をまとめた帯
// 「クイズを終了する」「待機画面を表示する」など、ラウンドの終わりの操作は各ラウンドの Admin が出す
import type { Socket } from "socket.io-client";
import type { MainCover } from "@/lib/mainCover";
import { NO_COVER, MANUAL_STANDBY_COVER, blankStartCover, describeCover } from "@/lib/mainCover";
import { useMainCover } from "../useMainCover";

/**
 * 覆いが「これから始まる場面」か手動のときの、進行ボタン。それ以外は null（各ラウンドのボタンのまま）
 *   待機画面（start）→「待機画面を消す ▶」でブランクに
 *   ブランク（start）→「○○を始める ▶」で覆いを外す（ラウンドの画面が出る）
 *   手動の待機画面   →「待機画面を消す ▶」で覆いを外す
 */
export function coverStartPrimary(cover: MainCover, setCover: (c: MainCover) => void): { label: string; action: () => void } | null {
    if (cover.kind === 'standby' && cover.at === 'start') {
        return { label: '待機画面を消す ▶', action: () => setCover(blankStartCover(cover.startLabel ?? '画面を表示する')) };
    }
    if (cover.kind === 'blank' && cover.at === 'start') {
        return { label: `${cover.startLabel ?? '画面を表示する'} ▶`, action: () => setCover(NO_COVER) };
    }
    if (cover.at === 'manual') {
        return { label: '待機画面を消す ▶', action: () => setCover(NO_COVER) };
    }
    return null;
}

/** 手動の待機画面ボタン。覆っていないときだけ押せる（外すのは進行ボタンの「待機画面を消す」） */
export function ManualStandbyButton({ cover, setCover, className, style }: {
    cover: MainCover; setCover: (c: MainCover) => void; className?: string; style?: React.CSSProperties;
}) {
    const disabled = cover.kind !== 'none';
    return (
        <button type="button" className={className} style={{ ...style, opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}
            disabled={disabled} onClick={() => setCover(MANUAL_STANDBY_COVER)}
            title="Main を「PLEASE STAND BY」だけの待機画面にします">
            待機画面
        </button>
    );
}

/** 運営コンソールに載せ替える前のラウンド用の帯（画面の上に置く） */
export function AdminMainCoverBar({ socket }: { socket: Socket | null }) {
    const [cover, setCover] = useMainCover(socket);
    const start = coverStartPrimary(cover, setCover);
    const covered = cover.kind !== 'none';
    return (
        <div className="w-full flex flex-wrap items-center gap-4 px-5 py-3"
            style={{ background: covered ? 'rgba(244,178,62,.10)' : '#0B111B', border: `1px solid ${covered ? '#F4B23E' : '#1E2A3B'}`, borderRadius: 8 }}>
            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14, color: '#9CB0C9' }}>Main</span>
            <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 16, color: covered ? '#F4B23E' : '#E8F1FF', flex: 1, minWidth: 0 }}>
                {describeCover(cover)}
            </span>
            {start && (
                <button type="button" onClick={start.action}
                    style={{ padding: '10px 22px', background: 'rgba(60,200,242,.16)', border: '2px solid #3CC8F2', borderRadius: 6, color: '#DFF7FF', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                    {start.label}
                </button>
            )}
            <ManualStandbyButton cover={cover} setCover={setCover}
                style={{ padding: '10px 18px', background: 'transparent', border: '1px solid #3A4B63', borderRadius: 6, color: '#E8F1FF', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 14 }} />
        </div>
    );
}
