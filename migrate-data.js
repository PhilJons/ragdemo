// Script to migrate data from the old index to the new index with projectId field
const { default: fetch } = require('node-fetch');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '.env.local' });

// Azure Search configuration
const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchApiKey = process.env.AZURE_SEARCH_KEY;
const sourceIndex = "knowledge-index";
const targetIndex = "knowledge-index-with-projectid";

// Constants for batch processing
const BATCH_SIZE = 100;

/**
 * Fetches documents from the source index
 */
async function fetchDocuments(top = 1000) {
  try {
    const response = await fetch(
      `${searchEndpoint}/indexes/${sourceIndex}/docs/search?api-version=2023-11-01`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchApiKey
        },
        body: JSON.stringify({
          search: "*",
          select: "*",
          top: top
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Error fetching documents: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.value;
  } catch (error) {
    console.error("Error fetching documents:", error);
    throw error;
  }
}

/**
 * Uploads documents to the target index
 */
async function uploadDocuments(documents) {
  try {
    // Format the documents according to the Azure Search API requirements
    const actions = documents.map(doc => ({
      "@search.action": "upload",
      ...doc
    }));

    const response = await fetch(
      `${searchEndpoint}/indexes/${targetIndex}/docs/index?api-version=2023-11-01`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchApiKey
        },
        body: JSON.stringify({ value: actions })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Error uploading documents: ${JSON.stringify(error)}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error uploading documents:", error);
    throw error;
  }
}

/**
 * Adds projectId to documents based on sourcefile path
 */
function addProjectIdToDocuments(documents) {
  return documents.map(doc => {
    // Create a copy of the document
    const newDoc = { ...doc };
    
    // Extract projectId from sourcefile if it matches the pattern "projectId/filename"
    if (doc.sourcefile && doc.sourcefile.includes('/')) {
      const parts = doc.sourcefile.split('/');
      // Use the first part as the projectId
      newDoc.projectId = parts[0];
    } else {
      // Fallback to "unknown" if we can't determine the projectId
      newDoc.projectId = "unknown";
    }
    
    return newDoc;
  });
}

/**
 * Main migration function
 */
async function migrateData() {
  try {
    console.log(`Starting migration from ${sourceIndex} to ${targetIndex}`);
    
    // Fetch documents from source index
    console.log("Fetching documents from source index...");
    const sourceDocuments = await fetchDocuments();
    console.log(`Retrieved ${sourceDocuments.length} documents from source index`);
    
    // Add projectId to documents
    console.log("Adding projectId to documents...");
    const documentsWithProjectId = addProjectIdToDocuments(sourceDocuments);
    
    // Process in batches
    const batches = [];
    for (let i = 0; i < documentsWithProjectId.length; i += BATCH_SIZE) {
      batches.push(documentsWithProjectId.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`Processing ${batches.length} batches of size ${BATCH_SIZE}`);
    
    // Upload each batch
    for (let i = 0; i < batches.length; i++) {
      console.log(`Uploading batch ${i + 1} of ${batches.length}...`);
      const result = await uploadDocuments(batches[i]);
      console.log(`Batch ${i + 1} uploaded with ${result.value.length} documents`);
    }
    
    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration
migrateData(); 