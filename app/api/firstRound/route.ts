import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { getAdvantage } from '@/lib/advantage';
import { getSecondRoundGroup } from '@/lib/secondRound';

export async function POST(request: Request) {
  try {
    const { players, confirmClearHistory } = await request.json();

    // 選手名簿を取り込み直すと全選手が新しい id の別レコードになる(id は自動採番)。
    // 各ラウンドの進行履歴(Undo 用スナップショット)は選手 id を参照しているため、
    // 残したままだと「存在しない選手を更新しようとして Undo が必ず失敗する」状態になる。
    // そこで取り込み時に履歴も一緒に削除する。ただしこれは進行データの削除なので、
    // 履歴が残っている場合は、利用者が確認した(confirmClearHistory)場合のみ実行する。
    //
    // 2026-10-20: 3rd Round の抽選結果（ThirdRoundCourse.playOrder）も一緒に空に戻す
    // （ユーザー承認済み）。選手を作り直すと所属コースは空になるのに抽選結果だけ残ると、
    // 3rd Round が「抽選済み・出場者なし」の矛盾した状態から始まってしまうため。
    // 抽選結果が残っている場合も、履歴と同じく確認を取ってから実行する。
    const historyCount =
      (await prisma.secondRoundHistory.count()) +
      (await prisma.thirdRoundHistory.count()) +
      (await prisma.extraRoundHistory.count()) +
      (await prisma.semifinalHistory.count()) +
      (await prisma.finalHistory.count());
    const drawnCourseCount = await prisma.thirdRoundCourse.count({ where: { playOrder: { not: null } } });

    if ((historyCount > 0 || drawnCourseCount > 0) && confirmClearHistory !== true) {
      return NextResponse.json(
        { error: '既存の進行履歴または 3rd Round の抽選結果が残っています', needsConfirmation: true, historyCount, drawnCourseCount },
        { status: 409 }
      );
    }

    // 1st Round には約200名が参加する。2nd Round に進むのは上位48名だけで、
    // 49位以降は組番号もアドバンテージも持たない。
    // 「48名まで」という判断は getSecondRoundGroup に閉じている。
    const rows = players.map((p: string[]) => {
      const paperRank = parseInt(p[0], 10);
      // 参加組を決定（紙落ちは null）
      const group = getSecondRoundGroup(paperRank);

      return {
        paperRank,
        entryNo: parseInt(p[1], 10),
        school: p[2],
        grade: p[3],
        name: p[4],
        secondRoundGroupNumber: group,
        // 各組の1R上位6名はアドバンテージを持った状態でスタートする。
        // 2nd Round に出ない選手には付けない。
        secondRoundPoint: group === null ? 0 : getAdvantage(paperRank)
      };
    });

    await prisma.$transaction(async (tx) => {
      // 選手削除と同じトランザクションで履歴も消す(片方だけ消えた状態を作らない)。
      await tx.secondRoundHistory.deleteMany({});
      await tx.thirdRoundHistory.deleteMany({});
      await tx.extraRoundHistory.deleteMany({});
      await tx.semifinalHistory.deleteMany({});
      await tx.finalHistory.deleteMany({});
      // 3rd Round の抽選結果も空に戻す（3rd Round 管理画面の「抽選をリセット」と同じ）
      await tx.thirdRoundCourse.updateMany({ data: { playOrder: null } });
      await tx.player.deleteMany({});
      // 1件ずつ create すると{player数}件で往復が{player数}回になる。createMany なら1回で済む
      await tx.player.createMany({ data: rows });
    });

    // 取り込み後の全選手と3rd Round のコースも返す。Admin がそのまま各画面に配信する
    // （開いている Main・Admin を再読み込みなしで新しい状態にするため）
    const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });
    const courses = await prisma.thirdRoundCourse.findMany({ orderBy: [{ playOrder: 'asc' }, { id: 'asc' }] });

    // 何名取り込んだかを返す。48名のつもりが200名だった、という取り違えに気づける
    return NextResponse.json({ success: true, count: rows.length, allPlayers, courses });
  } catch (error) {
    console.log('CSV Upload Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
