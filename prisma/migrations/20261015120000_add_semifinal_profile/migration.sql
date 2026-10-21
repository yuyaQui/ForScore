-- AlterTable
ALTER TABLE "Player" ADD COLUMN "nickname" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "PlayerPhoto" (
    "playerId" INTEGER NOT NULL PRIMARY KEY,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerPhoto_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
