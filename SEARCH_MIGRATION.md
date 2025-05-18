# Azure Search Index Migration

This document provides instructions for migrating your existing Azure AI Search index to include a new `projectId` field, which enables more efficient project-based filtering.

## Why This Migration Is Needed

Previously, our application used a workaround to filter documents by project:
- We stored the project ID as part of the `sourcefile` field (e.g., `projectId/filename.txt`)
- We used fuzzy text matching to filter documents by project

This approach had limitations:
- Less efficient queries
- Potential false matches
- More complex code needed to parse the sourcefile

By adding a dedicated `projectId` field to the index, we can:
- Use exact matching for more reliable filtering
- Improve query performance
- Simplify the code that interacts with the search index

## Prerequisites

Before running the migration:

1. Ensure your `.env.local` or `.env` file contains:
   - `AZURE_SEARCH_ENDPOINT`
   - `AZURE_SEARCH_KEY`
   - `AZURE_SEARCH_INDEX_NAME`

2. Make sure you have sufficient permissions in your Azure AI Search service to:
   - Read from the existing index
   - Create a new index
   - Write documents to the new index

## Running the Migration

The migration process will:
1. Create a new index with the proper `projectId` field
2. Copy all documents from the old index to the new one
3. Extract the project ID from each document's sourcefile
4. Add the explicit `projectId` field to each document

To run the migration:

```bash
# Install dependencies if needed
npm install

# Run the migration script
npm run migrate:search
```

## After Migration

Once the migration completes successfully:

1. Update your `.env.local` or `.env` file:
   ```
   AZURE_SEARCH_INDEX_NAME=your-old-index-name-with-projectid
   ```

2. Restart your application:
   ```bash
   npm run dev
   ```

3. Test that search functionality works correctly, particularly:
   - Project-specific search results
   - Uploading new files (they should now include the proper projectId field)
   - Viewing project-specific sources

4. If everything works as expected, you can optionally delete the old index through the Azure portal.

## Troubleshooting

If you encounter issues:

1. Check the console output for error messages
2. Verify that the new index was created correctly
3. Ensure that documents were migrated successfully
4. Make sure all application code is updated to use the `projectId` field

If you need to rollback:
1. Change your `AZURE_SEARCH_INDEX_NAME` back to the original value
2. Restart your application

## Code Changes Summary

The migration process updated:

1. `lib/ai/search.ts`: Updated to use the `projectId` field for filtering
2. `app/api/settings/sources/route.ts`: Updated to use `projectId` field in GET and POST handlers
3. Added a migration script: `scripts/migrate-search-index.js`
4. Added an npm script: `migrate:search` 