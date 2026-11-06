// 大会準備（モード waiting）の Admin。大会名・案内テキスト・問題データを用意して、1st Round（または進行中のラウンド）へ進む。
// 2026-11-05: 運営コンソール（console/）に載せ替え。
//   上のバー … Main に出ている画面・Main を覆う操作・次の操作（1本道。進行中のラウンドがあればそこへ再開）
//   作業面   … 左に大会名と案内テキスト、右に問題データの取り込み
// サーバを再起動すると表示モードが大会準備に戻る。そのとき、DB の結果から見た「いま進めるべきラウンド」を
// 進行ボタンに出す（以前の RESUME の帯の役目）。すでに結果が入っているラウンドへは resume で移る（サイドバーと同じ。会場にいきなり画面を出さない）。
import { Socket } from "socket.io-client";
import { ROUND_LABEL, ROUND_MODE, canEnterRound, currentRoundFromData } from "@/lib/roundProgress";
import { describeCover } from "@/lib/mainCover";
import { ConsoleFrame, WorkHead, MetaItem } from "./console/ConsoleFrame";
import { SideLog } from "./console/SideLog";
import { useActionLog } from "./console/useActionLog";
import styles from "./console/console.module.css";
import { useMainCover } from "../useMainCover";
import { coverStartPrimary, CoverButtons } from "./MainCoverControls";
import { useRoundProgress } from "./roundProgressContext";
import AdminTournamentName from "./AdminTournamentName";
import AdminTournamentLogo from "./AdminTournamentLogo";
import AdminText from "./AdminText";
import AdminQuestionPoolUpload from "./AdminQuestionPoolUpload";

export default function AdminWaiting({ socket, onChangeMode }: {
    socket: Socket | null;
    onChangeMode: (mode: string, resume?: boolean) => void;
}) {
    const progress = useRoundProgress();
    const [cover, setCover, coverControls] = useMainCover(socket);
    const actionLog = useActionLog();

    // 進める先: 結果が入っている最後のラウンド（完了していれば次）。何も始まっていなければ 1st Round
    const target = progress ? (currentRoundFromData(progress.statuses) ?? 'firstRound') : null;
    const targetStatus = progress && target ? progress.statuses[target] : null;
    const gate = progress && target ? canEnterRound(progress.statuses, target) : null;
    const resume = !!targetStatus && targetStatus.started;

    let primaryLabel: string;
    let primaryAction: (() => void) | null = null;
    const coverStart = coverStartPrimary(cover, setCover);
    if (coverStart) {
        primaryLabel = coverStart.label;
        primaryAction = coverStart.action;
    } else if (!progress || !target) {
        primaryLabel = '読み込み中...';
    } else if (gate && !gate.ok) {
        primaryLabel = `${ROUND_LABEL[target]} へ（${gate.reason}）`;
    } else {
        primaryLabel = `${ROUND_LABEL[target]} へ ▶`;
        primaryAction = () => { onChangeMode(ROUND_MODE[target], resume); };
    }

    return (
        <ConsoleFrame
            onAir="大会準備"
            onAirDetail={cover.kind !== 'none' ? describeCover(cover) : '案内テキストを表示中'}
            barExtra={<CoverButtons cover={cover} setCover={setCover} forceRelease={coverControls.forceRelease} className={styles.btn} />}
            undo={null}
            next={{ label: primaryLabel, onClick: primaryAction }}
            side={<SideLog log={actionLog.entries} empty="この画面での操作の記録はありません（大会名・案内テキスト・問題データは、保存や取り込みの結果が画面の上に出ます）" />}
        >
            <WorkHead
                meta={<>
                    <MetaItem label="大会名 " value={progress?.tournamentName || '未設定'} />
                    {targetStatus && target && <MetaItem label="進行 " value={resume ? `${ROUND_LABEL[target]} ${targetStatus.detail}` : '未開始'} />}
                </>}
            />
            <div className={styles.prepGrid}>
                <div className={styles.prepCol}>
                    <AdminTournamentName socket={socket} />
                    {/* 大会ロゴ（2026-11-06。大会名の下） */}
                    <AdminTournamentLogo socket={socket} />
                    <AdminText socket={socket} />
                </div>
                <AdminQuestionPoolUpload />
            </div>
        </ConsoleFrame>
    );
}
