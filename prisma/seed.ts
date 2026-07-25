/**
 * 開発用シードスクリプト
 *
 *   npx prisma db seed
 *
 * プロジェクト直下の test_players.csv（1R順位1〜48位のテストデータ）を読み込み、
 * 2nd Round がすぐ動かせる状態まで DB を作る。
 * /admin からの CSV アップロードと同じ処理を、コマンドから実行できるようにしたもの。
 *
 * CSV の列は /admin のアップロードと同一:
 *   1R順位, エントリーNo, 学校, 学年, 氏名
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getAdvantage } from '../lib/advantage';

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

  if (players.length !== 48) {
    console.warn(`  警告: 1st Round 通過者は48名の想定ですが ${players.length} 名です`);
  }

  // 1. 既存データをリセット
  //    Player より先に履歴を消す（2nd Round の Undo 用スナップショット）
  await prisma.secondRoundHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.match.deleteMany();

  // 2. 選手を登録
  //    組分けとアドバンテージは /admin の CSV アップロード（app/api/firstRound）と同じ規則で決める
  for (const p of players) {
    await prisma.player.create({
      data: {
        paperRank: p.paperRank,
        entryNo: p.entryNo,
        school: p.school,
        grade: p.grade,
        name: p.name,
        secondRoundGroupNumber: (p.paperRank % 4) || 4,
        secondRoundPoint: getAdvantage(p.paperRank),
      },
    });
  }

  // 組ごとの内訳を出して、投入結果をその場で確認できるようにする
  for (let group = 1; group <= 4; group++) {
    const members = players
      .filter(p => ((p.paperRank % 4) || 4) === group)
      .sort((a, b) => a.paperRank - b.paperRank);
    const summary = members.map(p => `${p.paperRank}位(+${getAdvantage(p.paperRank)})`).join(' ');
    console.log(`  第${group}組 (${members.length}名): ${summary}`);
  }

  // 3. 大会の初期状態
  await prisma.match.create({
    data: { currentRound: 1, currentSet: 1, status: 'waiting' },
  });

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
