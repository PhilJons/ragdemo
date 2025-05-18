# Azure AI Search Index Schema (`AZURE_SEARCH_INDEX_NAME`)

This document outlines the inferred schema for the Azure AI Search index used by this application, based on analysis of the data ingestion (`app/api/settings/sources/route.ts`, `seed-index.js`) and retrieval (`lib/ai/search.ts`) logic.

**Note:** This schema is inferred from code. The actual index definition in Azure might have slight variations or additional configurations (e.g., analyzers, scoring profiles, vector search profiles, specific semantic configurations details).

## Fields

| Field Name         | Data Type                 | Key | Searchable | Filterable | Sortable | Facetable | Notes                                                                                                   |
|--------------------|---------------------------|-----|------------|------------|----------|-----------|---------------------------------------------------------------------------------------------------------|
| `id`               | `Edm.String`              | Yes | No         | Yes        | Yes      | No        | **Primary Key.** Format: `<originalFileId>_chunk_<index>` generated during ingestion.                    |
| `content`          | `Edm.String`              | No  | Yes        | No         | No       | No        | The text chunk content. Name configured via `AZURE_SEARCH_CONTENT_FIELD` env var.                       |
| `embedding`        | `Collection(Edm.Single)`  | No  | Yes (Vec)  | No         | No       | No        | Vector embedding of the `content`. Name configured via `AZURE_SEARCH_VECTOR_FIELD` env var. Dimensions depend on `AZURE_EMBEDDING_DEPLOYMENT_NAME`. |
| `sourcefile`       | `Edm.String`              | No  | Yes        | Yes        | Yes      | Yes       | Original filename of the uploaded document.                                                             |
| `originalFileId`   | `Edm.String`              | No  | No         | Yes        | Yes      | Yes       | SHA256 hash (truncated) of projectId + original filename + size. Used for grouping/deleting chunks.                |
| `projectId`        | `Edm.String`              | No  | No         | Yes        | No       | No        | Identifier for the project this document belongs to. Used for filtering.                                |
| `title` *          | `Edm.String`              | No  | Yes        | Yes        | Yes      | Yes       | Document title. Searched in `lib/ai/search.ts` but not explicitly indexed by `sources/route.ts`.      |
| `category` *       | `Edm.String`              | No  | Yes        | Yes        | Yes      | Yes       | Document category. Used in `seed-index.js` but not explicitly indexed by `sources/route.ts`.            |

(*) Fields marked with an asterisk are used in parts of the codebase (seeding, searching) but are not explicitly included in the document structure created by the primary file upload API (`app/api/settings/sources/route.ts`). They might be added via indexer enrichment or assumed to exist for specific data sources.

## Vector Search Configuration

*   **Field:** `embedding` (or value of `AZURE_SEARCH_VECTOR_FIELD`)
*   **Dimensions:** Determined by the Azure OpenAI embedding model specified by `AZURE_EMBEDDING_DEPLOYMENT_NAME`.
*   **Vector Search Profile:** The specific profile (e.g., HNSW parameters) is not defined in the application code and must be configured directly in Azure AI Search.

## Semantic Search Configuration

*   **Enabled:** Currently **disabled** in `lib/ai/search.ts` due to persistent TypeScript type errors with `@azure/search-documents@^12.1.0`.
*   **Configuration Name:** If enabled, would use the name specified by the `AZURE_SEARCH_SEMANTIC_CONFIGURATION_NAME` environment variable.
*   **Configuration Definition:** The actual semantic configuration (prioritized fields for title, content, keywords) is not defined in the application code and must be configured directly in Azure AI Search.

## Recommendations

*   **Define Schema Explicitly:** Use Infrastructure as Code (e.g., Azure Bicep, Terraform) or the Azure Portal/SDK to define and manage the index schema explicitly, rather than relying solely on inference from application code. This ensures consistency and allows for easier management of index features.
*   **Verify `title` and `category`:** Confirm how/if the `title` and `category` fields are intended to be populated in the main ingestion flow or if they are only relevant for specific seeded/demo data.
*   **Resolve Semantic Search:** Investigate the type errors to enable semantic search for potentially improved relevance. 