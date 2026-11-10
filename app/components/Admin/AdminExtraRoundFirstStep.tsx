// Extra Round First Step（筆記）の作業面（運営コンソール。2026-11-05 に載せ替え）。
// いま Main に出ているものと、その問題・解答・別解を確認する。
// 別解・正誤判定基準は Admin（採点するスタッフ）だけが見る。Main には出ない。
// 進行の操作（問題を表示・次へ・次のフェーズへ・進出者決定）は、上のバー（AdminExtraRound）に出す。
import type { ReactNode } from "react";
import type { ExtraRoundQuestion } from "@/lib/types";
import {
    FIRST_STEP_SEQUENCE,
    EXTRA_ROUND_QUESTION_COUNT,
    getExtraRoundPhaseLabel,
    getExtraRoundPhaseRange,
    getFirstStepItem,
    isDecisionAnswer,
} from "@/lib/extraRound";
import { WorkHead, MetaItem } from "./console/ConsoleFrame";
import styles from "./console/console.module.css";

type Props = {
    cursor: number;
    /** いまのステップの中身（問題文 / 解答）を Main に出したか */
    revealed: boolean;
    questions: ExtraRoundQuestion[];
    /** 作業面の右上の道具（引き出しを開く） */
    tools: ReactNode;
};

export default function AdminExtraRoundFirstStep({ cursor, revealed, questions, tools }: Props) {
    const item = getFirstStepItem(cursor);
    const isAnswer = item.view === 'answer';
    const question = questions.find(q => q.number === item.number);
    const [phaseStart, phaseEnd] = getExtraRoundPhaseRange(item.number);
    const atDecision = isDecisionAnswer(cursor);
    const inSurvival = getExtraRoundPhaseLabel(item.number) === 'Survival';
    const missing = questions.length < EXTRA_ROUND_QUESTION_COUNT;

    return (
        <>
            <WorkHead
                meta={<>
                    <MetaItem label="フェーズ" value={`${getExtraRoundPhaseLabel(item.number)}（第${phaseStart}〜${phaseEnd}問）`} />
                    <MetaItem label="Main 表示中" value={`${isAnswer ? '解答' : '問題'} ${item.number}${revealed ? '' : '（未表示）'}`} />
                </>}
                tools={tools} />

            {/* 進行バー: 40ステップを並べ、いまの位置を示す。金色の枠は進出者を決める地点（Phase 1・2 は最後の解答、Survival は毎問の解答。2026-11-11） */}
            <div className={styles.stepBarBox}>
                <div className={styles.stepBar}>
                    {FIRST_STEP_SEQUENCE.map((s, i) => {
                        const cls = i === cursor ? (s.view === 'answer' ? styles.stepNowAns : styles.stepNowQ)
                            : i < cursor ? (s.view === 'answer' ? styles.stepPastAns : styles.stepPastQ) : styles.stepFuture;
                        return <span key={i} className={`${cls} ${isDecisionAnswer(i) ? styles.stepDecision : ''}`} title={`${s.view === 'answer' ? '解答' : '問題'} ${s.number}`} />;
                    })}
                </div>
                <div className={styles.stepLegend}>
                    <span>青: 問題 / 金茶: 解答 / 金枠: 進出者決定</span>
                    <span>Phase 1（1〜10）→ Phase 2（11〜15）→ Survival（16〜20・1問ずつ解答発表）</span>
                </div>
            </div>

            {missing && (
                <div className={styles.bannerError}>
                    問題が足りません（{questions.length} / {EXTRA_ROUND_QUESTION_COUNT}問）。右上「表示の切り替え」で問題取込に戻って取り込み直してください
                </div>
            )}
            {!revealed && (
                <div className={isAnswer ? styles.bannerFinish : styles.bannerInfo}>
                    {isAnswer ? 'Main は問題文のみ表示中。「解答を表示 ▶」で解答を出します' : 'Main は枠のみ表示中。「問題を表示 ▶」で問題文を出します'}
                </div>
            )}
            {atDecision && revealed && (
                <div className={styles.bannerFinish}>
                    {cursor === FIRST_STEP_SEQUENCE.length - 1
                        ? 'First Step 終了。進出者を決めます'
                        : inSurvival
                            ? `問題 ${item.number} の解答発表。起立している人数を確かめて、進出者を決めるか、次の問題へ進みます`
                            : `${getExtraRoundPhaseLabel(item.number)} 終了。進出者を決めるか、次のフェーズへ進めます`}
                </div>
            )}

            <div className={isAnswer ? styles.qaCardAns : styles.qaCard}>
                {question ? (
                    <>
                        <div className={styles.qaLabel}>問題 {question.number}</div>
                        <p className={styles.qaText}>{question.text}</p>
                        {/* 解答・別解は常にスタッフ向けに見せる。Main には解答発表のステップまで出ない */}
                        <div className={styles.qaDivider}>
                            <div className={isAnswer ? styles.qaLabelOn : styles.qaLabel}>模範解答{isAnswer && revealed ? '（表示中）' : '（未表示）'}</div>
                            <p className={styles.qaAnswer}>{question.answer}</p>
                            <div className={styles.qaLabel} style={{ marginTop: 10 }}>別解・正誤判定基準</div>
                            <p className={question.altAnswer ? styles.qaAlt : styles.qaAltNone}>{question.altAnswer || '（なし）'}</p>
                        </div>
                    </>
                ) : (
                    <p className={styles.qaAltNone}>問題 {item.number} が登録されていません</p>
                )}
            </div>
        </>
    );
}
