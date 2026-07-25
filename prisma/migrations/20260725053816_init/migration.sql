-- CreateTable
CREATE TABLE "Player" (
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
    "thirdRoundCourse" TEXT
);

-- CreateTable
CREATE TABLE "Match" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "currentRound" INTEGER NOT NULL DEFAULT 1,
    "currentSet" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SecondRoundHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "secondRoundGroupNumber" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_entryNo_key" ON "Player"("entryNo");
