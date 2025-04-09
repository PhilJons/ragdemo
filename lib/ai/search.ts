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
export const findRelevantContent = async (userQuery: string) => {
  try {
    const searchOptions: SearchOptions<object, string> = {
      top: 5,
      select: ["id", contentColumn, sourcefileFieldName] // Include id, content, and sourcefile
    };

    let semanticConfigName: string | undefined;
    if (process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION_NAME) {
      // semanticConfigName = process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION_NAME;
      // The following lines are commented out due to persistent type errors.
      // Please verify the correct way to configure semantic search for your installed version of @azure/search-documents.
      // searchOptions.queryType = "semantic";
      // searchOptions.semanticConfigurationName = semanticConfigName;
      console.warn(
        "Semantic search configuration is temporarily disabled due to build issues. Please verify the correct configuration for your @azure/search-documents version."
      );
    }

    if (process.env.AZURE_SEARCH_VECTOR_FIELD) {
      const vectorFieldName = process.env.AZURE_SEARCH_VECTOR_FIELD!;
      let userQueryEmbedded: number[];

      // Use embedding cache (logic restored)
      if (embeddingCache.has(userQuery)) {
        userQueryEmbedded = embeddingCache.get(userQuery)!;
        console.log("Using cached embedding for query:", userQuery);
      } else {
        console.log("Generating new embedding for query:", userQuery);
        userQueryEmbedded = await generateEmbedding(userQuery); // Uses imported function
        embeddingCache.set(userQuery, userQueryEmbedded);
        // Cache pruning logic (restored)
        if (embeddingCache.size > MAX_CACHE_SIZE) {
          const oldestKey = embeddingCache.keys().next().value;
          if (oldestKey !== undefined) {
            embeddingCache.delete(oldestKey);
            console.log("Cache size limit reached, removed oldest entry:", oldestKey);
          } else {
            console.warn("Attempted to prune cache, but oldestKey was undefined despite cache size exceeding limit.");
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

    // Perform the search
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
    console.error("Error in findRelevantContent:", error);
    // Restore original error structure, add empty sourcefile
    return [{
      text: "No relevant information found. There was an issue connecting to the knowledge base.",
      id: "error",
      similarity: 0,
      sourcefile: ''
    }];
  }
};
