import { NextResponse } from 'next/server';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { generateEmbedding } from '@/lib/azureOpenAI';
import { createHash } from 'crypto';

// Initialize Azure Search Client (ensure environment variables are set)
const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
const apiKey = process.env.AZURE_SEARCH_KEY;
const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

if (!endpoint || !apiKey || !indexName) {
  throw new Error("Azure Search environment variables (ENDPOINT, KEY, INDEX_NAME) are not properly configured.");
}

const searchClient = new SearchClient(
  endpoint,
  indexName,
  new AzureKeyCredential(apiKey),
  {
    serviceVersion: "2023-11-01"
  }
);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
    }

    console.log(`Processing uploaded file: ${file.name}, Size: ${file.size}`);

    // Read file content (assuming text for now)
    // TODO: Add handling for different file types (PDF, DOCX) potentially using external libraries
    const fileContent = await file.text();

    if (!fileContent) {
         return NextResponse.json({ success: false, error: 'File content is empty or could not be read.' }, { status: 400 });
    }

    // Generate embedding for the content
    console.log("Generating embedding for file content...");
    const embedding = await generateEmbedding(fileContent);
    console.log("Embedding generated.");

    // Construct the document for Azure Search
    // Use a hash of the content for a simple ID, or derive from filename/metadata
    const docId = createHash('sha256').update(fileContent).digest('hex').substring(0, 16);
    const documentToUpload = {
      id: docId, 
      content: fileContent,
      embedding: embedding,
      // Add other relevant fields based on your index schema
      sourcefile: file.name, 
      // category: 'Uploaded File', // Example
      // title: file.name, // Example
    };

    // Upload the document
    console.log(`Uploading document with ID ${docId} to index '${indexName}'...`);
    const result = await searchClient.mergeOrUploadDocuments([documentToUpload]);
    console.log("Document upload result:", result);

    if (result.results[0]?.succeeded) {
      console.log("Document uploaded successfully.");
      return NextResponse.json({ success: true, message: `File '${file.name}' processed and indexed.`, documentId: docId });
    } else {
      console.error("Failed to upload document:", result.results[0]);
      return NextResponse.json({ success: false, error: `Failed to index document: ${result.results[0]?.errorMessage}` }, { status: 500 });
    }

  } catch (error: any) {
    console.error('Error processing file upload:', error);
    return NextResponse.json({ success: false, error: `An error occurred: ${error.message}` }, { status: 500 });
  }
}

// GET handler to list current sources
export async function GET(request: Request) {
  try {
    console.log("Fetching current sources from index...");
    const searchResults = await searchClient.search("*", { // Search for all documents
      select: ["id", "sourcefile"], // Select only needed fields
      top: 1000 // Limit to avoid fetching too many - adjust as needed
    });

    const sources = [];
    for await (const result of searchResults.results) {
      // Cast document to any to access properties after checking
      const doc = result.document as any; 
      // Ensure the document has the expected fields before adding
      if (doc && typeof doc.id === 'string' && typeof doc.sourcefile === 'string') {
          sources.push({ 
              id: doc.id, 
              name: doc.sourcefile 
          });
      } else {
          console.warn("Skipping document with missing id or sourcefile:", doc);
      }
    }
    
    console.log(`Fetched ${sources.length} sources.`);
    return NextResponse.json({ success: true, sources: sources });

  } catch (error: any) {
    console.error('Error fetching sources:', error);
    return NextResponse.json({ success: false, error: `An error occurred: ${error.message}` }, { status: 500 });
  }
}

// DELETE handler to remove a source
export async function DELETE(request: Request) {
   try {
    const { searchParams } = new URL(request.url);
    const idToDelete = searchParams.get('id');

    if (!idToDelete) {
      return NextResponse.json({ success: false, error: 'Document ID is required for deletion.' }, { status: 400 });
    }

    console.log(`Attempting to delete document with ID: ${idToDelete}`);

    // Documents to delete are identified by their key field (which is 'id' in our case)
    const documentsToDelete = [{ id: idToDelete }]; 

    const result = await searchClient.deleteDocuments(documentsToDelete);
    console.log("Document deletion result:", result);

    // Check if the specific key deletion succeeded
    const deleteResult = result.results.find(r => r.key === idToDelete);

    if (deleteResult?.succeeded) {
      console.log(`Document ${idToDelete} deleted successfully.`);
      // Return a successful response with no body for DELETE
      return new Response(null, { status: 204 }); 
    } else {
      const errorMsg = deleteResult?.errorMessage ?? "Unknown error during deletion.";
      console.error(`Failed to delete document ${idToDelete}:`, errorMsg);
      return NextResponse.json({ success: false, error: `Failed to delete source: ${errorMsg}` }, { status: deleteResult?.statusCode ?? 500 });
    }

  } catch (error: any) {
    console.error('Error deleting source:', error);
    return NextResponse.json({ success: false, error: `An error occurred: ${error.message}` }, { status: 500 });
  }
}
