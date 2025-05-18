// Migration script to add projectId field to Azure Search index
// Run with: node scripts/migrate-search-index.js

import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// Azure Search configuration
const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchApiKey = process.env.AZURE_SEARCH_KEY;
const oldIndexName = process.env.AZURE_SEARCH_INDEX_NAME;
// Check if the index name already has the suffix
const newIndexName = oldIndexName.endsWith('-with-projectid') 
  ? oldIndexName 
  : `${oldIndexName}-with-projectid`;

// Embeddings dimensions (typically 1536 for OpenAI embeddings)
const embeddingDimensions = 1536;

// Validate environment variables
if (!searchEndpoint || !searchApiKey || !oldIndexName) {
  console.error("Error: Required environment variables are missing.");
  console.error("Make sure AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY, and AZURE_SEARCH_INDEX_NAME are set.");
  process.exit(1);
}

// Initialize clients
const searchCredential = new AzureKeyCredential(searchApiKey);
const searchIndexClient = new SearchIndexClient(searchEndpoint, searchCredential);
const oldSearchClient = new SearchClient(searchEndpoint, oldIndexName, searchCredential);
const newSearchClient = new SearchClient(searchEndpoint, newIndexName, searchCredential);

/**
 * Creates a new index with a projectId field
 */
async function createUpdatedIndex() {
  console.log(`Creating new index: ${newIndexName}`);
  
  try {
    // Create a new index definition 
    const newIndexDefinition = {
      name: newIndexName,
      fields: [
        {
          name: "id",
          type: "Edm.String",
          key: true,
          searchable: false,
          filterable: true
        },
        {
          name: "content",
          type: "Edm.String",
          searchable: true,
          filterable: false
        },
        {
          name: "sourcefile",
          type: "Edm.String",
          searchable: true,
          filterable: true
        },
        {
          name: "originalFileId",
          type: "Edm.String",
          searchable: false,
          filterable: true
        },
        {
          name: "projectId",
          type: "Edm.String",
          searchable: true,
          filterable: true,
          sortable: true,
          facetable: true
        },
        {
          name: "embedding", 
          type: "Collection(Edm.Single)",
          searchable: false,
          dimensions: embeddingDimensions,
          vectorSearchConfiguration: "my-vector-config"
        }
      ],
      vectorSearch: {
        algorithms: [
          {
            name: "my-vector-algorithm",
            kind: "hnsw",
            parameters: {
              m: 4,
              efConstruction: 400,
              efSearch: 500,
              metric: "cosine"
            }
          }
        ],
        profiles: [
          {
            name: "my-vector-config",
            algorithm: "my-vector-algorithm"
          }
        ]
      }
    };
    
    // Create the new index
    const result = await searchIndexClient.createIndex(newIndexDefinition);
    console.log(`Created new index: ${newIndexName}`);
    return result;
  } catch (error) {
    console.error(`Error creating new index:`, error);
    throw error;
  }
}

/**
 * Migrates data from the old index to the new one
 */
async function migrateData() {
  console.log(`Starting data migration from ${oldIndexName} to ${newIndexName}`);
  
  try {
    let documentCount = 0;
    let batchCount = 0;
    const batchSize = 500;
    let batch = [];
    
    // Search for all documents in the old index
    const searchOptions = {
      select: ["*"],  // Select all fields
      top: 1000, // Maximum allowed per page
      includeCount: true
    };
    
    let totalDocuments = 0;
    const searchResult = await oldSearchClient.search("*", searchOptions);
    if (searchResult.count !== undefined) {
      totalDocuments = searchResult.count;
      console.log(`Found ${totalDocuments} documents to migrate`);
    }
    
    // Process all documents
    for await (const result of searchResult.results) {
      const doc = result.document;
      
      // Extract projectId from the sourcefile (assuming format: projectId/filename)
      let projectId = "unknown";
      if (doc.sourcefile && typeof doc.sourcefile === 'string') {
        const sourcefileParts = doc.sourcefile.split('/');
        if (sourcefileParts.length >= 2 && sourcefileParts[0].length > 0) {
          projectId = sourcefileParts[0];
        }
      }
      
      // Create new document with explicit projectId field
      const newDoc = {
        ...doc,
        projectId: projectId
      };
      
      batch.push(newDoc);
      documentCount++;
      
      // Upload in batches
      if (batch.length >= batchSize) {
        await uploadBatch(batch);
        batchCount++;
        console.log(`Uploaded batch ${batchCount} (${documentCount} documents so far)`);
        batch = [];
      }
    }
    
    // Upload any remaining documents
    if (batch.length > 0) {
      await uploadBatch(batch);
      batchCount++;
      console.log(`Uploaded final batch ${batchCount} (${documentCount} documents total)`);
    }
    
    console.log(`Migration complete. Migrated ${documentCount} documents to ${newIndexName}`);
  } catch (error) {
    console.error(`Error during data migration:`, error);
    throw error;
  }
}

/**
 * Uploads a batch of documents to the new index
 */
async function uploadBatch(documents) {
  try {
    const result = await newSearchClient.uploadDocuments(documents);
    const failedCount = result.results.filter(r => !r.succeeded).length;
    
    if (failedCount > 0) {
      console.warn(`Warning: ${failedCount} documents failed to upload in this batch`);
      // Log the first error
      const firstError = result.results.find(r => !r.succeeded);
      if (firstError) {
        console.warn(`First error: ${firstError.errorMessage}`);
      }
    }
    
    return result;
  } catch (error) {
    console.error(`Error uploading batch:`, error);
    throw error;
  }
}

/**
 * Checks if an index exists
 */
async function indexExists(indexName) {
  try {
    await searchIndexClient.getIndex(indexName);
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Prompts the user for input
 */
function promptUser(question) {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    readline.question(question, answer => {
      readline.close();
      resolve(answer);
    });
  });
}

/**
 * Main function to run the migration
 */
async function runMigration() {
  try {
    // Check if the new index already exists
    const indexAlreadyExists = await indexExists(newIndexName);
    let shouldCreateIndex = true;

    if (indexAlreadyExists) {
      const userInput = await promptUser(`Index ${newIndexName} already exists. Delete and recreate it? (y/n): `);
      if (userInput.toLowerCase() === 'y') {
        await searchIndexClient.deleteIndex(newIndexName);
        console.log(`Deleted existing index: ${newIndexName}`);
      } else {
        console.log('Using existing index for migration.');
        shouldCreateIndex = false;
      }
    }
    
    // Create the index if it doesn't exist or was deleted
    if (shouldCreateIndex) {
      await createUpdatedIndex();
    }
    
    // Migrate the data
    await migrateData();
    
    console.log("\n===== MIGRATION COMPLETED SUCCESSFULLY =====");
    console.log("Next steps:");
    console.log(`1. Update your .env or .env.local file to set AZURE_SEARCH_INDEX_NAME=${newIndexName}`);
    console.log("2. Restart your application");
    console.log("3. Verify that search functionality works with the new index");
    console.log("4. Once verified, you can delete the old index if needed");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration
runMigration().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
}); 