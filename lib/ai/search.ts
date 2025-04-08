import { SearchClient, AzureKeyCredential, SearchOptions, VectorQuery } from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";
import { embed } from "ai";
import { azure } from "@ai-sdk/azure";
import { createHash } from "crypto";

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

// Restore local generateEmbedding function
export const generateEmbedding = async (value: string): Promise<number[]> => {
  const input = value.replaceAll("\n", " ");
  const { embedding } = await embed({
    model: embeddingModel,
    value: input,
  });
  return embedding;
};

// findRelevantContent uses the local generateEmbedding
export const findRelevantContent = async (userQuery: string) => {
  try {
    // Initialize with a simpler type, let TypeScript infer
    const searchParameters: any = { // Revert to 'any' for now
      top: 5,
    };

    let semanticConfigName: string | undefined;
    if (process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION_NAME) {
      semanticConfigName = process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION_NAME;
      searchParameters.queryType = "semantic"; // Remove 'as const'
      searchParameters.semanticSearchOptions = {
        configurationName: semanticConfigName,
      };
    }

    if (process.env.AZURE_SEARCH_VECTOR_FIELD) {
      const vectorFieldName = process.env.AZURE_SEARCH_VECTOR_FIELD!;
      let userQueryEmbedded: number[];

      if (embeddingCache.has(userQuery)) {
        userQueryEmbedded = embeddingCache.get(userQuery)!;
        console.log("Using cached embedding for query:", userQuery);
      } else {
        console.log("Generating new embedding for query:", userQuery);
        userQueryEmbedded = await generateEmbedding(userQuery);
        embeddingCache.set(userQuery, userQueryEmbedded);
        if (embeddingCache.size > MAX_CACHE_SIZE) {
          const oldestKey = embeddingCache.keys().next().value;
          embeddingCache.delete(oldestKey);
          console.log("Cache size limit reached, removed oldest entry.");
        }
      }

      const kCount = semanticConfigName ? 50 : 5;
      // Remove explicit VectorQuery type for now
      const vectorQuery = { 
        kind: "vector" as const, // Use 'as const' here if needed
        fields: [vectorFieldName],
        kNearestNeighborsCount: kCount,
        vector: userQueryEmbedded,
      };
      searchParameters.vectorSearchOptions = {
        queries: [vectorQuery],
      };
    }

    const searchResults = await searchClient.search(userQuery, searchParameters);

    const similarDocs = [];
    const contentColumn = process.env.AZURE_SEARCH_CONTENT_FIELD!;
    for await (const result of searchResults.results) {
      const textField = (result.document as any).hasOwnProperty(contentColumn) ? (result.document as any)[contentColumn] : result.document;
      const hash = createHash('sha256').update(textField).digest('base64').substring(0, 8);
      similarDocs.push({
        text: textField,
        id: hash,
        similarity: result.score,
      });
    }
    return similarDocs;
  } catch (error) {
    console.error("Error in findRelevantContent:", error);
    return [{
      text: "No relevant information found. There was an issue connecting to the knowledge base.",
      id: "error",
      similarity: 0
    }];
  }
};
