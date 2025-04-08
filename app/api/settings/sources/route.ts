import { NextResponse } from 'next/server';
import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';
import { generateEmbedding } from '@/lib/azureOpenAI';
import { createHash } from 'crypto';
import { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol, StorageSharedKeyCredential } from '@azure/storage-blob';
import { 
    DocumentAnalysisClient, 
    DocumentModelAdministrationClient,
    AzureKeyCredential as DIKeyCredential 
} from '@azure/ai-form-recognizer';

// Initialize Azure Search Client (ensure environment variables are set)

const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchApiKey = process.env.AZURE_SEARCH_KEY;
const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

// --- New Azure Resource Clients ---
// Blob Storage
const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

// Document Intelligence
const diEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
const diApiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

if (!searchEndpoint || !searchApiKey || !indexName) {
  throw new Error("Azure Search environment variables (ENDPOINT, KEY, INDEX_NAME) are not properly configured.");
}
if (!storageConnectionString || !containerName) {
  throw new Error("Azure Storage environment variables (CONNECTION_STRING, CONTAINER_NAME) are not properly configured.");
}
if (!diEndpoint || !diApiKey) {
  throw new Error("Azure Document Intelligence environment variables (ENDPOINT, KEY) are not properly configured.");
}

// --- Client Initialization ---
// Search client for actual searching (when restoring logic)
const searchClient = new SearchClient(
    searchEndpoint,
    indexName,
    new AzureKeyCredential(searchApiKey)
);
// Search Index client for checking index existence
const searchIndexClient = new SearchIndexClient(
    searchEndpoint, 
    new AzureKeyCredential(searchApiKey)
);

const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);
const containerClient = blobServiceClient.getContainerClient(containerName);

const documentAdminClient = new DocumentModelAdministrationClient(
  diEndpoint,
  new DIKeyCredential(diApiKey)
);
const documentAnalysisClient = new DocumentAnalysisClient(
  diEndpoint,
  new DIKeyCredential(diApiKey)
);

// Simple chunking function (adjust MAX_CHUNK_SIZE as needed)
const MAX_CHUNK_SIZE = 2000; // Aim for chunks around this size (characters)
const CHUNK_OVERLAP = 200; // Overlap chunks to preserve context

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + MAX_CHUNK_SIZE, text.length);
    chunks.push(text.substring(start, end));
    start += MAX_CHUNK_SIZE - CHUNK_OVERLAP;
    if (start >= text.length - CHUNK_OVERLAP && end < text.length) {
      // Ensure the last part is included if overlap logic prevents it
      chunks.push(text.substring(end - CHUNK_OVERLAP));
      break;
    }
  }
  return chunks.filter(chunk => chunk.trim().length > 0); // Remove empty chunks
}

// --- ORIGINAL POST HANDLER LOGIC (Restored) ---
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
    }

    console.log(`Processing uploaded file: ${file.name}, Type: ${file.type}, Size: ${file.size}`);

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let fileContent = '';

    // --- Step 1: Upload to Blob Storage ---
    const uniqueBlobName = `${Date.now()}_${file.name}`;
    const blockBlobClient = containerClient.getBlockBlobClient(uniqueBlobName);
    console.log(`Uploading to Blob storage as blob: ${uniqueBlobName}`);
    await blockBlobClient.uploadData(fileBuffer);
    console.log(`Blob ${uniqueBlobName} uploaded successfully. URL: ${blockBlobClient.url}`);

    // --- Generate SAS token for the uploaded blob ---
    const sasPermissions = new BlobSASPermissions();
    sasPermissions.read = true; // Grant read permission for Document Intelligence
    const expiryDate = new Date();
    expiryDate.setMinutes(expiryDate.getMinutes() + 15); // SAS token valid for 15 minutes

    // Ensure blobServiceClient has credentials needed for SAS generation
    // This works automatically when using fromConnectionString, assert type for TS
    const sasToken = generateBlobSASQueryParameters({
        containerName: containerClient.containerName,
        blobName: blockBlobClient.name,
        permissions: sasPermissions,
        startsOn: new Date(), // Optional: Start time
        expiresOn: expiryDate,
        protocol: SASProtocol.Https // Enforce HTTPS
    }, blobServiceClient.credential as StorageSharedKeyCredential).toString(); // Added type assertion

    const blobUrlWithSas = `${blockBlobClient.url}?${sasToken}`;
    console.log(`Generated SAS URL for DI (valid for 15 mins)`);
    
    // --- Step 2: Extract Content using Document Intelligence ---
    if (file.type === 'application/pdf') { 
      console.log(`Analyzing document with Document Intelligence using SAS URL...`);
      const poller = await documentAnalysisClient.beginAnalyzeDocumentFromUrl(
        "prebuilt-read", 
        blobUrlWithSas // Use the SAS URL
      );
      console.log("Document Intelligence analysis started, waiting for results...");
      const { content } = await poller.pollUntilDone();

      if (content && content.length > 0) {
        fileContent = content;
        console.log(`Document Intelligence extracted ${fileContent.length} characters.`);
      } else {
        console.warn("Document Intelligence analysis completed but returned no content.");
      }
    } else if (file.type.startsWith('text/')) {
      console.log("Reading text file directly...");
      fileContent = fileBuffer.toString('utf-8');
    } else {
      console.warn(`Unsupported file type for automatic extraction: ${file.type}. Indexing might be incomplete.`);
      try {
          fileContent = fileBuffer.toString('utf-8');
           if (!fileContent) console.log("Content empty after attempting text read.");
      } catch (readError: any) {
           console.error(`Could not read unsupported file type ${file.type} as text.`, readError);
      }
    }

    // Clean up the temporary blob
    console.log(`Deleting temporary blob: ${uniqueBlobName}`);
    await blockBlobClient.deleteIfExists(); // Enable auto-deletion

    // --- Step 3: Chunking (if content exists) ---
    if (!fileContent || fileContent.trim().length === 0) {
      console.log('File content is empty or could not be extracted. Skipping indexing.');
      return NextResponse.json({ success: true, message: `File '${file.name}' processed, but no content extracted for indexing.` });
    }

    console.log("Chunking extracted content...");
    const textChunks = chunkText(fileContent);
    console.log(`Content split into ${textChunks.length} chunks.`);

    // --- Step 4: Process and Upload Chunks to Azure Search ---
    // ... (embedding and document creation logic as before) ...
     const documentsToUpload = [];
    const originalFileId = createHash('sha256').update(file.name + file.size).digest('hex').substring(0, 16);

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      console.log(`Processing chunk ${i + 1}/${textChunks.length}...`);
      const embedding = await generateEmbedding(chunk);
      const chunkId = `${originalFileId}_chunk_${i}`;
      const document = {
        id: chunkId,
        content: chunk,
        embedding: embedding,
        sourcefile: file.name,
        // chunkNumber: i, 
        originalFileId: originalFileId
      };
      documentsToUpload.push(document);
    }

    // --- Step 5: Upload to Azure Search ---
    if (documentsToUpload.length > 0) {
      console.log(`Uploading ${documentsToUpload.length} documents to index '${indexName}'...`);
      const result = await searchClient.mergeOrUploadDocuments(documentsToUpload);
      console.log("Document upload batch result:", result);

      const failedCount = result.results.filter(r => !r.succeeded).length;
      if (failedCount === 0) {
        console.log("All document chunks uploaded successfully.");
        return NextResponse.json({ success: true, message: `File '${file.name}' processed and indexed (${documentsToUpload.length} chunks).`, originalFileId: originalFileId });
      } else {
        console.error(`Failed to upload ${failedCount} out of ${documentsToUpload.length} document chunks.`);
        const firstError = result.results.find(r => !r.succeeded);
        return NextResponse.json({ success: false, error: `Failed to index some document chunks. First error: ${firstError?.errorMessage}` }, { status: 500 });
      }
    } else {
      console.log("No document chunks generated after processing.");
      return NextResponse.json({ success: true, message: `File '${file.name}' processed, but no content chunks were generated for indexing.` });
    }

  } catch (error: any) {
    console.error('Error processing file upload:', error);
    return NextResponse.json({ success: false, error: `An unexpected error occurred during file processing: ${error.message}` }, { status: 500 });
  }
} // --- END ORIGINAL POST HANDLER LOGIC ---

// GET handler to list current sources
export async function GET(request: Request) {
  try {
    console.log("Fetching and grouping sources from index...");
    const searchResults = await searchClient.search("*", {
      // Select fields needed for display and grouping
      select: ["id", "sourcefile", "originalFileId"], 
      top: 1000 // Adjust as needed, but ensure all chunks of a file are likely fetched
    });

    const uniqueSourcesMap = new Map<string, { id: string, name: string }>();
    let documentCount = 0; // Initialize counter

    for await (const result of searchResults.results) {
      documentCount++; // Increment counter
      const doc = result.document as any;
      
      // Use originalFileId as the key for grouping
      if (doc && typeof doc.originalFileId === 'string' && typeof doc.sourcefile === 'string') {
        // If we haven't seen this originalFileId yet, add it to the map
        if (!uniqueSourcesMap.has(doc.originalFileId)) {
          uniqueSourcesMap.set(doc.originalFileId, { 
            // Use originalFileId for the ID in the UI for deletion purposes
            id: doc.originalFileId, 
            name: doc.sourcefile 
          });
        }
      } else {
          // Log documents missing the crucial fields
          console.warn("Skipping document missing originalFileId or sourcefile:", doc);
      }
    }
    
    // Convert the map values to an array for the response
    const sources = Array.from(uniqueSourcesMap.values());

    console.log(`Fetched ${documentCount} documents, returning ${sources.length} unique sources.`); // Use counter in log
    return NextResponse.json({ success: true, sources: sources });

  } catch (error: any) {
    console.error('Error fetching sources:', error);
    // Be more specific about the error returned to the client if needed
    // Check if it's an Azure SDK error, etc.
    return NextResponse.json({ success: false, error: `An error occurred while fetching sources: ${error.message}` }, { status: 500 });
  }
}

// DELETE handler to remove a source
export async function DELETE(request: Request) {
   try {
    const { searchParams } = new URL(request.url);
    
    // --- Removed Temporary Delete All Logic --- //

    // --- Normal Delete by originalFileId Logic ---
    const originalFileIdToDelete = searchParams.get('id');
    if (!originalFileIdToDelete) {
      // Note: Changed error message back to only expect 'id'
      return NextResponse.json({ success: false, error: 'Original File ID (param \'id\') is required.' }, { status: 400 });
    }
    
    console.log(`Attempting to delete all chunks for originalFileId: ${originalFileIdToDelete}`);

    // 1. Find all document chunks matching the originalFileId
    const searchResults = await searchClient.search("*", {
        filter: `originalFileId eq '${originalFileIdToDelete}'`, 
        select: ["id"] 
    });

    const documentsToDelete: { id: string }[] = [];
    let chunkCount = 0;
    for await (const result of searchResults.results) {
        chunkCount++;
        const doc = result.document as any;
        if (doc && typeof doc.id === 'string') {
            documentsToDelete.push({ id: doc.id });
        }
    }

    if (documentsToDelete.length === 0) {
        console.log(`No documents found matching originalFileId ${originalFileIdToDelete}. Nothing to delete.`);
        return new Response(null, { status: 204 }); 
    }

    console.log(`Found ${documentsToDelete.length} document chunks to delete.`);

    // 2. Delete the found documents in a batch
    const result = await searchClient.deleteDocuments(documentsToDelete);
    console.log("Document deletion batch result:", result);

    const failedDeletions = result.results.filter(r => !r.succeeded);

    if (failedDeletions.length === 0) {
      console.log(`All ${documentsToDelete.length} chunks for ${originalFileIdToDelete} deleted successfully.`);
      return new Response(null, { status: 204 }); 
    } else {
      const firstError = failedDeletions[0];
      const errorMsg = firstError?.errorMessage ?? "Unknown error during batch deletion.";
      console.error(`Failed to delete ${failedDeletions.length} out of ${documentsToDelete.length} chunks for ${originalFileIdToDelete}. First error on key ${firstError?.key}:`, errorMsg);
      return NextResponse.json({ success: false, error: `Failed to delete some chunks: ${errorMsg}` }, { status: firstError?.statusCode ?? 500 });
    }
    // --- End Normal Delete by originalFileId Logic ---

  } catch (error: any) {
    // Note: Changed error log message back
    console.error('Error deleting source by originalFileId:', error);
    return NextResponse.json({ success: false, error: `An error occurred during deletion: ${error.message}` }, { status: 500 });
  }
}
