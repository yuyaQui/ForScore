/**
 * 開発用シードスクリプト
 *
 *   npx prisma db seed
 *
 * プロジェクト直下の test_players.csv（1R順位1〜200位のテストデータ）を読み込み、
 * 2nd Round がすぐ動かせる状態まで DB を作る。
 * /admin からの CSV アップロードと同じ処理を、コマンドから実行できるようにしたもの。
 *
 * 1st Round には約200名が参加し、その全員を DB に入れる。Extra Round が
 * 「準決勝進出の8名を除いた敗退者全員」で行われるため、48位以降の選手も
 * 敗者復活する可能性があるため。2nd Round に出るのは上位48名だけ。
 *
 * CSV の列は /admin のアップロードと同一:
 *   1R順位, エントリーNo, 学校, 学年, 氏名
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getAdvantage } from '../lib/advantage';
import { getSecondRoundGroup, SECOND_ROUND_PLAYER_COUNT } from '../lib/secondRound';

// .env が読み込まれていない場合のフォールバック。
// sqlite の相対パスは schema.prisma のある prisma/ を基準に解決されるため、
// この値は .env の DATABASE_URL と同じ prisma/dev.db を指す。
process.env.DATABASE_URL ??= 'file:./dev.db';

const prisma = new PrismaClient();

const CSV_PATH = path.resolve(__dirname, '../test_players.csv');

type SeedPlayer = {
  paperRank: number;
  entryNo: number;
  school: string;
  grade: string;
  name: string;
};

/** CSV を読み込んで選手データの配列にする */
function loadPlayersFromCsv(): SeedPlayer[] {
  const text = readFileSync(CSV_PATH, 'utf-8').replace(/^﻿/, ''); // BOM を除去

  return text
    .split('\n')
    .map(row => row.trim())
    .filter(row => row !== '')
    .map((row, index) => {
      const cells = row.split(',').map(c => c.trim());

      if (cells.length < 5) {
        throw new Error(`${index + 1}行目の列数が足りません: "${row}"`);
      }

      const paperRank = parseInt(cells[0], 10);
      const entryNo = parseInt(cells[1], 10);

      if (Number.isNaN(paperRank) || Number.isNaN(entryNo)) {
        throw new Error(`${index + 1}行目の順位/エントリーNoが数値ではありません: "${row}"`);
      }

      return { paperRank, entryNo, school: cells[2], grade: cells[3], name: cells[4] };
    });
}

async function main() {
  // 本番環境では実行を拒否する。
  // このスクリプトは最初に選手を全削除するため、
  // 大会当日に誤って叩くと本番データがサンプルデータで上書きされてしまう。
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed は開発用です。NODE_ENV=production では実行できません。'
    );
  }

  console.log('Start seeding...');

  const players = loadPlayersFromCsv();
  console.log(`  ${CSV_PATH} から ${players.length} 名を読み込みました`);

  // 1st Round は全参加者を取り込むので人数の想定は置かない。
  // ただし 2nd Round に出る48名が揃っていないとラウンドが成立しないため、そこは確認する。
  if (players.length < SECOND_ROUND_PLAYER_COUNT) {
    console.warn(
      `  警告: 2nd Round には ${SECOND_ROUND_PLAYER_COUNT} 名必要ですが ${players.length} 名しかいません`
    );
  }

  // 1. 既存データをリセット
  //    Player より先に履歴を消す（Undo 用スナップショット）
  await prisma.secondRoundHistory.deleteMany();
  await prisma.thirdRoundHistory.deleteMany();
  await prisma.player.deleteMany();

  // ThirdRoundCourse は消さない。
  // 4行はマイグレーションで投入したマスタデータであり、
  // Player.thirdRoundCourseName の参照先でもあるため。
  // 抽選結果（playOrder）だけ初期化する。
  await prisma.thirdRoundCourse.updateMany({ data: { playOrder: null } });

  // 2. 選手を登録
  //    組分けとアドバンテージは /admin の CSV アップロード（app/api/firstRound）と同じ規則で決める
  //    1件ずつ create すると200件で往復が200回になるため createMany を使う
  await prisma.player.createMany({
    data: players.map(p => {
      const group = getSecondRoundGroup(p.paperRank);
      return {
        paperRank: p.paperRank,
        entryNo: p.entryNo,
        school: p.school,
        grade: p.grade,
        name: p.name,
        secondRoundGroupNumber: group,
        // 2nd Round に出ない選手にはアドバンテージを付けない
        secondRoundPoint: group === null ? 0 : getAdvantage(p.paperRank),
      };
    }),
  });

  // 組ごとの内訳を出して、投入結果をその場で確認できるようにする。
  // ここでも組の判定は getSecondRoundGroup に任せる（%4 を書かない）
  for (let group = 1; group <= 4; group++) {
    const members = players
      .filter(p => getSecondRoundGroup(p.paperRank) === group)
      .sort((a, b) => a.paperRank - b.paperRank);
    const summary = members.map(p => `${p.paperRank}位(+${getAdvantage(p.paperRank)})`).join(' ');
    console.log(`  第${group}組 (${members.length}名): ${summary}`);
  }

  // 2nd Round に出ない選手の人数も出す。取込の取り違えに気づけるようにする
  const notInSecondRound = players.filter(p => getSecondRoundGroup(p.paperRank) === null);
  console.log(`  2nd Round に出ない選手: ${notInSecondRound.length}名（49位以降）`);

  // 3. コースの投入状況を確認する
  //    マイグレーションで4行が入っているはずなので、欠けていれば警告する
  const courses = await prisma.thirdRoundCourse.findMany({ orderBy: { id: 'asc' } });
  console.log(`  3rd Round コース: ${courses.map(c => c.name).join(' / ') || '(なし)'}`);

  if (courses.length !== 4) {
    console.warn(
      `  警告: ThirdRoundCourse が ${courses.length} 行しかありません。` +
      ' マイグレーションの INSERT が適用されているか確認してください。'
    );
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
