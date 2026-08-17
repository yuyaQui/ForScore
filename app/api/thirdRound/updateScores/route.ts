import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    applyThirdRoundScore,
    finalizeCourseByStandings,
    type ThirdRoundAction
} from '@/lib/thirdRoundScoring';
import { THIRD_ROUND_COURSE_NAMES, type ThirdRoundCourseName } from '@/lib/thirdRoundCourses';

/** 全選手の最新状態を返す（Socket 配信でそのまま使う） */
async function loadAllPlayers() {
    return prisma.player.findMany({ orderBy: { paperRank: 'asc' } });
}

/**
 * このルートが受け付ける操作。
 *
 * finish は採点ではなく「コースを締めて判定基準で順位を確定する」操作だが、
 * スナップショット・履歴保存・変化検出・配信の流れが正誤とまったく同じなので
 * 同じルートで扱う。別ルートにするとその一式を複製することになり、**コース終了を
 * Undo できなくなる**。採点用の ThirdRoundAction 型（正誤3種）は広げない。
 */
type UpdateScoresAction = ThirdRoundAction | 'finish';

const VALID_ACTIONS: UpdateScoresAction[] = ['correct', 'wrong', 'through', 'finish'];

/**
 * POST: 3rd Round のスコアを更新する
 *
 * このルートの仕事は DB とのやりとりだけ。ルールの計算は lib/thirdRoundScoring.ts の
 * 純関数が行う。コースが4つあり誤答ルールがそれぞれ違うため、分岐をここに書くと
 * ルートが膨らみ、2nd Round で踏んだような取り違えが起きやすくなる。
 *
 * 現時点で反映されるのは「正解で正解数 +1」だけ。コース別のルールと
 * 勝ち抜け・失格の判定は工程7-3 以降で純関数の中に足していく。
 */
export async function POST(request: Request) {
    try {
        const { playerId, action, courseName } = await request.json();

        if (!VALID_ACTIONS.includes(action)) {
            return NextResponse.json({ error: 'action が不正です' }, { status: 400 });
        }

        // どのコースへの操作かは常にクライアントから受け取る。
        // スルーは「問題が1問終わった」というイベントで対象選手がいないため、
        // playerId から所属コースを引く方法が使えない（設計メモ 3.3）。
        if (!courseName) {
            return NextResponse.json({ error: 'コース名が指定されていません' }, { status: 400 });
        }

        // コース名は DB の外部キーで保証されているが、採点関数の分岐がこの4つを
        // 前提にしているため、想定外の値をそのまま渡さないようここでも確認する。
        if (!THIRD_ROUND_COURSE_NAMES.includes(courseName as ThirdRoundCourseName)) {
            return NextResponse.json(
                { error: `未知のコース名です: ${courseName}` },
                { status: 400 }
            );
        }

        // 採点はコース単位。Freeze 10 で他人の休みカウントを減らす必要があるため、
        // 1人だけでなくそのコースの出場者全員を読む。
        const coursePlayers = await prisma.player.findMany({
            where: { thirdRoundCourseName: courseName },
            orderBy: { paperRank: 'asc' }
        });

        // 正解・誤答は対象選手が要る。
        // スルーとコース終了は選手に紐づかないので playerId を見ない。
        if (action !== 'through' && action !== 'finish') {
            if (!coursePlayers.some(p => p.id === playerId)) {
                // Admin の表示が古い状態で押されたときに、別コースの選手を採点して
                // しまう事故を防ぐ。所属の確認をコース一覧の中で行う。
                return NextResponse.json(
                    { error: 'この選手は指定されたコースの出場者ではありません' },
                    { status: 400 }
                );
            }
        }

        // Undo 用のスナップショット（更新「前」の状態）を、読んだ直後に固める。
        // 現在の applyThirdRoundScore は引数を書き換えないので実際には後で作っても
        // 同じだが、2nd Round では「取得した配列を書き換える処理」が後から入った結果
        // 履歴が更新後の状態になるバグが出た。順序を規律として先に固定しておく。
        const snapshot = JSON.stringify(coursePlayers);

        // コース終了は採点ではなく順位の確定なので、別の関数へ振り分ける
        const updated = action === 'finish'
            ? finalizeCourseByStandings(courseName as ThirdRoundCourseName, coursePlayers)
            : applyThirdRoundScore({
                course: courseName as ThirdRoundCourseName,
                players: coursePlayers,
                playerId: action === 'through' ? null : playerId,
                action
            });

        // 変化した選手だけを書き戻す。
        // 毎回全員を UPDATE すると、2nd Round で連答権を消してしまったのと同じ種類の
        // 事故（他人の状態を無条件に上書きする）が起きうる。
        //
        // 突き合わせは id で行う。配列の並び順に頼ると、採点関数が将来
        // 並べ替えを行ったときに別人の値と比較してしまう。
        const before = new Map(coursePlayers.map(p => [p.id, JSON.stringify(p)]));
        const changed = updated.filter(p => before.get(p.id) !== JSON.stringify(p));

        // 何も変わらなかった操作では履歴を残さない。
        // 残すと「Undo を押しても何も起きない空振りの1手」ができてしまう。
        if (changed.length > 0) {
            await prisma.$transaction([
                prisma.thirdRoundHistory.create({
                    data: { course: courseName, snapshot }
                }),
                ...changed.map(p =>
                    prisma.player.update({
                        where: { id: p.id },
                        data: {
                            thirdRoundCorrectCount: p.thirdRoundCorrectCount,
                            thirdRoundWrongCount: p.thirdRoundWrongCount,
                            thirdRoundUpDownPoint: p.thirdRoundUpDownPoint,
                            thirdRoundSwedishCross: p.thirdRoundSwedishCross,
                            thirdRoundFreezeRest: p.thirdRoundFreezeRest,
                            thirdRoundRank: p.thirdRoundRank
                        }
                    })
                )
            ]);
        }

        const allPlayers = await loadAllPlayers();

        // 15分タイマーは「勝ち抜けまたは失格が出たときのみ止まる」（設計メモ 4.2）。
        // server/ は DB を見ないので勝ち抜けを知らない。ここで判定して返し、
        // Admin が socket でタイマー停止を中継する。
        //
        // 判定は「rank が 0 から変わった選手がいるか」。rank の規約は
        // 勝ち抜け → 正の数、失格 → −1、未決着 → 0 なので、この1つの式で両方を拾える。
        const rankBefore = new Map(coursePlayers.map(p => [p.id, p.thirdRoundRank]));
        const shouldStopTimer = updated.some(
            p => rankBefore.get(p.id) === 0 && p.thirdRoundRank !== 0
        );

        return NextResponse.json({ success: true, allPlayers, shouldStopTimer });
    } catch (error) {
        console.error('Third round score update error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
