// 決勝の選手紹介・最終成績の画面（2026-10-17 追加。docs/final-design.md 8章）。
//
// 準決勝の進出者紹介（MainSemifinal.tsx の ProfileBody）と同じ組み方で、写真・二つ名・学校名・学年・名前に
// 「それまでのラウンドの成績」の表を足したもの。最終成績（result）では表に Final の行を足し、
// 上に CHAMPION / 2nd Place / 3rd Place の見出しを出す。
// 奇数番目（1人目・3人目）は写真が左、偶数番目（2人目）は右。
import type { Player } from "@/lib/types";
import { ACCENT, tierOf, shade, outlineShadow } from "@/lib/cyberpunkCard";
import { buildCareerRecords, finalPlaceLabel, type RecordTone } from "@/lib/finalProfile";
import { NoPhoto } from "./SemifinalCard";

const GOLD = '#FFC93C';
const REVIVAL = '#C9A6FF';

// 現れ方: 写真の枠が縦の軸で回りながら現れ、少し遅れて文字が横から入り、成績が1行ずつ現れる
const PROFILE_CSS = `
@keyframes fpSpinL { 0% { opacity:0; transform:perspective(1800px) rotateY(-100deg) scale(.86); } 100% { opacity:1; transform:perspective(1800px) rotateY(0) scale(1); } }
@keyframes fpSpinR { 0% { opacity:0; transform:perspective(1800px) rotateY(100deg) scale(.86); } 100% { opacity:1; transform:perspective(1800px) rotateY(0) scale(1); } }
@keyframes fpTextL { 0% { opacity:0; transform:translateX(-56px); filter:blur(8px); } 100% { opacity:1; transform:translateX(0); filter:blur(0); } }
@keyframes fpTextR { 0% { opacity:0; transform:translateX(56px); filter:blur(8px); } 100% { opacity:1; transform:translateX(0); filter:blur(0); } }
@keyframes fpRow { 0% { opacity:0; transform:translateY(14px); } 100% { opacity:1; transform:translateY(0); } }
@keyframes fpSweep { 0% { transform:translateX(-120%); } 100% { transform:translateX(120%); } }
@keyframes fpGlow { 0%,100% { text-shadow: 0 0 24px ${GOLD}99, 0 0 60px ${GOLD}55; } 50% { text-shadow: 0 0 36px ${GOLD}, 0 0 90px ${GOLD}88; } }
`;

const PHOTO_W = 456, PHOTO_H = 608;

const TONE_COLOR: Record<RecordTone, string> = {
    rank: '#F3FAFF',
    out: '#8A93A3',
    none: '#5C7EA6',
    revival: REVIVAL,
    gold: GOLD,
};

export function FinalProfile({ player, index, nickname, photo, place }: {
    player: Player;
    /** 紹介順の何番目か（写真の左右を決める） */
    index: number;
    nickname: string;
    photo: string | null;
    /** 最終成績の表示なら順位（1〜3）。選手紹介なら null */
    place: number | null;
}) {
    const photoLeft = index % 2 === 0;
    const tier = tierOf(player.paperRank, ACCENT);
    // 優勝者の最終成績は枠を金色にする
    const frameColor = place === 1 ? GOLD : tier.color;
    const outline = shade(tier.color, -0.35);
    const nameParts = player.name.trim().split(/\s+/);
    const nameLen = Array.from(player.name.replace(/\s+/g, '')).length + (nameParts.length - 1) * 0.5;
    const nameSize = Math.max(64, Math.min(112, Math.floor(860 / nameLen)));
    const align = photoLeft ? 'flex-start' : 'flex-end';
    const records = buildCareerRecords(player, place !== null);
    const clip = (c: number) => `polygon(${c}px 0,calc(100% - ${c}px) 0,100% ${c}px,100% calc(100% - ${c}px),calc(100% - ${c}px) 100%,${c}px 100%,0 calc(100% - ${c}px),0 ${c}px)`;

    return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 88, padding: '0 40px', flexDirection: photoLeft ? 'row' : 'row-reverse' }}>
            <style>{PROFILE_CSS}</style>
            <div style={{ position: 'relative', width: PHOTO_W + 24, height: PHOTO_H + 24, flexShrink: 0, animation: `${photoLeft ? 'fpSpinL' : 'fpSpinR'} .9s cubic-bezier(.22,1,.36,1) both` }}>
                <div style={{ position: 'absolute', inset: 0, background: frameColor, clipPath: clip(36), filter: `drop-shadow(0 0 18px ${place === 1 ? GOLD : tier.glowA})` }} />
                <div style={{ position: 'absolute', inset: 12, overflow: 'hidden', background: '#0B0F16', clipPath: clip(30) }}>
                    {photo
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        : <NoPhoto color={tier.color} />}
                    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(105deg, transparent 35%, ${frameColor}55 50%, transparent 65%)`, animation: 'fpSweep .9s ease-in-out .2s both' }} />
                </div>
            </div>
            <div style={{ flex: 1, display: 'flex', justifyContent: align, minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: 18, textAlign: photoLeft ? 'left' : 'right', minWidth: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: 16, animation: `${photoLeft ? 'fpTextR' : 'fpTextL'} .6s ease-out .35s both` }}>
                        {/* 最終成績の見出し */}
                        {place !== null && (
                            <div style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 900, fontSize: place === 1 ? 64 : 48, letterSpacing: 8, color: place === 1 ? GOLD : '#DDE8F7', animation: place === 1 ? 'fpGlow 2.4s ease-in-out infinite' : undefined, textShadow: place === 1 ? undefined : '0 0 18px rgba(79,216,255,.35)' }}>
                                {finalPlaceLabel(place)}
                            </div>
                        )}
                        {/* 二つ名（未登録・敗者復活者は出さない） */}
                        {nickname && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexDirection: photoLeft ? 'row' : 'row-reverse' }}>
                                <span style={{ width: 54, height: 3, background: tier.color, boxShadow: `0 0 10px ${tier.glowA}` }} />
                                <span style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: 36, letterSpacing: 4, color: tier.color, textShadow: `0 0 18px ${tier.glowB}` }}>{nickname}</span>
                            </div>
                        )}
                        <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: 40, letterSpacing: 2, color: '#FFFFFF', textShadow: outlineShadow(outline, 1.4) }}>
                            {player.school}<span style={{ marginLeft: 22 }}>{player.grade}</span>
                        </div>
                        <div style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: nameSize, lineHeight: 1.08, letterSpacing: 6, color: '#F3FAFF', textShadow: `${outlineShadow(outline, 2.2)}, 0 0 40px ${tier.glowB}`, whiteSpace: 'nowrap' }}>
                            {nameParts.map((part, i) => <span key={i} style={{ marginLeft: i === 0 ? 0 : '0.35em' }}>{part}</span>)}
                        </div>
                    </div>
                    {/* それまでのラウンドの成績（1行ずつ現れる） */}
                    <div style={{ display: 'flex', flexDirection: 'column', width: 760, marginTop: 6, borderTop: `2px solid ${tier.color}88` }}>
                        {records.map((r, i) => (
                            <div key={r.label} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 50, padding: '0 14px',
                                borderBottom: '1px solid rgba(79,216,255,.18)',
                                background: r.tone === 'gold' ? `${GOLD}1F` : r.tone === 'revival' ? 'rgba(185,139,255,.10)' : undefined,
                                animation: `fpRow .45s ease-out ${0.9 + i * 0.14}s both`,
                            }}>
                                <span style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                                    <span style={{ fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 800, fontSize: 24, letterSpacing: 2, color: '#9FB4D6' }}>{r.label}</span>
                                    {r.sub && <span style={{ fontFamily: 'Rajdhani, "Noto Sans JP", sans-serif', fontWeight: 700, fontSize: 24, color: '#7FA8D9' }}>（{r.sub}）</span>}
                                </span>
                                <span style={{
                                    fontFamily: r.tone === 'out' || r.tone === 'none' ? '"Noto Sans JP",sans-serif' : 'Orbitron, "Noto Sans JP", sans-serif',
                                    fontWeight: 900, fontSize: r.tone === 'gold' || r.tone === 'revival' ? 32 : 30, letterSpacing: 1, color: TONE_COLOR[r.tone], whiteSpace: 'nowrap',
                                    textShadow: r.tone === 'gold' ? `0 0 18px ${GOLD}99` : r.tone === 'revival' ? `0 0 16px ${REVIVAL}99` : undefined,
                                }}>{r.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
