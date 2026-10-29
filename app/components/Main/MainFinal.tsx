import { Socket } from "socket.io-client";
import { useState, useEffect } from "react";
import type { Player, FinalState } from "@/lib/types";
import { DEFAULT_FINAL_STATE } from "@/lib/types";
import { getFinalists } from "@/lib/finalProfile";
import { FinalProfile } from "./FinalProfile";
import { ACCENT, tierOf } from "@/lib/cyberpunkCard";
import { toOrdinal } from "@/lib/ordinal";
import { photoUrl, type SemifinalProfile } from "@/lib/semifinalProfile";
import FixedStage from "@/app/components/FixedStage";
import { RoundStage } from "./RoundStage";
import { WINNER_BAR_COLOR } from "./PlayerCardFrame";
import { FinalCard } from "./FinalCard";
import { BELOW_NUMBER_FONT, BELOW_NUMBER_H, BELOW_MARK_FONT, BELOW_MARK_W, BELOW_MARK_H } from "@/app/components/Main/belowSizes";

type Props = {
    socket: Socket | null;
}

// 決勝（Triple Seven）の Main 画面。2026-10-15 にサイバーパンクのデザインへ作り直した。
//
// 設計メモ 決定事項5: 準決勝と違い quiz/results の切り替えは行わず、
// 正解数・誤答数・獲得セット数を常にリアルタイムで表示する。タイマーも持たない（決定事項3）。
//
// 対象3名は新しい列を持たず、準決勝の勝ち抜け（semifinalRank > 0）から導出する。
// 並び順は準決勝の勝ち抜け順（決定事項1）＝ semifinalRank 昇順。
//
// 表示（2026-10-15 ユーザー指示）:
//   - カードは画面幅いっぱいに3枚。写真は準決勝で登録したもの、名前は1行
//   - 獲得セット数はカードの写真の右側に、ひし形3つ（下から点灯）
//   - 正解数と誤答（× と ・）は 2nd Round と同じくカードの下
//   - そのセットで3誤答した選手はグレー（正解数は順位判定に使うので残す）
//   - 見出し下の線は 1〜4位の順位帯の赤
//
// 表示の段階（2026-10-17 追加。docs/final-design.md 8章）:
//   standby … 待機。何も表示しない（ユーザー指示）
//   intro   … 選手紹介。準決勝の勝ち抜け順に1人ずつ、写真・二つ名・プロフィール・それまでの成績
//   quiz    … クイズ（3名のカード）
//   result  … 最終成績。選手紹介に Final の成績を足したもの
//
// 7問正解・3誤答の上限値は lib/finalScoring.ts の非公開定数と同じ値を表示用にここでも持つ。
const SET_WIN_CORRECT_COUNT = 7;
const SET_ELIMINATE_WRONG_COUNT = 3;

const GOLD = '#FFC93C';

export default function MainFinal(props: Props) {
    const { socket } = props;

    const [players, setPlayers] = useState<Player[]>([]);
    const [finalState, setFinalState] = useState<FinalState>(DEFAULT_FINAL_STATE);
    const [profiles, setProfiles] = useState<SemifinalProfile[]>([]);

    useEffect(() => {
        const loadProfiles = () => {
            fetch('/api/semifinal/profiles').then(res => res.json()).then(data => {
                if (data.success) setProfiles(data.profiles);
            }).catch(err => console.error('Failed to load semifinal profiles', err));
        };
        fetch('/api/secondRound/loadPlayers').then(res => res.json()).then(data => {
            if (data.success) setPlayers(data.allPlayers);
        });
        loadProfiles();

        if (socket) {
            const handleStateUpdate = (state: FinalState) => setFinalState(state);
            const handlePlayersUpdate = (allPlayers: Player[]) => setPlayers(allPlayers);

            socket.on("update_final_state", handleStateUpdate);
            socket.on("update_players", handlePlayersUpdate);
            socket.on("update_semifinal_profiles", loadProfiles);
            // 接続直後の配信はこの画面が無いうちに届いて失われるので、表示した時点で取り直す
            socket.emit("request_final_sync");

            return () => {
                socket.off("update_final_state", handleStateUpdate);
                socket.off("update_players", handlePlayersUpdate);
                socket.off("update_semifinal_profiles", loadProfiles);
            };
        }
    }, [socket]);

    const finalPlayers = getFinalists(players);
    const profileOf = (id: number) => profiles.find(p => p.playerId === id);
    const decided = finalPlayers.some(p => p.finalRank > 0);
    const view = finalState.view;
    const introPlayer = finalPlayers[finalState.introIndex] ?? null;
    const resultPlayer = finalPlayers.find(p => p.finalRank === finalState.resultRank) ?? null;
    const ruleColor = tierOf(1, ACCENT).color;

    // クイズ画面: 見出し → 問題欄 → 仕切り線 → カードの位置を全ラウンドでそろえる（RoundStage。2026-10-22）
    if (view === 'quiz') {
        return (
            <FixedStage>
                <RoundStage socket={socket} round="final" ruleColor={ruleColor} contentW={1776} contentH={FINAL_CONTENT_H}
                    header={<FinalHeader right={<span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 40, letterSpacing: 3, color: ACCENT }}>SET {finalState.set}</span>} />}>
                <div style={{ width: 1776, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 54 }}>
                    {finalPlayers.map(player => {
                        const correct = player.finalCorrectCount;
                        const wrong = player.finalWrongCount;
                        const champion = player.finalRank === 1;
                        // そのセットのみ失格。順位が決まった後はグレーにしない
                        const out = !decided && wrong >= SET_ELIMINATE_WRONG_COUNT;
                        const pct = champion ? 100 : (Math.min(correct, SET_WIN_CORRECT_COUNT) / SET_WIN_CORRECT_COUNT) * 100;
                        return (
                            <div key={player.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <FinalCard
                                    paperRank={player.paperRank} name={player.name} school={player.school} grade={player.grade}
                                    photo={photoUrl(profiles.find(p => p.playerId === player.id))}
                                    setsWon={player.finalSetsWon} pct={pct} eliminated={out} winner={champion}
                                    barColor={champion ? WINNER_BAR_COLOR : undefined}
                                />
                                {/* 2nd Round と同じ: 正解数（大きな数字）と誤答（× と ・、3回でそのセット失格） */}
                                <div style={{ marginTop: 16, height: BELOW_NUMBER_H, lineHeight: `${BELOW_NUMBER_H}px`, fontFamily: 'Orbitron, sans-serif', fontSize: BELOW_NUMBER_FONT, fontWeight: 800, letterSpacing: 1, color: out ? '#8A93A3' : '#EAF6FF', fontVariantNumeric: 'tabular-nums' }}>
                                    {correct}
                                </div>
                                <div style={{ display: 'flex', gap: 14, marginTop: 4, height: BELOW_MARK_H, alignItems: 'center' }}>
                                    {Array.from({ length: SET_ELIMINATE_WRONG_COUNT }, (_, i) => (
                                        <span key={i} style={{ width: BELOW_MARK_W, height: BELOW_MARK_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: BELOW_MARK_FONT, lineHeight: 1, fontWeight: 700, color: i < wrong ? '#FF4D6D' : '#3A5170' }}>
                                            {i < wrong ? '×' : '・'}
                                        </span>
                                    ))}
                                </div>
                                {/* 最終順位（決まった後だけ。高さは常に確保して位置がずれないようにする） */}
                                <div style={{ height: 56, marginTop: 6, fontFamily: 'Orbitron, sans-serif', fontSize: 44, fontWeight: 900, letterSpacing: 3, color: champion ? GOLD : '#9FB4D6', textShadow: champion ? `0 0 18px ${GOLD}99` : undefined }}>
                                    {player.finalRank > 0 ? (champion ? 'CHAMPION' : toOrdinal(player.finalRank)) : ''}
                                </div>
                            </div>
                        );
                    })}
                    {finalPlayers.length === 0 && (
                        <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 700, fontSize: 28, color: '#5C7EA6' }}>
                            決勝進出者が確定していません。
                        </span>
                    )}
                </div>
                </RoundStage>
            </FixedStage>
        );
    }

    return (
        <FixedStage>
            <div style={{
                width: 1920, height: 1080, boxSizing: 'border-box', padding: '56px 72px', backgroundColor: '#000000',
                display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', fontFamily: "'Rajdhani',sans-serif",
            }}>
                {/* 待機中は何も表示しない（2026-10-17 ユーザー指示） */}
                {view !== 'standby' && (<>
                <FinalHeader />
                {/* 見出し下の線は、1〜4位の順位帯の赤（選手枠の赤）にそろえる（2026-10-15 ユーザー指示） */}
                <div style={{ height: 2, marginTop: 26, background: ruleColor, boxShadow: `0 0 12px ${ruleColor}73`, flexShrink: 0 }} />

                </>)}
                {view === 'intro' && introPlayer && (
                    <FinalProfile key={`intro-${finalState.introIndex}`} player={introPlayer} index={finalState.introIndex}
                        nickname={profileOf(introPlayer.id)?.nickname ?? ''} photo={photoUrl(profileOf(introPlayer.id))} place={null} />
                )}
                {view === 'result' && resultPlayer && (
                    <FinalProfile key={`result-${finalState.resultRank}`} player={resultPlayer} index={finalPlayers.indexOf(resultPlayer)}
                        nickname={profileOf(resultPlayer.id)?.nickname ?? ''} photo={photoUrl(profileOf(resultPlayer.id))} place={finalState.resultRank} />
                )}
            </div>
        </FixedStage>
    );
}

/** 見出し「Final / Triple Seven」。right は右端に出すもの（クイズ中の SET 番号） */
function FinalHeader({ right }: { right?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>Final</div>
                <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 50, color: '#F3FAFF', letterSpacing: 1 }}>Triple Seven</div>
            </div>
            {right}
        </div>
    );
}

/** カード（574）＋ 正解数（16＋70）＋ 誤答（4＋70）＋ 最終順位（6＋56）。RoundStage の縮小の基準（2026-10-22） */
const FINAL_CONTENT_H = 574 + 16 + BELOW_NUMBER_H + 4 + BELOW_MARK_H + 6 + 56;
