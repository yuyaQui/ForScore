-- AlterTable: 大会名（2026-11-02 追加）
ALTER TABLE "TournamentState" ADD COLUMN "tournamentName" TEXT NOT NULL DEFAULT '';
