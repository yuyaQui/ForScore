"use client";
// 大会準備（mode: waiting）の Main 画面（2026-11-14 ユーザー指示: 単調すぎるので、他のラウンドのデザインに合わせる）。
// Admin の「大会準備」で入力したお知らせの文（update_text）を、ラウンドの画面と同じ作りで出す。
//   上   … 見出し「INFORMATION」と青い線（各ラウンドの見出しと線と同じ大きさ・色）
//   中央 … 面取りした青い枠の中にお知らせの文（Extra Round の問題の枠と同じ作り）。左上に点滅する点と「NOTICE」
//   下   … 大会ロゴ＋大会名（クイズ画面の下部の段と同じ）
// 文の長さに応じて字の大きさを段階的に変え、枠に収める（改行はそのまま）。
import { useContext } from "react";
import FixedStage from "@/app/components/FixedStage";
import { ACCENT } from "@/lib/cyberpunkCard";
import { logoUrl } from "@/lib/tournamentLogo";
import { TournamentBrandView } from "./TournamentBrand";
import { MainReadyContext } from "./mainReadiness";
import styles from "./StandbyScreen.module.css";

const CYAN = '#4FD8FF';
const ORB = 'Orbitron, "Noto Sans JP", sans-serif';
const RAJ = "'Rajdhani', 'Noto Sans JP', sans-serif";
const JP = '"Noto Sans JP", sans-serif';
// Extra Round の問題の枠と同じ面取り
const PANEL_CLIP = 'polygon(36px 0,100% 0,100% calc(100% - 36px),calc(100% - 36px) 100%,0 100%,0 36px)';

/** お知らせの文の字の大きさ（改行を含めた長さで段階的に。枠の内側の幅は約1600px） */
export function waitingFontSize(text: string): number {
    const lines = text.split('\n');
    const longest = Math.max(...lines.map(l => Array.from(l).length));
    const total = Array.from(text.replace(/\n/g, '')).length;
    // 1行に入る字数（全角）と行数の両方から決める
    if (longest <= 12 && lines.length <= 2) return 112;
    if (longest <= 16 && lines.length <= 3 && total <= 32) return 92;
    if (longest <= 22 && lines.length <= 4 && total <= 60) return 72;
    if (total <= 110 && lines.length <= 6) return 58;
    return 46;
}

export default function MainWaiting({ text }: { text: string }) {
    const { brand } = useContext(MainReadyContext);
    const body = text.trim();
    return (
        <FixedStage>
            <div style={{ width: 1920, height: 1080, boxSizing: 'border-box', padding: '56px 72px 16px', background: '#000000', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: RAJ }}>
                {/* 見出しと線（各ラウンドと同じ） */}
                <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>INFORMATION</div>
                <div style={{ height: 2, marginTop: 26, background: ACCENT, boxShadow: `0 0 12px ${ACCENT}73`, flexShrink: 0 }} />

                {/* お知らせの文 */}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {body && (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 22 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <span className={styles.blink} style={{ width: 14, height: 14, borderRadius: '50%', background: CYAN, boxShadow: `0 0 12px ${CYAN}` }} />
                                <span style={{ fontFamily: ORB, fontWeight: 800, fontSize: 30, letterSpacing: 10, color: '#7FA8D9' }}>NOTICE</span>
                            </div>
                            <div style={{ clipPath: PANEL_CLIP, background: ACCENT, padding: 3, boxShadow: `0 0 30px ${ACCENT}55` }}>
                                <div style={{
                                    clipPath: PANEL_CLIP, background: 'rgba(8,14,26,.96)', padding: '56px 72px', minHeight: 360, boxSizing: 'border-box',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <p style={{
                                        margin: 0, fontFamily: JP, fontWeight: 900, fontSize: waitingFontSize(body), lineHeight: 1.5, letterSpacing: 2,
                                        color: '#F3FAFF', textShadow: `0 0 26px ${ACCENT}66`, textAlign: 'center', whiteSpace: 'pre-wrap',
                                    }}>{body}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 大会ロゴ＋大会名（クイズ画面の下部の段と同じ） */}
                <div style={{ height: 90, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <TournamentBrandView name={brand.name} logoSrc={brand.logo ? logoUrl(brand.logo) : null}
                        logoWidth={brand.logo?.width ?? 0} logoHeight={brand.logo?.height ?? 0} />
                </div>
            </div>
        </FixedStage>
    );
}
