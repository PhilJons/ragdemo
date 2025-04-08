// Simple Node.js script to seed Azure Search index
const { SearchClient, AzureKeyCredential: SearchCredential } = require("@azure/search-documents"); // Keep SearchIndexClient import in case needed later, but not used now
// Import Azure OpenAI v1 beta
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai"); // Import both from @azure/openai
require("dotenv").config();

// Azure Search configuration
const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchKey = process.env.AZURE_SEARCH_KEY; // Load from environment variable
const indexName = process.env.AZURE_SEARCH_INDEX_NAME;
const vectorField = process.env.AZURE_SEARCH_VECTOR_FIELD || "embedding"; // Use env var or default

// Azure OpenAI configuration
const openAIEndpoint = process.env.AZURE_OPENAI_API_ENDPOINT;
const openAIKey = process.env.AZURE_API_KEY; // Load from environment variable
const embeddingDeployment = process.env.AZURE_EMBEDDING_DEPLOYMENT_NAME;

// Sample documents to upload
const sampleDocuments = [
  {
    id: "doc1",
    title: "Azure OpenAI Service",
    content: "Azure OpenAI Service provides REST API access to OpenAI's powerful language models including the GPT-4, GPT-4 Turbo with Vision, GPT-35-Turbo, and Embeddings model series.",
    category: "Azure Services",
    sourcefile: "azure-openai.md"
  },
  {
    id: "doc2",
    title: "Retrieval-Augmented Generation",
    content: "Retrieval-augmented generation (RAG) is a pattern used to enhance Large Language Model (LLM) outputs with data from outside its training parameters, providing context for accurate and relevant responses.",
    category: "AI Concepts",
    sourcefile: "rag-pattern.md"
  },
  {
    id: "doc3",
    title: "Azure AI Search Overview",
    content: "Azure AI Search is a cloud search service that gives developers infrastructure, APIs, and tools for building a rich search experience over private, heterogeneous content in web, mobile, and enterprise applications.",
    category: "Azure Services",
    sourcefile: "azure-search.md"
  }
];

// Main function
async function main() {
  // Add checks for environment variables based on .env file
  if (!searchEndpoint) {
    throw new Error("AZURE_SEARCH_ENDPOINT environment variable is not set.");
  }
  if (!searchKey) {
    throw new Error("AZURE_SEARCH_KEY environment variable is not set.");
  }
  if (!indexName) {
    throw new Error("AZURE_SEARCH_INDEX_NAME environment variable is not set.");
  }
  if (!openAIEndpoint) {
    throw new Error("AZURE_OPENAI_API_ENDPOINT environment variable is not set.");
  }
  if (!openAIKey) {
    throw new Error("AZURE_API_KEY environment variable is not set.");
  }
  if (!embeddingDeployment) {
    throw new Error("AZURE_EMBEDDING_DEPLOYMENT_NAME environment variable is not set.");
  }
  
  // Create credentials
  const searchCredential = new SearchCredential(searchKey);
  const openAICredential = new AzureKeyCredential(openAIKey);

  // Create clients
  const searchClient = new SearchClient(
    searchEndpoint,
    indexName,
    searchCredential,
    { serviceApiVersion: "2023-11-01" } // Explicitly set API version
  );

  // OpenAI client with API key (using v1 beta style)
  const openAIClient = new OpenAIClient(openAIEndpoint, openAICredential);

  // Generate embeddings for text
  async function generateEmbedding(text) {
    const response = await openAIClient.getEmbeddings(embeddingDeployment, [text]);
    return response.data[0].embedding;
  }

  console.log("Generating embeddings and uploading documents...");

  try {
    // Generate embeddings for each document
    const documentsWithEmbeddings = [];

    for (const doc of sampleDocuments) {
      try {
        const embedding = await generateEmbedding(doc.content);
        documentsWithEmbeddings.push({
          ...doc,
          [vectorField]: embedding // Use vectorField constant
        });
        console.log(`Generated embedding for document ${doc.id}`);
      } catch (error) {
        console.error(`Error generating embedding for document ${doc.id}:`, error.message);
      }
    }

    if (documentsWithEmbeddings.length === 0) {
      console.log("No documents with embeddings generated to upload.");
      return;
    }

    // Upload documents to search index
    console.log(`Uploading ${documentsWithEmbeddings.length} documents to Azure AI Search index '${indexName}'...`);
    const result = await searchClient.mergeOrUploadDocuments(documentsWithEmbeddings);

    console.log(`Uploaded ${result.results.length} documents`);
    // Check for errors in upload results
    let successCount = 0;
    for (const res of result.results) {
        if (res.succeeded) {
            successCount++;
        } else {
            console.error(`Failed to upload document ${res.key}: ${res.errorMessage} (Status: ${res.statusCode})`);
        }
    }
    console.log(`Successfully indexed ${successCount} documents.`);
    console.log("Done!");
  } catch (error) {
    console.error("Error during document upload process:", error.message);
    if (error.stack) console.error(error.stack);
  }
}

// Run the script
main().catch(error => {
  console.error("Fatal error in main execution:", error);
  process.exit(1);
}); 