console.log("[lib/azureOpenAI.ts] Initializing. Checking ENV VARS:");
console.log(`[lib/azureOpenAI.ts] AZURE_OPENAI_API_KEY: ${process.env.AZURE_OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
console.log(`[lib/azureOpenAI.ts] AZURE_API_KEY (fallback check): ${process.env.AZURE_API_KEY ? 'SET' : 'NOT SET'}`);
console.log(`[lib/azureOpenAI.ts] AZURE_OPENAI_ENDPOINT: ${process.env.AZURE_OPENAI_ENDPOINT ? 'SET' : 'NOT SET'}`);
console.log(`[lib/azureOpenAI.ts] AZURE_RESOURCE_NAME: ${process.env.AZURE_RESOURCE_NAME ? 'SET' : 'NOT SET'}`);

import { azure } from "@ai-sdk/azure";
import { embed } from "ai";

// This will use the globally configured Azure OpenAI endpoint and key 
// (typically AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY from process.env)
// along with the specific deployment name for embeddings.
const embeddingModel = azure.textEmbeddingModel(
  process.env.AZURE_EMBEDDING_DEPLOYMENT_NAME!
);

/**
 * Generates an embedding for the given value using the configured Azure OpenAI model.
 * Replaces newline characters with spaces before embedding.
 * @param value The string to embed.
 * @returns A promise that resolves to an array of numbers representing the embedding.
 */
export const generateEmbedding = async (value: string): Promise<number[]> => {
  const input = value.replaceAll("\n", " ");
  const { embedding } = await embed({
    model: embeddingModel,
    value: input,
  });
  return embedding;
}; 