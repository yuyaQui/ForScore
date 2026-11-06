import { useSocketSync } from "../useSocketSync";
import { Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Player, SecondRoundState } from "@/lib/types";
import { DEFAULT_SECOND_ROUND_STATE } from "@/lib/types";
import { toOrdinal } from "@/lib/ordinal";
import { getTurnOverStepSlice, getTurnOverSecondaryIndex, getRunnerUps, TURN_OVER_STEP_LABELS, SECOND_ROUND_WINNERS_PER_GROUP } from "@/lib/secondRound";
import {
    ACCENT,
    GUNMETAL_DARK,
    GUNMETAL_MID,
    INNER_BG,
    HONEYCOMB_BG,
    tierOf,
    shade,
    outlineShadow,
    OCTAGON_CLIP_PERCENT,
    buildTopBottomCutClip,
    chamferClip,
    buildSideCutClip,
    fitFontSizeToWidth,
} from "@/lib/cyberpunkCard";
import FixedStage from "@/app/components/FixedStage";
import { BlankScreen } from "./StandbyScreen";
import { useReadyGate } from "../useReadyGate";
import { LightningBoltsVertical, LightningBoltsHorizontal } from "@/app/components/LightningBolts";
import { RoundStage, RemainingSlots } from "@/app/components/Main/RoundStage";
import { WINNER_BAR_COLOR, ELIMINATED_FRAME_FILTER, ELIMINATED_NAME_COLOR, ELIMINATED_NAME_OUTLINE, VerticalSplitName, NAME_SPLIT_H } from "@/app/components/Main/PlayerCardFrame";
import { spacedName } from "@/lib/playerName";
import { belowFontSize, BELOW_NUMBER_H, BELOW_MARK_FONT, BELOW_MARK_W, BELOW_MARK_H } from "@/app/components/Main/belowSizes";

type Props = {
    players: Player[],
    socket: Socket | null,
    setPlayers: (players: Player[]) => void
}

// 「5○2×」ルール: 5ポイントで勝ち抜け（ポイントバーの満タン基準にも使う）
const CLEAR_POINT = 5;

export default function MainSecondRound(props: Props) {
    const { players, socket, setPlayers } = props
    const [secondRoundState, setSecondRoundState] = useState<SecondRoundState>(DEFAULT_SECOND_ROUND_STATE);
    useSocketSync(socket, ['request_second_round_sync']);
    // 進行状態と選手がそろうまでは黒い舞台だけを出す（既定の組・画面が1コマ映る／組が変わって作り直される、のを防ぐ。2026-11-06）
    const { ready, mark, load } = useReadyGate(['state', 'players']);

    useEffect(() => {
        const stopPlayers = load('players', '/api/secondRound/loadPlayers', data => setPlayers(data.allPlayers));
        // 受け取り口は、片付けのときに外す(外さないと、覆いが外れて画面が作り直されるたびに増える)。
        // 進行状態は、この画面が表示された時点・つなぎ直した時点でサーバから取り直す(下の useSocketSync)
        if (socket) {
            const onState = (state: SecondRoundState) => { setSecondRoundState(state); mark('state'); };
            socket.on("update_second_round_state", onState);
            return () => { stopPlayers(); socket.off("update_second_round_state", onState); };
        }
        return stopPlayers;
        // setPlayers は親（app/main/page.tsx）の useState の setter で、React が
        // 参照の同一性を保証している。依存配列に加えても実行回数は変わらない。
    }, [socket, setPlayers, mark, load])

    // その組の選手を取り出す（Admin と同じ規則）。
    //
    // 組番号は取込のときに DB へ保存されている（lib/secondRound.ts）。
    const groupPlayers = players
        .filter(p => p.secondRoundGroupNumber === secondRoundState.group)
        .sort((a, b) => a.paperRank - b.paperRank);

    // Design アーティファクト（Cowork Design: 2nd Round）の見た目をそのまま移植した
    // 1920×1080 固定キャンバスを、実際のウィンドウ／モニターに合わせて拡大縮小する。
    //
    // key に組番号を含めることで、組が変わるたびに TurnOverView / QuizView を
    // まっさらに再マウントし、登場アニメーション（カードのフェード＋ポップイン、
    // Quiz View の額縁展開）を毎回はじめから再生させている。turnOverStep /
    // turnOverPhase の変化だけでは再マウントしない（段階発表の演出は同じ
    // マウント内で state が変わることを前提にしている）。
    if (!ready) return <BlankScreen />;
    return (
        <FixedStage>
            {secondRoundState.view === 'runnerUp' ? (
                // 次点（ペーパー49位）の発表（2026-10-30 ユーザー承認・項目6・案A）。
                // ターンオーバーと同じ帯を中央に1本だけ出す。順位だけ → 学校名・学年・名前（turnOverPhase）
                <TurnOverView
                    key="runnerUp"
                    groupPlayers={getRunnerUps(players)}
                    groupNumber={0}
                    turnOverStep={0}
                    turnOverPhase={secondRoundState.turnOverPhase}
                    turnOverFinalRevealed={false}
                    singleBand
                />
            ) : secondRoundState.view === 'turnOver' ? (
                <TurnOverView
                    key={`turnover-${secondRoundState.group}`}
                    groupPlayers={groupPlayers}
                    groupNumber={secondRoundState.group}
                    turnOverStep={secondRoundState.turnOverStep}
                    turnOverPhase={secondRoundState.turnOverPhase}
                    turnOverFinalRevealed={secondRoundState.turnOverFinalRevealed}
                />
            ) : (
                <QuizView
                    key={`quiz-${secondRoundState.group}`}
                    groupPlayers={groupPlayers}
                    groupNumber={secondRoundState.group}
                    socket={socket}
                />
            )}
        </FixedStage>
    );
}

// ============================================================================
// Turn Over View（順位発表画面）
// ============================================================================

type TurnOverViewProps = {
    groupPlayers: Player[];
    groupNumber: number;
    turnOverStep: number;
    turnOverPhase: 'collapsed' | 'expanded';
    /** 4組目の最終ステップだけで使う、48位を単独発表済みかのフラグ（lib/types.ts 参照） */
    turnOverFinalRevealed: boolean;
    /** true なら段階に分けず、groupPlayers 全員を1本の帯にする（次点の発表。2026-10-30） */
    singleBand?: boolean;
    /**
     * 帯（段階）を外から渡す。渡したときは groupPlayers / groupNumber / singleBand を使わず、
     * bands[turnOverStep] の帯を表示し、段階の切り替えは 2nd Round と同じ帯ごとのフェードにする
     * （ペーパー上位100名の発表の全17画面。2026-11-04 ユーザー指示：2nd Round のターンオーバーと完全に同一に）
     */
    bands?: { label: string; slice: Player[] }[];
};

const CHAMFER = 16; // 角の斜めカット幅(px)。縦横比が変わっても常に45°の切り欠きになるよう両軸共通
const STAGE_W = 1740;
const COLLAPSED_W = 176;
const CARD_H = 220;
const GAP = 20;
const ROW_GAP = 20;

// ペーパー上位100名の発表（MainPaperTop.tsx）でも同じ帯を使うので export する（2026-10-31 項目19）
export function TurnOverView({ groupPlayers, groupNumber, turnOverStep, turnOverPhase, turnOverFinalRevealed, singleBand = false, bands }: TurnOverViewProps) {
    // マウント時に一度だけ、カード全体がフェード＋ポップインする
    // （Design アーティファクトの componentDidMount と同じ手順。以降、発表ステップの
    // 切り替えはこのフラグに関係なく「帯(layer)ごとの不透明度フェード」だけで表現する）
    const [appeared, setAppeared] = useState(false);
    const [noAppearTransition, setNoAppearTransition] = useState(true);
    useEffect(() => {
        // マウント時に一度だけ再生する登場アニメーションの初期化。props/state から導出
        // できる値ではなく、setTimeout で時間差の演出を組み立てるための起点なので、
        // このルールが警告する「Effect内での不要なsetState」には当たらない
        // （app/main/page.tsx の同種の抑制コメントと同じ判断）。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAppeared(false);
        setNoAppearTransition(true);
        const t1 = setTimeout(() => {
            setNoAppearTransition(false);
            setAppeared(true);
        }, 80);
        return () => clearTimeout(t1);
    }, []);

    // 発表ステップが「collapsed → expanded」に切り替わった瞬間だけ、電撃エフェクトを
    // 一瞬走らせる（幅が広がるトランジション .6s に合わせて650ms後に消す。
    // Design アーティファクトの advance() 内のタイマーと同じ値）。
    //
    // flashSecondaryOnly: 4組目の最終ステップだけ、28〜44位と48位が別々のタイミングで
    // 展開されるため、電撃も「今まさに展開された側」だけに限定する必要がある。
    // false=展開直後(28〜44位側、＝48位以外)を光らせる、true=48位を単独発表した瞬間
    // (48位側だけ)を光らせる。他の組・他のステップはsecondaryIndexが常にnullで
    // isSecondaryが常にfalseになるため、flashSecondaryOnlyも常にfalseのままとなり、
    // 結果として今まで通り全員が対象になる(2026-09-27、ユーザー指示)。
    const [flashLightning, setFlashLightning] = useState(false);
    const [flashSecondaryOnly, setFlashSecondaryOnly] = useState(false);
    useEffect(() => {
        if (turnOverPhase !== 'expanded') return;
        // 幅が広がるトランジションに合わせて一瞬だけ電撃を光らせるための時限フラグ。
        // 外部システムとの同期ではなく演出用タイマーの起点なので抑制する。
        // turnOverFinalRevealed も依存に含め、4組目の最終ステップで48位だけを
        // 追加で発表したときにも同じ電撃演出が再生されるようにする(2026-09-27)。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFlashLightning(true);
        setFlashSecondaryOnly(turnOverFinalRevealed);
        const t = setTimeout(() => setFlashLightning(false), 650);
        return () => clearTimeout(t);
    }, [turnOverStep, turnOverPhase, turnOverFinalRevealed]);

    // 次点の発表（singleBand）は全員を1本の帯にする（同順位が複数いれば並べる）
    const groupDefs = bands
        ? bands.map((b) => ({ label: b.label, slice: b.slice, secondaryIndex: null as number | null }))
        : singleBand
        ? [{ label: '次点', slice: groupPlayers, secondaryIndex: null as number | null }]
        : [0, 1, 2, 3].map((step) => ({
            label: TURN_OVER_STEP_LABELS[step],
            slice: getTurnOverStepSlice(groupPlayers, step),
            // 4組目の最終ステップだけ、この帯の中で48位に当たる帯内インデックス（それ以外はnull）
            secondaryIndex: getTurnOverSecondaryIndex(groupNumber, step),
        }));

    return (
        <div style={{ width: 1920, height: 1080, boxSizing: 'border-box', padding: '56px 72px', backgroundColor: '#000000', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', fontFamily: "'Rajdhani','Noto Sans JP',sans-serif" }}>
            <div style={{ flex: 1, position: 'relative' }}>
                {groupDefs.map((def, gi) => {
                    const n = def.slice.length;
                    const isTwoRow = n > 3;
                    const perRow = isTwoRow ? Math.ceil(n / 2) : Math.max(1, n);
                    const maxCardW = isTwoRow ? 460 : 500;
                    const expandedW = Math.min(maxCardW, Math.max(240, Math.floor((STAGE_W - (perRow - 1) * GAP) / perRow)));
                    const isActiveGroup = gi === turnOverStep;
                    const groupPhase = isActiveGroup ? turnOverPhase : 'collapsed';
                    const layerOpacity = isActiveGroup ? 1 : 0;
                    const styleLayer: CSSProperties = {
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: layerOpacity, pointerEvents: isActiveGroup ? 'auto' : 'none',
                        transition: `opacity .45s ease ${isActiveGroup ? '1s' : '0s'}`,
                    };
                    const slotW = expandedW + 14, slotH = CARD_H + 14;

                    const items = def.slice.map((p, idx) => {
                        const tier = tierOf(p.paperRank, ACCENT);
                        const textOutlineColor = shade(tier.color, -0.35);
                        // 4組目の最終ステップでは、48位（secondaryIndexに一致する1人）だけ、
                        // turnOverFinalRevealed が true になるまで帯全体がexpandedでも
                        // 収縮したまま(順位のみ)にする。それ以外は帯全体の状態(groupPhase)通り
                        // 一律で展開する(2026-09-27、ユーザー指示)。
                        const isSecondary = def.secondaryIndex !== null && idx === def.secondaryIndex;
                        const playerExpanded = groupPhase === 'expanded' && (!isSecondary || turnOverFinalRevealed);
                        const w = playerExpanded ? expandedW : COLLAPSED_W;
                        const chassisW = w + 14, chassisH2 = CARD_H + 14;
                        const innerW2 = w - 14, innerH2 = CARD_H - 14;
                        const expanded0 = playerExpanded;

                        const textFadeDelay = expanded0 ? '.8s' : '0s';
                        const textFadeDur = expanded0 ? '.4s' : '0s';
                        const shrinkDelay = '0s';
                        const widthDur = expanded0 ? '.6s' : '.5s';
                        const widthEase = expanded0 ? 'cubic-bezier(.2,.8,.2,1)' : 'cubic-bezier(.22,1,.36,1)';
                        const rankFadeDelay = expanded0 ? '0s' : '.4s';
                        const rankFadeDur = expanded0 ? '0s' : '.4s';

                        const styleSlot: CSSProperties = { width: slotW, height: slotH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
                        const appearOpacity = appeared ? 1 : 0;
                        const appearScale = appeared ? 1 : 0.82;
                        const CHASSIS_TRANSITION = `width ${widthDur} ${widthEase} ${shrinkDelay}, clip-path ${widthDur} ${widthEase} ${shrinkDelay}` + (noAppearTransition ? '' : ', opacity .4s ease, transform .4s cubic-bezier(.22,1,.36,1)');
                        const styleChassis: CSSProperties = {
                            position: 'relative', width: chassisW, height: chassisH2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            clipPath: chamferClip(chassisW, chassisH2, CHAMFER), background: GUNMETAL_MID,
                            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.05)', opacity: appearOpacity, transform: `scale(${appearScale})`, transition: CHASSIS_TRANSITION,
                        };
                        const styleOuter: CSSProperties = {
                            position: 'relative', width: w, height: CARD_H, flexShrink: 0, clipPath: chamferClip(w, CARD_H, CHAMFER),
                            background: tier.color, padding: 7, boxSizing: 'border-box',
                            filter: `drop-shadow(0 0 10px ${tier.glowA}) drop-shadow(0 0 22px ${tier.glowB})`,
                            transition: `width ${widthDur} ${widthEase} ${shrinkDelay}, clip-path ${widthDur} ${widthEase} ${shrinkDelay}`,
                        };
                        const cutClip = buildSideCutClip(w, CARD_H, 7, CHAMFER);
                        const styleCut: CSSProperties = { position: 'absolute', inset: 0, background: GUNMETAL_MID, clipPath: cutClip, transition: `clip-path ${widthDur} ${widthEase} ${shrinkDelay}`, pointerEvents: 'none' };
                        const styleInner: CSSProperties = {
                            position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                            clipPath: chamferClip(innerW2, innerH2, CHAMFER), overflow: 'hidden', backgroundColor: INNER_BG, backgroundImage: HONEYCOMB_BG,
                            backgroundRepeat: 'repeat', backgroundSize: '56px 100px',
                            boxShadow: 'inset 0 3px 6px rgba(255,255,255,.06), inset 0 -6px 14px rgba(0,0,0,.65), inset 0 0 20px rgba(0,0,0,.35)',
                            transition: `clip-path ${widthDur} ${widthEase} ${shrinkDelay}`,
                        };
                        const styleLightL: CSSProperties = { position: 'absolute', top: 0, bottom: 0, left: 0, width: 5, backgroundImage: `linear-gradient(180deg, transparent, ${tier.color}, transparent)`, opacity: .95 };
                        const styleLightR: CSSProperties = { position: 'absolute', top: 0, bottom: 0, right: 0, width: 5, backgroundImage: `linear-gradient(180deg, transparent, ${tier.color}, transparent)`, opacity: .95 };
                        const styleLightning: CSSProperties = {
                            position: 'absolute', left: '6%', right: '6%', top: '50%', height: 150, transform: 'translateY(-50%)',
                            opacity: (flashLightning && isActiveGroup && isSecondary === flashSecondaryOnly) ? 1 : 0, transition: 'opacity .15s linear', pointerEvents: 'none', zIndex: 6,
                        };

                        const rankOpacity = expanded0 ? 0 : 1;
                        const revealOpacity = expanded0 ? 1 : 0;

                        const META_PAD_SIDE = 26;
                        const META_BAR_H = 80;
                        const NAME_PAD_SIDE = 16;
                        // 2026-09-25 ユーザー指示: Main画面(Turn Over/Quiz View共通)の文字サイズを
                        // 少し大きく。カード幅wに応じて決まる各サイズを約1割引き上げる。
                        const rankFontSize = Math.max(38, Math.min(75, Math.floor(w / 5.5)));
                        const metaAvailW = (w - 14) - META_PAD_SIDE * 2;
                        const nameAvailW = (w - 14) - NAME_PAD_SIDE * 2;
                        // 2026-09-26 ユーザー指示: 枠の横幅をめいいっぱい使い、かつ漢字6文字の
                        // 名前でも枠からはみ出さないよう、名前の文字数から逆算したサイズにする
                        // (短い名前ほど大きく、6文字に近い名前ほど自動的に縮む)。学校名・学年も
                        // 同様に文字数から求めるが、上限はカード幅から決まる従来の値のまま。
                        const metaFontSizeMax = Math.round(Math.max(20, Math.min(26, Math.floor(w / 20))) * 1.65);
                        const nameFontSize = fitFontSizeToWidth(p.name, nameAvailW - 8, 1, 40, 80);
                        const metaFontSize = fitFontSizeToWidth((p.school || '未登録') + ' ' + (p.grade || '-'), metaAvailW - 8, 0, 18, metaFontSizeMax);
                        const metaSizeDur = expanded0 ? '.45s' : '0s';

                        const styleMetaBar: CSSProperties = {
                            flexShrink: 0, boxSizing: 'border-box', height: expanded0 ? META_BAR_H : 0,
                            padding: expanded0 ? `16px ${META_PAD_SIDE}px 0 ${META_PAD_SIDE}px` : `0 ${META_PAD_SIDE}px`,
                            overflow: 'hidden', opacity: revealOpacity,
                            transition: `opacity ${textFadeDur} ease ${textFadeDelay}, height ${metaSizeDur} ease ${shrinkDelay}, padding ${metaSizeDur} ease ${shrinkDelay}`,
                        };
                        const styleMetaLine: CSSProperties = {
                            fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: metaFontSize, lineHeight: 1.25, color: '#FFFFFF',
                            textShadow: outlineShadow(textOutlineColor, 1.1), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            maxWidth: Math.max(20, metaAvailW - 6),
                        };
                        const styleCenterArea: CSSProperties = { position: 'relative', flex: 1, minHeight: 0 };
                        const rankFadeEase = expanded0 ? 'ease' : 'cubic-bezier(.22,1,.36,1)';
                        const styleRankCenter: CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: rankOpacity, transition: `opacity ${rankFadeDur} ${rankFadeEase} ${rankFadeDelay}` };
                        const rankChipPadV = Math.max(4, Math.round(rankFontSize * 0.12));
                        const rankChipPadH = Math.max(10, Math.round(rankFontSize * 0.28));
                        const rankChipBorder = Math.max(3, Math.round(rankFontSize * 0.06));
                        const styleRankChip: CSSProperties = {
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: `${rankChipPadV}px ${rankChipPadH}px`,
                            background: 'transparent', border: `${rankChipBorder}px solid ${tier.color}`,
                            clipPath: 'polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)',
                            fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 900, fontSize: rankFontSize, lineHeight: 1, color: '#FFFFFF',
                        };
                        const styleNameCenter: CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: `0 ${NAME_PAD_SIDE}px`, opacity: revealOpacity, transition: `opacity ${textFadeDur} ease ${textFadeDelay}` };
                        const styleNameText: CSSProperties = {
                            fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900, fontSize: nameFontSize, lineHeight: 1.2, letterSpacing: 1, color: '#F3FAFF',
                            textShadow: outlineShadow(textOutlineColor, 1.5), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            maxWidth: Math.max(20, nameAvailW - 6),
                        };

                        return (
                            <div key={p.id} style={styleSlot}>
                                <div style={styleChassis}>
                                    <div style={styleOuter}>
                                        <div style={styleCut} />
                                        <div style={styleInner}>
                                            <div style={styleLightL} />
                                            <div style={styleLightR} />
                                            <div style={styleMetaBar}>
                                                <div style={styleMetaLine}>{(p.school || '未登録') + ' ' + (p.grade || '-')}</div>
                                            </div>
                                            <div style={styleCenterArea}>
                                                <div style={styleRankCenter}><span style={styleRankChip}>{toOrdinal(p.paperRank)}</span></div>
                                                <div style={styleNameCenter}><span style={styleNameText}>{spacedName(p.name)}</span></div>
                                            </div>
                                            <div style={styleLightning}>
                                                <LightningBoltsHorizontal />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    });

                    const rowW = Math.max(0, perRow * slotW + (perRow - 1) * GAP);
                    const combinedWidth = isTwoRow ? (rowW + Math.round(slotW * 0.5)) : rowW;
                    const styleWrapper: CSSProperties = { width: combinedWidth, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: ROW_GAP };

                    const rows: { style: CSSProperties; items: typeof items }[] = isTwoRow
                        ? [
                            { style: { display: 'flex', gap: GAP, marginLeft: 0 }, items: items.slice(0, perRow) },
                            { style: { display: 'flex', gap: GAP, marginLeft: Math.round(slotW * 0.5) }, items: items.slice(perRow) },
                        ]
                        : [{ style: { display: 'flex', gap: GAP, marginLeft: 0 }, items }];

                    return (
                        <div key={gi} style={styleLayer}>
                            <div style={styleWrapper}>
                                {rows.map((row, ri) => (
                                    <div key={ri} style={row.style}>
                                        {row.items}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}

                {groupPlayers.length === 0 && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7FA8D9', fontSize: 28 }}>
                        選手データがありません。CSVから1st Round結果を登録してください。
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// Quiz View（正誤判定・ポイント表示画面）
// ============================================================================

type QuizViewProps = {
    groupPlayers: Player[];
    groupNumber: number;
    socket: Socket | null;
};

type DoorPhase = 'hidden' | 'collapsed' | 'expanding' | 'open';

const FULL_CHASSIS_H = 694, FULL_OUTER_H = 680;
/** カード（694）＋ 下の点数（16＋70）＋ 誤答の×・（4＋70）。RoundStage の縮小の基準 */
const SECOND_ROUND_CONTENT_H = FULL_CHASSIS_H + 16 + BELOW_NUMBER_H + 4 + BELOW_MARK_H;
const COLLAPSED_CHASSIS_H = 144, COLLAPSED_OUTER_H = 130;
const COLLAPSED_STRIP_H = 7;
const FULL_STRIP_H = Math.round(COLLAPSED_STRIP_H * (FULL_OUTER_H / COLLAPSED_OUTER_H));
const COLLAPSED_BADGE_TOP = 14;
const FULL_BADGE_TOP = FULL_STRIP_H + 10;
// 2026-09-26 ユーザー指示: カード内側の横幅を158→164pxに広げ、名前・学校名/学年の
// フォントサイズを大きくできる余裕を作る(外側シャーシ172pxとの縁は7px→4pxに)。
// 2026-09-26 ユーザー指示(2回目): 名前を背景の左端に、学校名・学年を背景の右端に
// 揃えるため、カードの縁(枠の金属部分の太さ)を14→10pxに詰めて内側の横幅を広げる。
const CARD_OUTER_W = 168, CUT_PAD = 10;
const NEUTRAL_FRAME = '#4A5568'; // 失格した選手の枠色（順位帯の色に関わらずこのグレーに固定）

function QuizView({ groupPlayers, groupNumber, socket }: QuizViewProps) {
    const [doorPhase, setDoorPhase] = useState<DoorPhase>('hidden');
    const [noTransition, setNoTransition] = useState(true);

    // マウント時に一度だけ、Turn Over から引き継いだ「小さな八角形（順位だけ見えている
    // 状態）」から額縁が展開して開くアニメーションを自動再生する
    // （Design アーティファクトの playIntro() と同じ手順・同じタイミング）。
    useEffect(() => {
        // マウント時に一度だけ再生する額縁展開アニメーションの初期化。同じ理由で抑制する。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDoorPhase('hidden');
        setNoTransition(true);
        const timers = [
            setTimeout(() => { setNoTransition(false); setDoorPhase('hidden'); }, 50),
            setTimeout(() => setDoorPhase('collapsed'), 50 + 300),
            setTimeout(() => setDoorPhase('expanding'), 50 + 300 + 400 + 300),
            setTimeout(() => setDoorPhase('open'), 50 + 300 + 400 + 300 + 700 + 150),
        ];
        return () => timers.forEach(clearTimeout);
    }, []);

    const isAppeared = doorPhase !== 'hidden';
    const isExpanding = doorPhase === 'expanding';
    const isOpen = doorPhase === 'open';
    const isFullHeight = doorPhase === 'expanding' || doorPhase === 'open';
    const revealOpacity = isOpen ? 1 : 0;
    const REVEAL_TRANSITION = noTransition ? 'none' : `opacity .5s ease ${isOpen ? '.1s' : '0s'}`;

    const chassisH = isFullHeight ? FULL_CHASSIS_H : COLLAPSED_CHASSIS_H;
    const outerH = isFullHeight ? FULL_OUTER_H : COLLAPSED_OUTER_H;
    const HEIGHT_TRANSITION = noTransition ? 'none' : 'height .7s cubic-bezier(.22,1,.36,1)';
    const CHASSIS_TRANSITION = noTransition ? 'none' : `${HEIGHT_TRANSITION}, opacity .4s ease, transform .4s cubic-bezier(.22,1,.36,1)`;
    const appearOpacity = isAppeared ? 1 : 0;
    const appearScale = isAppeared ? 1 : 0.82;
    const styleSlot: CSSProperties = { width: 172, height: FULL_CHASSIS_H, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };

    const stripH = isFullHeight ? FULL_STRIP_H : COLLAPSED_STRIP_H;
    const badgeTop = isFullHeight ? FULL_BADGE_TOP : COLLAPSED_BADGE_TOP;
    const STRIP_POS_TRANSITION = noTransition ? 'none' : 'height .7s cubic-bezier(.22,1,.36,1), top .7s cubic-bezier(.22,1,.36,1)';

    const cutClip = buildTopBottomCutClip(CARD_OUTER_W, outerH, CUT_PAD);
    const CUT_TRANSITION = noTransition ? 'none' : 'clip-path .7s cubic-bezier(.22,1,.36,1)';

    // Design アーティファクトの検証は8名分のモックデータで行われていたため、カード幅172px+
    // 間隔26pxのままだと、実際の1組の人数(12名)ではカード列の合計幅が画面の余白を引いた
    // 横幅(1920 - 72px*2 = 1776px)を超えてしまい、両端のカードが画面外に見切れる
    // （2026-09-26 に実際の画面で発覚した不具合）。個々のカードの寸法・文字サイズは
    // アーティファクト通りに保ったまま、列全体をまとめて transform:scale() で縮小することで
    // 収める。2026-10-22 から縮小は RoundStage が行う（横幅と高さの両方で収まる倍率）。
    const CARD_SLOT_W = 172;
    // カード同士の間隔。26px → 12px に詰めて、その分 rowScale（下記）が大きくなるように
    // している（間隔を削った分だけ縮小率が緩み、カード・カード内の文字とも少し大きく見える。
    // 2026-09-26、ユーザーの指示で調整）。
    //
    // 1組12名を1920px幅の画面に収める都合上、間隔を0にしても1枚あたりの見た目の幅は
    // 1776px/12 = 148px が理論上の上限（172px×12=2064px > 1776px のため、どのみち
    // 多少の縮小は避けられない）。これ以上カードや文字を大きくしたい場合は、間隔の調整
    // だけでは限界があり、カード自体の基準サイズ(CARD_SLOT_W や各文字サイズ)を見直す
    // 必要がある。
    const CARD_GAP = 12;
    const naturalRowW = groupPlayers.length > 0
        ? groupPlayers.length * CARD_SLOT_W + (groupPlayers.length - 1) * CARD_GAP
        : 0;

    // 右下の「残り参加者数 → 残り勝ち抜け枠数」（2026-10-11 ユーザー指示）。
    // 残り参加者 = まだ勝ち抜けも失格もしていない選手（secondRoundRank === 0）
    const activeCount = groupPlayers.filter(p => p.secondRoundRank === 0).length;
    const remainingSlots = Math.max(0, SECOND_ROUND_WINNERS_PER_GROUP - groupPlayers.filter(p => p.secondRoundRank > 0).length);

    // 2026-10-22: 見出し → 問題欄 → 仕切り線 → カードの位置を全ラウンドでそろえる（RoundStage）。
    // カードの縮小は RoundStage が行う（12名の横幅と、カード＋下の点数・誤答の高さの両方で収まる倍率）
    return (
        <RoundStage socket={socket} round="secondRound" ruleColor="#35FFA0" contentW={Math.max(naturalRowW, 1)} contentH={SECOND_ROUND_CONTENT_H}
            header={
            /* 見出し。1行目は左「2nd Round」・右「○組目」を同じ大きさ・高さで並べ、
                2行目は左にルール、右に「残り参加者数 → 残り勝ち抜け枠数」を出す（2026-10-11 ユーザー指示） */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>2nd Round</div>
                        <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, color: '#FFFFFF' }}>Set {groupNumber}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontFamily: '"Noto Sans JP", sans-serif', fontWeight: 900, fontSize: 50, color: '#F3FAFF', letterSpacing: 1 }}>連答つき 5○2×</div>
                        <RemainingSlots active={activeCount} slots={remainingSlots} />
                    </div>
                </div>
            }>
            {/* 見出し下の横線は、選手枠の緑（25位以下の順位帯の色。lib/cyberpunkCard の tierOf と同じ値。2026-10-11 ユーザー指示） */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: CARD_GAP }}>
                    {groupPlayers.map((p) => {
                        // DB平坦化に伴うステータスの動的判定
                        const tier = tierOf(p.paperRank, ACCENT);
                        const textOutlineColor = shade(tier.color, -0.35); // 白文字の縁取りに使う、tier色より少し暗い色
                        const wrongCount = p.secondRoundWrongCount || 0;
                        // secondRoundRank < 0 は「2誤答で失格」と「組内で5人の勝ち抜けが決まり
                        // ラウンドが終了した時点で、まだ0/1誤答だった(=本来は失格していない)選手が
                        // 一括で -1 にされたもの」の2通りを両方含む
                        // (app/api/secondRound/updateScores/route.ts の isGroupFinished 処理を参照)。
                        // 後者はLOST表示にしないでほしいというユーザー指示(2026-09-25)のため、
                        // 実際に2回誤答した選手だけをLOSTとして扱う。
                        const eliminated = p.secondRoundRank < 0 && wrongCount >= 2;
                        const winner = p.secondRoundRank >= 1;
                        // 2nd Roundのポイント上限は5。上記と同じ「ラウンド終了時の一括更新」など
                        // 想定外の経路で万一5を超える値が入っていても表示上は5で頭打ちにする。
                        const point = Math.min(CLEAR_POINT, p.secondRoundPoint || 0);
                        const pct = Math.min(100, (point / CLEAR_POINT) * 100);
                        const wrongMarks = Array.from({ length: wrongCount });
                        const dotMarks = Array.from({ length: Math.max(0, 2 - wrongCount) });

                        const metalBase = eliminated ? NEUTRAL_FRAME : tier.color;
                        const metalGradient = `linear-gradient(0deg, ${metalBase}, ${metalBase})`;
                        const brushedTexture = 'repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0px, rgba(255,255,255,.06) 1px, transparent 1px, transparent 7px)';
                        const outerFilter = eliminated
                            ? ELIMINATED_FRAME_FILTER
                            : winner
                                ? `drop-shadow(0 0 16px ${tier.glowA}) drop-shadow(0 0 36px ${tier.glowB})`
                                : `drop-shadow(0 0 10px ${tier.glowA}) drop-shadow(0 0 24px ${tier.glowB})`;

                        const styleChassis: CSSProperties = {
                            position: 'relative', width: 172, height: chassisH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            clipPath: OCTAGON_CLIP_PERCENT, background: GUNMETAL_DARK, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.05)',
                            opacity: appearOpacity, transform: `scale(${appearScale})`, transition: CHASSIS_TRANSITION,
                        };
                        const styleOuter: CSSProperties = {
                            position: 'relative', width: CARD_OUTER_W, height: outerH, flexShrink: 0, clipPath: OCTAGON_CLIP_PERCENT,
                            backgroundImage: `${brushedTexture}, ${metalGradient}`, padding: CUT_PAD, boxSizing: 'border-box', filter: outerFilter, transition: HEIGHT_TRANSITION,
                        };
                        const styleCut: CSSProperties = { position: 'absolute', inset: 0, background: GUNMETAL_DARK, clipPath: cutClip, transition: CUT_TRANSITION, pointerEvents: 'none' };
                        const styleInner: CSSProperties = {
                            position: 'relative', width: '100%', height: '100%', clipPath: OCTAGON_CLIP_PERCENT, overflow: 'hidden',
                            backgroundColor: INNER_BG, backgroundImage: HONEYCOMB_BG, backgroundRepeat: 'repeat', backgroundSize: '56px 100px',
                            boxShadow: 'inset 0 3px 6px rgba(255,255,255,.06), inset 0 -6px 16px rgba(0,0,0,.65), inset 0 0 26px rgba(0,0,0,.35)',
                        };
                        const styleTopStrip: CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, height: stripH, backgroundImage: `linear-gradient(90deg, transparent, ${tier.color}, transparent)`, opacity: .95, transition: STRIP_POS_TRANSITION };
                        // 勝ち抜け(winner)が決まったら、ポイントバーの色を通常の水色からオレンジに
                        // 変える(2026-09-25、ユーザー指示)。
                        const stylePointBarWrap: CSSProperties = { position: 'absolute', bottom: 0, left: 0, right: 0, height: `${pct}%`, background: winner ? WINNER_BAR_COLOR : 'rgba(51,198,255,.55)', opacity: revealOpacity, transition: REVEAL_TRANSITION };
                        const styleBadge: CSSProperties = { position: 'absolute', top: badgeTop, left: 0, right: 0, display: 'flex', justifyContent: 'center', transition: STRIP_POS_TRANSITION };
                        const styleBadgeChip: CSSProperties = {
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px 12px', background: 'transparent',
                            border: `3px solid ${tier.color}`, clipPath: 'polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)',
                            fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontWeight: 900, fontSize: 24, color: '#FFFFFF', letterSpacing: 1,
                        };
                        const textRevealStyle: CSSProperties = { opacity: revealOpacity, transition: REVEAL_TRANSITION };
                        // 名前は背景(暗い八角形)の左端、学校名・学年は右端にできるだけ
                        // 揃える。八角形のclip-pathが上下端近くで内側に切れ込む形状のため、
                        // 縦方向中央付近でも左右5%ぶんは背景そのものが無い — 9pxはその
                        // 切れ込みの外に出ないための最小限の余白。
                        //
                        // 2026-09-26 ユーザー指示(3回目): 名前と学校名・学年の間の隙間を、
                        // フォントサイズを大きくして詰める。縦書きなので「文字数が多いほど
                        // 高さ方向に長くなる」— fitFontSizeToWidth と同じ考え方を高さ方向に
                        // 使い、短い名前ほど大きく、漢字6文字級の名前でも上のランクバッジや
                        // カード下端にはみ出さない範囲で自動的に縮む。学校名・学年も同様に
                        // (縦に2段で積まれるので、合計文字数に対して1本の帯として計算する)。
                        // 2026-09-26 ユーザー指摘: 漢字6文字の名前で最後の1文字(例:「美」)が
                        // カード下端の八角形クリップの切れ込み(下端コーナーが幅方向に内側へ
                        // 斜めにカットされる帯)にかぶって欠けて見える不具合。原因は、名前・
                        // 学校名/学年のゾーン高さがカード内側高さ660をほぼそのまま使っており、
                        // 八角形の下端コーナー(高さ95.5%〜99%、660pxで言うと約630px〜653px)
                        // まで文字がはみ出せてしまうため。左右9pxの余白は中央の縦帯(高さ4.5%〜
                        // 95.5%=約30px〜630px)でのみ安全なので、ゾーンをその安全な帯の中に収まる
                        // 高さに縮め、余裕(マージン)も追加した。
                        const NAME_ZONE_H = 519; // 660 - 上余白105 - 下端安全マージン36(八角形コーナーの手前で止める)
                        const META_ZONE_H = 505; // 学校名/学年も同じ下端コーナーにかぶらないよう、余裕を多めに
                        let nameFontSize = fitFontSizeToWidth(p.name, NAME_ZONE_H, 4, 40, 90);
                        const metaCharCount = (p.school || '未登録').length + (p.grade || '-').length;
                        let metaFontSize = fitFontSizeToWidth('*'.repeat(metaCharCount), META_ZONE_H, 1, 20, 40);
                        // 縦の高さだけで決めると、名前・学校名がどちらも短い時に2つ合計で
                        // カードの横幅(名前と学校名・学年の間の隙間ぶんを含む)を超えてしまう
                        // ことがあるため、超える場合は両方を同じ比率で縮めて必ず横に収める。
                        const NAME_META_WIDTH_BUDGET = 130; // 内側幅148 - 左右の余白(9px×2)
                        const NAME_META_SAFETY_GAP = 8;
                        const nameMetaWidthSum = nameFontSize + metaFontSize;
                        if (nameMetaWidthSum + NAME_META_SAFETY_GAP > NAME_META_WIDTH_BUDGET) {
                            const shrink = (NAME_META_WIDTH_BUDGET - NAME_META_SAFETY_GAP) / nameMetaWidthSum;
                            nameFontSize = Math.max(40, Math.floor(nameFontSize * shrink));
                            metaFontSize = Math.max(20, Math.floor(metaFontSize * shrink));
                        }
                        // 名前は姓を上・名を下に分け、帯の上端からそろえる（2026-11-04 ユーザー指示。VerticalSplitName）
                        const styleNameWrap: CSSProperties = { position: 'absolute', top: 105, left: 0, right: 0, bottom: 36, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', paddingLeft: 9, boxSizing: 'border-box', ...textRevealStyle };
                        const styleName: CSSProperties = {
                            fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 900,
                            letterSpacing: 4, color: eliminated ? ELIMINATED_NAME_COLOR : '#F3FAFF',
                            // 失格者の名前は明るい灰色＋黒い縁（2026-10-29 案B。PlayerCardFrame と共通の値）
                            textShadow: eliminated ? outlineShadow(ELIMINATED_NAME_OUTLINE.color, ELIMINATED_NAME_OUTLINE.width) : outlineShadow(textOutlineColor, 1.5),
                        };
                        const styleMeta: CSSProperties = { position: 'absolute', top: '16%', right: 9, writingMode: 'vertical-rl', textOrientation: 'upright', display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-start', ...textRevealStyle };
                        const styleMetaText: CSSProperties = { writingMode: 'vertical-rl', textOrientation: 'upright', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 800, fontSize: metaFontSize, lineHeight: 1, color: '#FFFFFF', letterSpacing: 1, textShadow: outlineShadow(textOutlineColor, 1.1) };
                        const styleBelowWrap: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', ...textRevealStyle };
                        const styleLightning: CSSProperties = { position: 'absolute', top: '6%', bottom: '6%', left: '50%', width: 64, transform: 'translateX(-50%)', opacity: isExpanding ? 1 : 0, transition: 'opacity .15s linear', pointerEvents: 'none', zIndex: 6 };

                        // 選手が勝ち抜け／失格になったら、枠の下のポイント表示をその結果で上書きする
                        let belowText: string, belowColor: string;
                        if (eliminated) {
                            belowText = 'LOST';
                            belowColor = '#8A93A3';
                        } else if (winner) {
                            belowText = toOrdinal(p.secondRoundRank);
                            belowColor = '#FFE28A';
                        } else {
                            belowText = String(point);
                            belowColor = p.secondRoundDoubleChance ? '#FFC93C' : '#EAF6FF';
                        }

                        return (
                            <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 172, flexShrink: 0 }}>
                                <div style={styleSlot}>
                                    <div style={styleChassis}>
                                        <div style={styleOuter}>
                                            <div style={styleCut} />
                                            <div style={styleInner}>
                                                <div style={stylePointBarWrap} />
                                                <div style={styleTopStrip} />
                                                <div style={styleBadge}><span style={styleBadgeChip}>{toOrdinal(p.paperRank)}</span></div>
                                                <div style={styleNameWrap}><VerticalSplitName name={p.name} baseSize={nameFontSize} zoneH={NAME_SPLIT_H} style={styleName} /></div>
                                                <div style={styleMeta}>
                                                    <span style={styleMetaText}>{p.school || '未登録'}</span>
                                                    <span style={styleMetaText}>{p.grade || '-'}</span>
                                                </div>
                                                <div style={styleLightning}>
                                                    <LightningBoltsVertical />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div style={styleBelowWrap}>
                                    <div style={{ marginTop: 16, height: BELOW_NUMBER_H, lineHeight: `${BELOW_NUMBER_H}px`, fontFamily: 'Orbitron, "Noto Sans JP", sans-serif', fontSize: belowFontSize(belowText), fontWeight: 800, letterSpacing: 1, color: belowColor }}>{belowText}</div>
                                    <div style={{ display: 'flex', gap: 14, marginTop: 4, height: BELOW_MARK_H, alignItems: 'center' }}>
                                        {wrongMarks.map((_, i) => (
                                            <span key={`x-${i}`} style={{ width: BELOW_MARK_W, height: BELOW_MARK_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: BELOW_MARK_FONT, lineHeight: 1, fontWeight: 700, color: '#FF4D6D' }}>×</span>
                                        ))}
                                        {dotMarks.map((_, i) => (
                                            <span key={`dot-${i}`} style={{ width: BELOW_MARK_W, height: BELOW_MARK_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: BELOW_MARK_FONT, lineHeight: 1, fontWeight: 700, color: '#3A5170' }}>・</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {groupPlayers.length === 0 && (
                        <div style={{ color: '#7FA8D9', fontSize: 28 }}>選手データがありません。</div>
                    )}
                </div>
        </RoundStage>
    );
}
