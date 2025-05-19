import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';

// Azure Search Configuration
const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchApiKey = process.env.AZURE_SEARCH_KEY;
const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

// Azure Blob Storage Configuration
const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
// Note: containerName is not strictly needed if blobUri is a full URL, but good to have for SDK init if needed elsewhere.
// const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

if (!searchEndpoint || !searchApiKey || !indexName) {
  console.error("Azure Search environment variables (ENDPOINT, KEY, INDEX_NAME) are not properly configured for project deletion.");
  // Depending on strictness, you might throw an error or allow DB deletion to proceed with a warning.
}
if (!storageConnectionString) {
  console.error("Azure Storage environment variable (CONNECTION_STRING) is not properly configured for project deletion.");
}

const searchClient = searchEndpoint && searchApiKey && indexName ? new SearchClient(searchEndpoint, indexName, new AzureKeyCredential(searchApiKey)) : null;
const blobServiceClient = storageConnectionString ? BlobServiceClient.fromConnectionString(storageConnectionString) : null;

// Helper to get projectId from the URL path
// Next.js 13+ app router passes params to the handler function directly.
// The context object type can be { params: { projectId: string } }

interface DeleteContext {
  params: {
    projectId: string;
  };
}

export async function DELETE(request: Request, context: DeleteContext) {
  const projectId = context.params.projectId;

  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'Project ID is required and must be a string' }, { status: 400 });
  }

  console.log(`Attempting to delete project with ID: ${projectId} including Azure resources.`);

  try {
    // --- Step 1: Fetch Document records to get blobUris and searchDocIds ---
    const documentsInDb = await prisma.document.findMany({
      where: { projectId: projectId },
      select: { id: true, blobUri: true, searchDocId: true, fileName: true }, // searchDocId is likely originalFileId
    });

    if (documentsInDb.length === 0) {
      console.log(`No Document records found in database for project ${projectId}. Azure resource deletion specific to these records will be skipped.`);
    }

    // --- Step 2: Delete from Azure AI Search ---
    if (searchClient && documentsInDb.length > 0) {
      const searchDocIdsToDelete: string[] = documentsInDb
        .map(doc => doc.searchDocId)
        .filter((id): id is string => id !== null && id !== undefined);
      
      const uniqueSearchDocIds = [...new Set(searchDocIdsToDelete)];

      if (uniqueSearchDocIds.length > 0) {
        console.log(`Found ${uniqueSearchDocIds.length} unique searchDocIds (originalFileIds) to delete from Azure AI Search for project ${projectId}.`);
        for (const originalFileId of uniqueSearchDocIds) {
          try {
            const chunksToDeleteResponse = await searchClient.search("*", {
              filter: `originalFileId eq '${originalFileId}'`, 
              select: ["id"], 
              top: 1000 
            });
            const chunkIds: { id: string }[] = [];
            for await (const result of chunksToDeleteResponse.results) {
              const doc = result.document as { id: string };
              if (doc && typeof doc.id === 'string') {
                chunkIds.push({ id: doc.id });
              }
            }
            if (chunkIds.length > 0) {
              console.log(`Deleting ${chunkIds.length} chunks for originalFileId ${originalFileId} from search index.`);
              const deleteResult = await searchClient.deleteDocuments(chunkIds);
              const SucceededCount = deleteResult.results.filter(r => r.succeeded).length;
              console.log(`Successfully deleted ${SucceededCount}/${chunkIds.length} chunks for originalFileId ${originalFileId}.`);
              if (SucceededCount !== chunkIds.length) {
                 console.warn(`Some chunks failed to delete for originalFileId ${originalFileId}.`);
              }
            } else {
              console.log(`No chunks found in search index for originalFileId ${originalFileId}.`);
            }
          } catch (searchDeleteError) {
            console.error(`Error deleting documents from Azure AI Search for originalFileId ${originalFileId}:`, searchDeleteError);
            // Decide if this error should halt the entire process or just be logged.
          }
        }
      } else {
        console.log(`No searchDocIds found for documents in project ${projectId} for Azure AI Search deletion.`);
      }
    } else if (!searchClient) {
      console.warn("Search client not initialized. Skipping Azure AI Search deletion.");
    }

    // --- Step 3: Delete from Azure Blob Storage ---
    if (blobServiceClient && documentsInDb.length > 0) {
      console.log(`Attempting to delete ${documentsInDb.length} blobs from Azure Storage for project ${projectId}.`);
      for (const doc of documentsInDb) {
        if (doc.blobUri) {
          try {
            // blobUri might be a full URL. We need to parse container and blob name.
            // Example: https://<accountname>.blob.core.windows.net/<containername>/<blobname>
            const url = new URL(doc.blobUri);
            const pathSegments = url.pathname.split('/');
            if (pathSegments.length > 2) { // /containername/blobname
              const containerNameFromUri = pathSegments[1];
              const blobName = pathSegments.slice(2).join('/');
              const containerClient = blobServiceClient.getContainerClient(containerNameFromUri);
              const blobClient = containerClient.getBlobClient(blobName);
              await blobClient.deleteIfExists();
              console.log(`Deleted blob: ${blobName} from container ${containerNameFromUri}`);
            } else {
              console.warn(`Could not parse container/blob name from blobUri: ${doc.blobUri}`);
            }
          } catch (blobDeleteError) {
            console.error(`Error deleting blob ${doc.blobUri} from Azure Storage:`, blobDeleteError);
            // Decide if this error should halt the entire process.
          }
        }
      }
    } else if (!blobServiceClient) {
      console.warn("Blob service client not initialized. Skipping Azure Blob Storage deletion.");
    }

    // --- Step 4: Delete from Database (Prisma Transaction) ---
    console.log(`Proceeding with database deletion for project ${projectId}.`);
    const dbResult = await prisma.$transaction(async (tx) => {
      const deletedPrompts = await tx.projectPrompt.deleteMany({
        where: { projectId: projectId },
      });
      console.log(`Deleted ${deletedPrompts.count} prompts associated with project ${projectId} from DB.`);

      const deletedDocuments = await tx.document.deleteMany({
        where: { projectId: projectId },
      });
      console.log(`Deleted ${deletedDocuments.count} document records from DB for project ${projectId}.`);

      const deletedUserProjectLinks = await tx.userProject.deleteMany({
        where: { projectId: projectId },
      });
      console.log(`Deleted ${deletedUserProjectLinks.count} user-project links for project ${projectId} from DB.`);
      
      const deletedProject = await tx.project.delete({
        where: { id: projectId },
      });
      console.log(`Successfully deleted project ${projectId} from database.`);
      
      return deletedProject;
    });

    return NextResponse.json({ 
      message: 'Project and associated data (DB, AI Search, Blobs) deletion process initiated.',
      deletedProjectId: dbResult.id 
    }, { status: 200 });

  } catch (error: any) {
    console.error(`Error during project deletion process for project ${projectId}:`, error);
    if (error.code === 'P2025' && error.meta?.target?.includes('Project')) { // Prisma error code for Project record not found
      return NextResponse.json({ error: 'Project not found in database.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to delete project', details: error.message }, { status: 500 });
  }
}

// Optional: Add GET handler if you want to fetch a single project's details by ID via this route
export async function GET(request: Request, context: DeleteContext) {
  const projectId = context.params.projectId;

  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        prompts: true, // Assuming 'prompts' is the relation field name for ProjectPrompt
        documents: true, // Include document records if useful for a GET by ID
        users: { include: { user: true }} // Example of fetching related users
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json(project, { status: 200 });
  } catch (error: any) {
    console.error(`Error fetching project ${projectId}:`, error);
    return NextResponse.json({ error: 'Failed to fetch project', details: error.message }, { status: 500 });
  }
} 