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
import * as XLSX from 'xlsx'; // Import xlsx library
import prisma from '@/lib/prisma'; // Import Prisma client

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
    const projectId = formData.get('projectId') as string | null; // Read projectId

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ success: false, error: 'Project ID is required for uploading source.' }, { status: 400 });
    }

    // Sanitize the original file name for metadata
    const sanitizedOriginalFileName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');

    console.log(`Processing uploaded file: ${file.name} (sanitized for metadata: ${sanitizedOriginalFileName}) for project: ${projectId}`);

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let fileContent = '';

    // --- Step 1: Upload to Blob Storage (this is the final blob, not temporary) ---
    const uniqueBlobName = `${projectId}_${Date.now()}_${sanitizedOriginalFileName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(uniqueBlobName);
    console.log(`Uploading to Blob storage as blob: ${uniqueBlobName}`);
    await blockBlobClient.uploadData(fileBuffer, { metadata: { projectId: projectId, originalFileName: sanitizedOriginalFileName } });
    const finalBlobUrl = blockBlobClient.url;
    console.log(`Blob ${uniqueBlobName} uploaded successfully. URL: ${finalBlobUrl}`);

    // --- Generate SAS token for the uploaded blob for Document Intelligence ---
    const sasPermissions = new BlobSASPermissions();
    sasPermissions.read = true;
    const expiryDate = new Date();
    expiryDate.setMinutes(expiryDate.getMinutes() + 15);
    const sasToken = generateBlobSASQueryParameters({
        containerName: containerClient.containerName,
        blobName: blockBlobClient.name,
        permissions: sasPermissions,
        expiresOn: expiryDate,
        protocol: SASProtocol.Https
    }, blobServiceClient.credential as StorageSharedKeyCredential).toString();
    const blobUrlWithSas = `${finalBlobUrl}?${sasToken}`;
    console.log(`Generated SAS URL for DI (valid for 15 mins)`);
    
    // --- Step 2: Extract Content using Document Intelligence or Specific Parsers ---
    // Define supported types for DI and Excel
    const supportedDocIntelligenceTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
      // Add other image types if needed: 'image/jpeg', 'image/png', 'image/tiff', 'image/bmp'
    ];
    const supportedExcelTypes = [
        'application/vnd.ms-excel', // .xls
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // .xlsx
    ];

    if (supportedDocIntelligenceTypes.includes(file.type)) {
      console.log(`Analyzing document type ${file.type} with Document Intelligence: ${finalBlobUrl}`);
      const poller = await documentAnalysisClient.beginAnalyzeDocumentFromUrl("prebuilt-read", blobUrlWithSas);
      const { content } = await poller.pollUntilDone();
      if (content && content.length > 0) {
        fileContent = content;
        console.log(`Document Intelligence extracted ${fileContent.length} characters.`);
      } else {
        console.warn("Document Intelligence analysis completed but returned no content.");
      }
    } else if (supportedExcelTypes.includes(file.type)) {
        console.log(`Parsing Excel file (${file.type}) directly...`);
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            let extractedText = '';
            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                // Convert sheet to array of arrays (rows)
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
                if (rows.length > 0) {
                    extractedText += `Sheet: ${sheetName}\n`;
                    rows.forEach((row, rowIndex) => {
                        // Format row: "Row X: Col1_Value | Col2_Value | ..."
                        const rowContent = row.map(cell => cell !== null && cell !== undefined ? String(cell) : '').join(' | ');
                        if (rowContent.trim()) { // Only include non-empty rows
                           extractedText += `Row ${rowIndex + 1}: ${rowContent}\n`;
                        }
                    });
                    extractedText += '\n'; // Add a blank line between sheets
                }
            });
            fileContent = extractedText.trim();
            console.log(`Excel parsing complete. Extracted ${fileContent.length} characters.`);
        } catch (excelError: any) {
            console.error(`Error parsing Excel file ${file.name}:`, excelError);
            // Optionally try plain text extraction as fallback?
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

    // **Important:** The temporary blob (which is now the final blob) is NOT deleted here 
    // if its URL (finalBlobUrl) is to be stored in the database.
    // The line `await blockBlobClient.deleteIfExists();` has been removed from this spot.

    if (!fileContent || fileContent.trim().length === 0) {
      console.log('File content is empty. Skipping indexing. The original file remains in blob storage.');
      try {
        const originalFileIdForEmpty = createHash('sha256').update(projectId + file.name + file.size).digest('hex').substring(0, 24);
        await prisma.document.create({
          data: {
            projectId: projectId,
            blobUri: finalBlobUrl,
            searchDocId: originalFileIdForEmpty, 
            fileName: file.name,
            extractedText: fileContent,
          }
        });
        console.log(`Successfully created Document record in DB for (empty content) ${file.name}, project ${projectId}`);
        return NextResponse.json({ success: true, message: `File '${file.name}' processed, but no content extracted. DB record created.`, originalFileId: originalFileIdForEmpty });
      } catch (dbError: any) {
         console.error(`Error creating Document record in DB for (empty content) ${file.name}:`, dbError);
         return NextResponse.json({ success: false, error: `Failed to save metadata for empty file. Details: ${dbError.message}`}, { status: 500 });
      }
    }

    console.log("Chunking extracted content...");
    const textChunks = chunkText(fileContent);
    console.log(`Content split into ${textChunks.length} chunks.`);

    const documentsToUpload = [];
    const originalFileId = createHash('sha256').update(projectId + file.name + file.size).digest('hex').substring(0, 24);

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const embedding = await generateEmbedding(chunk);
      const chunkId = `${originalFileId}_chunk_${i}`;
      const projectPrefixedSourcefile = `${projectId}/${file.name}`;
      
      const document = {
        id: chunkId,
        content: chunk,
        embedding: embedding,
        sourcefile: projectPrefixedSourcefile,
        originalFileId: originalFileId,
        projectId: projectId
      };
      documentsToUpload.push(document);
    }

    if (documentsToUpload.length > 0) {
      console.log(`Uploading ${documentsToUpload.length} documents to index '${indexName}'...`);
      const result = await searchClient.mergeOrUploadDocuments(documentsToUpload);
      console.log("Document upload batch result:", result);

      const failedCount = result.results.filter(r => !r.succeeded).length;
      if (failedCount === 0) {
        console.log("All document chunks uploaded successfully to AI Search.");
        try {
          await prisma.document.create({
            data: {
              projectId: projectId,
              blobUri: finalBlobUrl,
              searchDocId: originalFileId,
              fileName: file.name,
              extractedText: fileContent,
            }
          });
          console.log(`Successfully created Document record in DB for ${file.name}, project ${projectId}`);
          return NextResponse.json({ success: true, message: `File '${file.name}' processed, indexed, and DB record created for project ${projectId}.`, originalFileId: originalFileId });
        } catch (dbError: any) {
          console.error(`Error creating Document record in DB for ${file.name}:`, dbError);
          return NextResponse.json({ 
            success: false, 
            error: `File indexed in Azure, but failed to save metadata to database. Please check server logs. Details: ${dbError.message}`,
            originalFileId: originalFileId 
          }, { status: 500 });
        }
      } else {
        console.error(`Failed to upload ${failedCount} out of ${documentsToUpload.length} document chunks.`);
        const firstError = result.results.find(r => !r.succeeded);
        return NextResponse.json({ success: false, error: `Failed to index some chunks for project ${projectId}. Error: ${firstError?.errorMessage}` }, { status: 500 });
      }
    } else {
      // This case should ideally be covered by the earlier check for empty fileContent
      console.log("No document chunks generated after processing, though content was present.");
      return NextResponse.json({ success: true, message: `File '${file.name}' processed for project ${projectId}, but no content chunks generated for AI Search.` });
    }

  } catch (error: any) {
    console.error('Error processing file upload:', error);
    return NextResponse.json({ success: false, error: `An unexpected error occurred: ${error.message}` }, { status: 500 });
  }
} // --- END ORIGINAL POST HANDLER LOGIC ---

// GET handler to list current sources
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ success: false, error: 'Project ID is required to fetch sources.' }, { status: 400 });
  }

  try {
    console.log(`Fetching sources for project: ${projectId} from index...`);
    
    const searchOptions: any = {
      select: ["id", "sourcefile", "originalFileId", "projectId"],
      top: 1000 
    };

    let searchResults;
    try {
      // Try with projectId field first
      searchOptions.filter = `projectId eq '${projectId}'`;
      searchResults = await searchClient.search("*", searchOptions);
    } catch (error: any) {
      console.warn(`Error using projectId field, falling back to sourcefile filtering: ${error.message}`);
      // Fall back to sourcefile pattern matching
      searchOptions.filter = `search.ismatchscoring('${projectId}', 'sourcefile')`;
      searchResults = await searchClient.search("*", searchOptions);
    }

    const uniqueSourcesMap = new Map<string, { id: string, name: string, projectId: string }>();

    for await (const result of searchResults.results) {
      const doc = result.document as any;
      if (doc && typeof doc.originalFileId === 'string' && typeof doc.sourcefile === 'string') {
        // Check if there's a projectId field or parse it from sourcefile
        const docProjectId = doc.projectId || projectId; // Use the field if available, otherwise use the requested projectId
        
        if (!uniqueSourcesMap.has(doc.originalFileId)) {
          uniqueSourcesMap.set(doc.originalFileId, { 
            id: doc.originalFileId, 
            name: doc.sourcefile,
            projectId: docProjectId
          });
        }
      } else {
        console.warn("Skipping document missing required fields:", doc);
      }
    }
    
    const sources = Array.from(uniqueSourcesMap.values());
    console.log(`Fetched ${sources.length} unique sources for project ${projectId}.`);
    return NextResponse.json({ success: true, sources: sources });

  } catch (error: any) {
    console.error(`Error fetching sources for project ${projectId}:`, error);
    return NextResponse.json({ success: false, error: `Error fetching sources: ${error.message}` }, { status: 500 });
  }
}

// DELETE handler to remove a source by its ID
export async function DELETE(request: Request) {
   try {
    const { searchParams } = new URL(request.url);
    // const deleteAll = searchParams.get('deleteAll') === 'true'; // Removed deleteAll flag

    // --- Logic only for deleting by originalFileId --- 
    const originalFileIdToDelete = searchParams.get('id');
    if (!originalFileIdToDelete) {
      // Updated error message
      return NextResponse.json({ success: false, error: 'Original File ID (param \'id\') is required.' }, { status: 400 });
    }
    
    console.log(`Attempting to delete all chunks for originalFileId: ${originalFileIdToDelete}`);
    const searchResults = await searchClient.search("*", {
        filter: `originalFileId eq '${originalFileIdToDelete}'`, 
        select: ["id"], 
        top: 1000
    });
    const documentsToDelete: { id: string }[] = [];
    for await (const result of searchResults.results) {
        const doc = result.document as { id: string; [key: string]: unknown }; 
        if (doc && typeof doc.id === 'string') {
            documentsToDelete.push({ id: doc.id });
        }
    }
    if (documentsToDelete.length === 0) {
        console.log(`No documents found matching originalFileId ${originalFileIdToDelete}. Nothing to delete.`);
        return new Response(null, { status: 204 }); 
    }
    console.log(`Found ${documentsToDelete.length} document chunks to delete.`);
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
  } catch (error: any) {
    console.error('Error during DELETE operation:', error);
    return NextResponse.json({ success: false, error: `An error occurred during deletion: ${error.message}` }, { status: 500 });
  }
}
