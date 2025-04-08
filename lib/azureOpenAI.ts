import { azure } from "@ai-sdk/azure";
import { embed } from "ai";

const embeddingModel = azure.textEmbeddingModel(process.env.AZURE_EMBEDDING_DEPLOYMENT_NAME!);

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