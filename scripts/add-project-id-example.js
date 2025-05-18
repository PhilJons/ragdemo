// Example script showing how to add projectId to documents without migrating the index

// When uploading new documents, include the projectId in the sourcefile path
// AND as a separate property for compatibility with both approaches

/**
 * Example function for processing a document before upload
 */
function prepareDocumentForUpload(document, projectId) {
  // 1. Keep the projectId in the sourcefile path for backward compatibility
  const sourceFilePath = document.sourcefile;
  const projectPrefixedSourcefile = `${projectId}/${sourceFilePath}`;
  
  // 2. Also add an explicit projectId field for direct filtering
  return {
    ...document,
    sourcefile: projectPrefixedSourcefile,
    projectId: projectId // Add this explicit field
  };
}

/**
 * Example function for filtering by projectId using both approaches
 */
function createSearchOptions(projectId) {
  return {
    // For indexes WITH a proper projectId field:
    filter: `projectId eq '${projectId}'`,
    
    // For indexes WITHOUT a projectId field (fallback):
    // filter: `search.ismatchscoring('${projectId}', 'sourcefile')`
  };
}

// Example usage:
const sampleDocument = {
  id: "doc123",
  content: "Sample content",
  embedding: [0.1, 0.2, 0.3],
  sourcefile: "report.pdf",
  originalFileId: "orig123"
};

const projectId = "project-alpha";
const preparedDocument = prepareDocumentForUpload(sampleDocument, projectId);
const searchOptions = createSearchOptions(projectId);

console.log("Prepared document:", preparedDocument);
console.log("Search options:", searchOptions);

// To use this approach:
// 1. Update your document upload code to call prepareDocumentForUpload
// 2. Update your search code to use createSearchOptions
// 3. This provides compatibility whether you have the projectId field or not 