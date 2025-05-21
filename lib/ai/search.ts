import { SearchClient, AzureKeyCredential, SearchOptions, VectorQuery } from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";
import { embed } from "ai";
import { azure } from "@ai-sdk/azure";
import { createHash } from "crypto";
import { generateEmbedding } from "@/lib/azureOpenAI";

// Restore local embedding model and function
const embeddingModel = azure.textEmbeddingModel(process.env.AZURE_EMBEDDING_DEPLOYMENT_NAME!);

const endpoint = process.env.AZURE_SEARCH_ENDPOINT!;
const indexName = process.env.AZURE_SEARCH_INDEX_NAME!;
const credential = process.env.AZURE_SEARCH_KEY
  ? new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
  : new DefaultAzureCredential();
const USER_AGENT_PREFIX = "vercel-nextjs-azs";

const searchClient = new SearchClient(
  endpoint,
  indexName,
  credential,
  {
    userAgentOptions: {
      userAgentPrefix: USER_AGENT_PREFIX,
    },
    serviceVersion: "2023-11-01" // Correct parameter name: serviceVersion
  }
);

// Simple in-memory cache for embeddings
const embeddingCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 1000;

// Define field names
const contentColumn = process.env.AZURE_SEARCH_CONTENT_FIELD!;
const embeddingFieldName = process.env.AZURE_SEARCH_VECTOR_FIELD || 'embedding';
const sourcefileFieldName = 'sourcefile'; // Define the source file field name

if (!endpoint || !credential || !indexName) {
  throw new Error("Azure Search environment variables not fully configured.");
}

// findRelevantContent uses the imported generateEmbedding
export const findRelevantContent = async (userQuery: string, projectId?: string) => {
  try {
    const searchOptions: SearchOptions<object, string> = {
      top: 5, // Note: Semantic ranking operates on top 50 results from initial retrieval.
      select: ["id", contentColumn, sourcefileFieldName]
    };

    let semanticConfigName: string | undefined;
    if (process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION_NAME) {
      // semanticConfigName = process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION_NAME;
      // The following lines are commented out due to persistent type errors
      // with @azure/search-documents@^12.1.0. Neither direct assignment to
      // searchOptions.queryType/semanticConfiguration nor using a nested
      // searchOptions.semanticSearch object resolved the TypeScript errors.
      // Further investigation into the specific SDK version's API or potential
      // type conflicts would be needed.
      // searchOptions.queryType = "semantic"; 
      // searchOptions.semanticSearch = { configurationName: semanticConfigName };
      console.warn(
        "Semantic search configuration is temporarily disabled due to persistent type errors. Please verify the correct configuration for @azure/search-documents@^12.1.0."
      );
    }

    if (process.env.AZURE_SEARCH_VECTOR_FIELD) {
      const vectorFieldName = process.env.AZURE_SEARCH_VECTOR_FIELD!;
      let userQueryEmbedded: number[];

      // Use embedding cache (logic restored)
      if (embeddingCache.has(userQuery)) {
        userQueryEmbedded = embeddingCache.get(userQuery)!;
        // Commented out verbose embedding logs
        // console.log("Using cached embedding for query:", userQuery);
      } else {
        // Commented out verbose embedding logs
        // console.log("Generating new embedding for query:", userQuery);
        userQueryEmbedded = await generateEmbedding(userQuery); // Uses imported function
        embeddingCache.set(userQuery, userQueryEmbedded);
        // Cache pruning logic (restored)
        if (embeddingCache.size > MAX_CACHE_SIZE) {
          const oldestKey = embeddingCache.keys().next().value;
          if (oldestKey !== undefined) {
            embeddingCache.delete(oldestKey);
            // Commented out verbose embedding logs
            // console.log("Cache size limit reached, removed oldest entry:", oldestKey);
          } else {
            // Commented out verbose embedding logs
            // console.warn("Attempted to prune cache, but oldestKey was undefined despite cache size exceeding limit.");
          }
        }
      }

      const kCount = semanticConfigName ? 50 : 5;
      // Removed explicit VectorQuery type annotation
      const vectorQuery = {
        kind: "vector" as const, // Keep 'as const' if needed for type inference later
        fields: [vectorFieldName],
        kNearestNeighborsCount: kCount,
        vector: userQueryEmbedded,
      };
      searchOptions.vectorSearchOptions = {
        queries: [vectorQuery],
      };
    }

    // Expand search scope to include metadata fields like title and sourcefile so that
    // queries referencing specific file names or document titles can be matched even
    // when the user does not use the exact content text. This requires those fields
    // to be marked as searchable in your Azure AI Search index definition.

    searchOptions.searchFields = [contentColumn, "title", sourcefileFieldName];

    // Add filter expression to search only in specified project if provided
    if (projectId) {
      try {
        // First try using the dedicated projectId field
        searchOptions.filter = `projectId eq '${projectId}'`;
        console.log(`[lib/ai/search.ts] Filtering search results to project: ${projectId}`);
      } catch (filterError: any) {
        // Fall back to the sourcefile approach if the projectId field isn't available
        console.warn(`[lib/ai/search.ts] Error using projectId field for filtering: ${filterError.message}`);
        console.log("[lib/ai/search.ts] Falling back to sourcefile pattern matching for project filtering");
        searchOptions.filter = `search.ismatchscoring('${projectId}', '${sourcefileFieldName}')`;
      }
    }

    // Log search options without the verbose vector
    const { vectorSearchOptions, ...searchOptionsForLogging } = searchOptions;
    let loggedVectorInfo = "No vector search.";
    if (vectorSearchOptions && vectorSearchOptions.queries && vectorSearchOptions.queries.length > 0) {
      // Create a copy of the query to avoid modifying the original searchOptions
      const queryForLogging = { ...vectorSearchOptions.queries[0] };
      // Delete the vector property from the copy for logging purposes
      // @ts-ignore TS might complain as we are deliberately deleting a required property for logging
      delete queryForLogging.vector; 
      loggedVectorInfo = `Vector search query details: ${JSON.stringify(queryForLogging, null, 2)} (vector itself excluded from log)`;
    }
    console.log(`[lib/ai/search.ts] Using index: '${searchClient.indexName}'. Search options (vector details logged separately if present, vector array excluded):`, 
      JSON.stringify(searchOptionsForLogging, null, 2), 
      loggedVectorInfo
    );

    const searchResults = await searchClient.search(userQuery, searchOptions);

    const similarDocs = [];
    
    for await (const result of searchResults.results) {
      const doc = result.document as any; // Use 'any' for easier access
      // Check for required fields
      if (doc && typeof doc.id === 'string' && 
          typeof doc[contentColumn] === 'string' && 
          typeof doc[sourcefileFieldName] === 'string') {
            
            // Use original ID if available, otherwise generate hash (as fallback or default? Decide based on need)
            // For consistency with previous logic, let's prioritize the original ID if present.
            // If your index key is always generated like `${originalFileId}_chunk_${i}`, 
            // you might prefer to derive the citation ID from that.
            // Here, we'll use the document's actual ID.
            const docId = doc.id; 

            similarDocs.push({
                text: doc[contentColumn],
                id: docId, // Use the document's ID
                similarity: result.score, // Keep similarity score
                sourcefile: doc[sourcefileFieldName] // Add sourcefile
            });
      } else {
          console.warn("Skipping search result due to missing fields (id, content, or sourcefile):", doc);
      }
    }

    // Handle no results (restored)
    if (similarDocs.length === 0) {
      console.log("No relevant documents found by search.");
       return [{ id: 'no-results', text: 'No relevant documents found.', similarity: 0, sourcefile: '' }];
    }

    return similarDocs;

  } catch (error) {
    console.error("Error in findRelevantContent:", error); // Log the full error object
    // Log specific properties if they exist, for more structured logging
    if (error instanceof Error) {
      console.error(`findRelevantContent Error Details: message=${error.message}, stack=${error.stack}`);
    } else {
      console.error("findRelevantContent encountered a non-Error exception:", error);
    }
    
    // Return a structured error object, maintaining previous structure but ensuring sourcefile is present
    return [{
      text: "An error occurred while retrieving relevant information from the knowledge base.", // Slightly more informative message
      id: "error",
      similarity: 0,
      sourcefile: '' // Ensure sourcefile is included as per expected type
    }];
  }
};
