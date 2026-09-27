-- CreateTable
CREATE TABLE "SemifinalHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "extraRoundSecondStep" BOOLEAN NOT NULL DEFAULT false,
    "extraRoundCorrectCount" INTEGER NOT NULL DEFAULT 0,
    "extraRoundRank" INTEGER NOT NULL DEFAULT 0,
    "semifinalPoint" INTEGER NOT NULL DEFAULT 0,
    "semifinalRank" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Player_thirdRoundCourseName_fkey" FOREIGN KEY ("thirdRoundCourseName") REFERENCES "ThirdRoundCourse" ("name") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Player" ("entryNo", "extraRoundCorrectCount", "extraRoundRank", "extraRoundSecondStep", "grade", "id", "name", "paperRank", "school", "secondRoundDoubleChance", "secondRoundGroupNumber", "secondRoundPoint", "secondRoundRank", "secondRoundWrongCount", "thirdRoundCorrectCount", "thirdRoundCourseName", "thirdRoundFreezeRest", "thirdRoundRank", "thirdRoundSwedishCross", "thirdRoundUpDownPoint", "thirdRoundWrongCount") SELECT "entryNo", "extraRoundCorrectCount", "extraRoundRank", "extraRoundSecondStep", "grade", "id", "name", "paperRank", "school", "secondRoundDoubleChance", "secondRoundGroupNumber", "secondRoundPoint", "secondRoundRank", "secondRoundWrongCount", "thirdRoundCorrectCount", "thirdRoundCourseName", "thirdRoundFreezeRest", "thirdRoundRank", "thirdRoundSwedishCross", "thirdRoundUpDownPoint", "thirdRoundWrongCount" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_entryNo_key" ON "Player"("entryNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
