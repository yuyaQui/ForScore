import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const { playerId, action } = await request.json();

    if (!playerId || !action) {
      return NextResponse.json({ error: 'Missing playerId or action' }, { status: 400 });
    }

    // プレイヤーと現在のスコアを取得
    const player = await prisma.player.findUnique({
      where: { id: playerId }
    });

    if (!player) {
      return NextResponse.json({ error: 'Missing player' }, { status: 400 });
    }

    const groupNumber = player.secondRoundGroupNumber;
    let point = player.secondRoundPoint;
    let wrongCount = player.secondRoundWrongCount;
    let doubleChance = player.secondRoundDoubleChance;
    let rank = player.secondRoundRank;
    // 自分の正解によって他人の連答権が消失するか
    let shouldResetOtherDouble = false;

    // 同じグループのプレイヤーを取得
    const groupPlayers = await prisma.player.findMany({
      where: { secondRoundGroupNumber: groupNumber }
    });

    // Undo 用のスナップショット（更新「前」の状態）をこの時点で文字列に固める。
    // このあとの終了時処理が groupPlayers の中身を直接書き換えるため、
    // 履歴保存の直前に stringify すると「更新後」の状態が保存されてしまう。
    const snapshot = JSON.stringify(groupPlayers);

    // 連答権を持っているプレイヤーを取得（自分以外）
    const doublePlayer = groupPlayers.find(p =>
      p.secondRoundDoubleChance && p.id !== playerId
    );

    // 組の勝抜状況
    let winnersCount = groupPlayers.filter(p => p.secondRoundRank > 0).length;
    let losersCount = groupPlayers.filter(p => p.secondRoundRank < 0).length;

    // 「5○2×」のルール処理

    // 正解時の処理
    if (action === 'correct') {
      if (point < 5) {
        if (doubleChance) {
          point += 2;
          doubleChance = false;
        } else {
          point += 1;
          if (doublePlayer) shouldResetOtherDouble = true;
          doubleChance = true;
        }
      }
      // 勝抜処理
      if (point >= 5 && rank === 0) {
        doubleChance = false;
        const allPlayers = prisma.player.findMany();
        const sameGroupWinners = (await allPlayers).filter(p => {
          const r = p.secondRoundGroupNumber;
          return r === groupNumber && p.secondRoundRank > 0;
        });
        rank = sameGroupWinners.length + 1;
        winnersCount++;
      }
    }
    // 誤答時の処理
    else if (action === 'wrong') {
      wrongCount += 1;
      doubleChance = false;
      // 失格処理
      if (wrongCount >= 2) {
        rank = -1;
        losersCount++;
      }
    }

    // 正解 or 誤答処理後の勝抜状況
    const activeCount = 12 - winnersCount - losersCount;
    const remainWinnersCount = 5 - winnersCount;

    // ラウンド終了時処理
    // 「5名勝ち抜け」または「残り人数＝残り勝抜枠」（＝7名失格）で組が終了する
    let isGroupFinished = false;
    if (winnersCount === 5 || activeCount === remainWinnersCount) {
      isGroupFinished = true;
      if (winnersCount === 5) {
        groupPlayers.forEach(p => {
          if (p.secondRoundRank === 0) p.secondRoundRank = -1;
        })
      }
      else {
        const activePlayers = groupPlayers.filter(p =>
          p.id !== playerId && p.secondRoundRank === 0
        )
        const sortedActivePlayers = [...activePlayers].sort((a, b) => {
          if (b.secondRoundPoint !== a.secondRoundPoint) {
            return b.secondRoundPoint - a.secondRoundPoint;
          }
          if (a.secondRoundWrongCount !== b.secondRoundWrongCount) {
            return a.secondRoundWrongCount - b.secondRoundWrongCount;
          }
          return a.paperRank - b.paperRank;
        })
        sortedActivePlayers.slice(0, remainWinnersCount).forEach((p, idx) => {
          p.secondRoundRank = winnersCount + idx + 1;
        })
      }
    }

    // デバッグ用のログ
    console.log(`残り勝抜枠は ${remainWinnersCount} 人です`);

    // DBへ反映（トランザクション処理）
    await prisma.$transaction(async (tx) => {
      // 0. 更新前のグループの状態を履歴に保存
      await tx.secondRoundHistory.create({
        data: {
          secondRoundGroupNumber: groupNumber || 1,
          snapshot
        }
      });

      // 自分のスコア反映
      await tx.player.update({
        where: { id: playerId },
        data: {
          secondRoundPoint: point,
          secondRoundWrongCount: wrongCount,
          secondRoundDoubleChance: doubleChance,
          secondRoundRank: rank
        }
      })
      // 連答権削除
      // 連答権が解消するのは「連答状態で正解」「自身が誤答」「他人が正解」の3つ。
      // 他人が誤答した場合とスルーの場合は維持されるため、
      // ここで消してよいのは「自分が正解したとき」の保持者1名だけ。
      if (shouldResetOtherDouble && doublePlayer) {
        await tx.player.update({
          where: { id: doublePlayer.id },
          data: { secondRoundDoubleChance: false }
        })
      }
      // 自分以外
      // 組の終了が確定したときだけ、勝抜・失格の確定結果を書き込む。
      // （終了していないのに毎回書き込むと、他人の連答権まで消えてしまう）
      if (isGroupFinished) {
        const otherPlayers = groupPlayers.filter(p => p.id !== playerId);
        for (const p of otherPlayers) {
          await tx.player.update({
            where: { id: p.id },
            data: {
              secondRoundRank: p.secondRoundRank,
              secondRoundDoubleChance: false
            }
          });
        }
      }
    })

    // 更新後、全プレイヤーの最新状態を取得
    const allPlayers = await prisma.player.findMany({
      orderBy: { paperRank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      allPlayers
    });

  } catch (error) {
    console.error('Score update error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
