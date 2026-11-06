-- 大会ロゴ（2026-11-06）。1行だけ（id は常に 1）
-- CreateTable
CREATE TABLE "TournamentLogo" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
