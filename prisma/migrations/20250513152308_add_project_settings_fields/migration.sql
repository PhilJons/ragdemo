-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "activeProjectPromptId" TEXT,
    "activeGlobalPromptName" TEXT,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_activeProjectPromptId_fkey" FOREIGN KEY ("activeProjectPromptId") REFERENCES "ProjectPrompt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("createdAt", "description", "id", "name", "updatedAt") SELECT "createdAt", "description", "id", "name", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");
CREATE UNIQUE INDEX "Project_activeProjectPromptId_key" ON "Project"("activeProjectPromptId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
