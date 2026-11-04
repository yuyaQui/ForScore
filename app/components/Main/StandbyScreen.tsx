// 共有の待機画面（2026-11-04 ユーザー承認。キャンバス「00 共有の待機画面」の E 案）。
// ラウンドや組・コースの間に挟むバッファ画面。全ラウンドで同じ部品を使う。
//   NEXT ＋ 次のラウンド名（150px）
//   （ラウンドの中の切り替えだけ）その下に次の組・コース・Step（水色 96px）
//   区切りの線（光が左右に流れる）
//   点滅する点 ＋ PLEASE STAND BY
// title を渡さないとき（Admin の「待機画面」ボタンで手動で出したとき）は PLEASE STAND BY だけを出す
import FixedStage from "@/app/components/FixedStage";
import styles from "./StandbyScreen.module.css";

const CYAN = '#4FD8FF';
const ORB = 'Orbitron, "Noto Sans JP", sans-serif';
const RAJ = 'Rajdhani, "Noto Sans JP", sans-serif';

export default function StandbyScreen({ title, sub }: { title?: string | null; sub?: string | null }) {
    return <FixedStage><StandbyStage title={title} sub={sub} /></FixedStage>;
}

/** 待機画面の中身（1920×1080）。すでに FixedStage の中にいるラウンドの画面からはこちらを使う */
export function StandbyStage({ title, sub }: { title?: string | null; sub?: string | null }) {
    return (
            <div style={{ width: 1920, height: 1080, background: '#000000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {title && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
                        <span style={{
                            fontFamily: ORB, fontSize: 48, fontWeight: 800, letterSpacing: 12, color: CYAN, border: `4px solid ${CYAN}`,
                            padding: '12px 18px 12px 30px', boxShadow: '0 0 18px rgba(79,216,255,0.35)',
                        }}>NEXT</span>
                        <span style={{
                            fontFamily: RAJ, fontSize: 150, fontWeight: 700, letterSpacing: 6, lineHeight: 1, color: '#FFFFFF',
                            textShadow: '0 0 28px rgba(47,123,255,0.4)', whiteSpace: 'nowrap',
                        }}>{title}</span>
                    </div>
                )}
                {title && sub && (
                    <span style={{
                        fontFamily: RAJ, fontSize: 96, fontWeight: 700, letterSpacing: 6, lineHeight: 1, marginTop: 18,
                        color: CYAN, textShadow: '0 0 24px rgba(79,216,255,0.45)', whiteSpace: 'nowrap',
                    }}>{sub}</span>
                )}
                {title && (
                    <div style={{
                        position: 'relative', width: 900, height: 2, margin: '34px 0 30px', overflow: 'hidden',
                        background: 'linear-gradient(90deg, transparent, rgba(47,123,255,0.55), transparent)',
                    }}>
                        <div className={styles.scan} style={{
                            position: 'absolute', left: '50%', top: 0, width: 220, height: 2, marginLeft: -110,
                            background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)`, boxShadow: `0 0 14px ${CYAN}`,
                        }} />
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                    <span className={styles.blink} style={{ width: 14, height: 14, borderRadius: '50%', background: CYAN, boxShadow: `0 0 12px ${CYAN}` }} />
                    <span style={{ fontFamily: ORB, fontSize: 34, fontWeight: 800, letterSpacing: 12, color: '#F3FAFF' }}>PLEASE STAND BY</span>
                </div>
            </div>
    );
}

/** ブランク（何も表示しない）。黒い画面だけを出す */
export function BlankScreen() {
    return <FixedStage><div style={{ width: 1920, height: 1080, background: '#000000' }} /></FixedStage>;
}
