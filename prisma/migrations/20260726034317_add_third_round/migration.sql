/*
  Warnings:

  - You are about to drop the `Match` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `thirdRoundCourse` on the `Player` table. All the data in the column will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Match";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ThirdRoundCourse" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "playOrder" INTEGER
);

-- CreateTable
CREATE TABLE "ThirdRoundHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "course" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Player" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entryNo" INTEGER NOT NULL,
    "paperRank" INTEGER NOT NULL,
    "school" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secondRoundGroupNumber" INTEGER,
    "secondRoundPoint" INTEGER NOT NULL DEFAULT 0,
    "secondRoundWrongCount" INTEGER NOT NULL DEFAULT 0,
    "secondRoundDoubleChance" BOOLEAN NOT NULL DEFAULT false,
    "secondRoundRank" INTEGER NOT NULL DEFAULT 0,
    "thirdRoundCourseName" TEXT,
    "thirdRoundCorrectCount" INTEGER NOT NULL DEFAULT 0,
    "thirdRoundWrongCount" INTEGER NOT NULL DEFAULT 0,
    "thirdRoundUpDownPoint" INTEGER NOT NULL DEFAULT 0,
    "thirdRoundSwedishCross" INTEGER NOT NULL DEFAULT 0,
    "thirdRoundFreezeRest" INTEGER NOT NULL DEFAULT 0,
    "thirdRoundRank" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Player_thirdRoundCourseName_fkey" FOREIGN KEY ("thirdRoundCourseName") REFERENCES "ThirdRoundCourse" ("name") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Player" ("entryNo", "grade", "id", "name", "paperRank", "school", "secondRoundDoubleChance", "secondRoundGroupNumber", "secondRoundPoint", "secondRoundRank", "secondRoundWrongCount") SELECT "entryNo", "grade", "id", "name", "paperRank", "school", "secondRoundDoubleChance", "secondRoundGroupNumber", "secondRoundPoint", "secondRoundRank", "secondRoundWrongCount" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_entryNo_key" ON "Player"("entryNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ThirdRoundCourse_name_key" ON "ThirdRoundCourse"("name");

INSERT INTO "ThirdRoundCourse" ("name") VALUES
  ('10 up-down'), ('Freeze 10'), ('Swedish 10'), ('10 by 10');