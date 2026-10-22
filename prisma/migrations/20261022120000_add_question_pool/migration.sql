-- CreateTable
CREATE TABLE "QuestionPoolItem" (
    "serial" INTEGER NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "altAnswer" TEXT NOT NULL DEFAULT ''
);
