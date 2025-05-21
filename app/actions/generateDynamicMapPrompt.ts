'use server';

import { OpenAIClient, AzureKeyCredential } from "@azure/openai";

interface ActionResult {
  success: boolean;
  mapPrompt?: string;
  error?: string;
}

// META_PROMPT_FOR_MAP_PROMPT_GENERATION:
// This meta-prompt instructs an LLM to generate a *specific prompt* (the "Map Prompt")
// that will then be used to analyze each individual document during the "Map" phase of Deep Analysis.
// The generated "Map Prompt" must be tailored to the original user query and ensure
// that the subsequent LLM (which processes individual documents using this Map Prompt)
// correctly extracts information AND its associated original Source ID.
const META_PROMPT_FOR_MAP_PROMPT_GENERATION = `
You are an expert AI specializing in crafting highly effective and precise prompts for Large Language Models (LLMs), adhering to GPT-4.1 best practices.
Your task is to generate a "Map Prompt". This "Map Prompt" will instruct a document-analyzing AI (which is also a GPT-4.1 class model) on how to meticulously analyze a single document.

%%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%
Follow these steps to construct the "Map Prompt":
1.  **Understand the Goal:** The primary goal is to extract information *strictly relevant* to the CURRENT ORIGINAL USER QUERY from a *single document's text*, considering any prior conversation context. The Map AI should not answer the query directly but provide focused extractions or analyses of specific sections.

2.  **Identify Key Entities, Sections, or Information Types:** Based on the CURRENT ORIGINAL USER QUERY and informed by the %%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%:
    *   Determine if the query targets a specific, common document section (e.g., "CEO statement", "VD ord", "financial results summary", "sustainability report section", "risk factors"). Check for keywords related to these sections in the CURRENT ORIGINAL USER QUERY.
    *   Identify the core analytical task required by the CURRENT ORIGINAL USER QUERY (e.g., summarize this section, extract key figures from it, analyze its tone and style, identify unique approaches within it, list specific items like files or risks mentioned in it).

3.  **Incorporate Specific Instructions for the Map AI:** The "Map Prompt" you generate MUST unequivocally instruct the document-analyzing AI (the Map AI) to:
    a.  **Targeting Specific Sections (If Applicable):**
        *   If Step 2 determined the CURRENT ORIGINAL USER QUERY targets a specific section (e.g., a "VD ord" / "CEO Statement"), the Map AI should FIRST be instructed to attempt to locate this section within the document. It should look for common titles such as 'CEO Statement', 'Word from the CEO', 'VD-ord', 'Message from the CEO', 'To Our Shareholders', 'CEO Letter', or similar variants.
        *   If the section is found, the Map AI should then perform the analytical task identified in Step 2 on THE CONTENT OF THAT SECTION ONLY.
        *   For example, if the CURRENT ORIGINAL USER QUERY is \"what are some good new ways of writing 'VD ord' that would stick out next year?\", the analytical task for the Map AI (after finding the VD ord section) would be to analyze that section for: its overall tone, its key strategic messages, any unique or unconventional phrasing or storytelling techniques used, its main calls to action, how it addresses challenges or future outlook, and any other elements that contribute to its style or impact. The Map AI should list these analytical observations.
    b.  **Extracting Specific Entities (If Applicable):**
        *   If Step 2 determined the CURRENT ORIGINAL USER QUERY is about extracting specific entities throughout the document (e.g., "files", "risks", "financial numbers"), the Map AI should focus on precisely those entities, as previously defined (including ignoring boilerplate for file mentions if the entity is 'files').
    c.  **General Instructions (Apply to all tasks for the Map AI):**
        *   The Map AI is analyzing *one document* at a time. It should not synthesize information across documents or attempt to answer the overall CURRENT ORIGINAL USER QUERY directly; its output is an intermediate result for a later synthesis stage.
        *   The Map AI must focus SOLELY AND EXCLUSIVELY on the content of the single document provided to it. It MUST NOT use any external knowledge or make assumptions.
        *   **Page Number Identification:** The Map AI should make a best effort to identify and report the page number(s) from which specific information is extracted. If the document contains explicit page markers (e.g., a string like "[Page: X]") or if page numbers can be reliably inferred from the text structure (e.g., headers/footers appearing in the raw text), these should be captured. If page numbers cannot be reliably determined for a piece of information, it should indicate this, for example, by stating: Page not clearly determinable.
        *   When extracting a piece of information or an analytical point, it MUST capture and preserve the precise original Source ID if present in the document text. Document segments are often formatted like: \\\\\`[Source ID: <ID_VALUE>, sourcefile: <FILENAME>] <TEXT_OF_CHUNK>\\\\\`. The Map AI must extract the <ID_VALUE> and associate it with its finding.
        *   **Raw Text Extraction:** For every piece of information relevant to the CURRENT ORIGINAL USER QUERY, extract and return the *entire paragraph(s) or section(s)* from the document where the information is found. Do not summarize or paraphrase—preserve the original wording and context. Always include the file name, page number (if available), and source ID (if available) for each extracted paragraph.
        *   **Structured Output Example:**
            *   Extracted Paragraph [File: Annual_Report_2024.pdf, Page: 15, Source ID: 123]:
                "In 2024, our sustainability efforts resulted in a 25% reduction in CO2 emissions, as detailed in the following initiatives..."
        *   **Noise Reduction:** The Map AI MUST IGNORE common, repetitive, non-informative phrases unless they are *essential and unique* to the query (e.g., for file extraction, ignore generic hyperlink texts like "download a printable pdf here" unless that text IS the unique name of a distinct document).
        *   **Handling No Relevant Information/Section Not Found:** 
            *   If a specific section was targeted (e.g., "VD ord") and cannot be reasonably identified after searching for common titles, the Map AI MUST state: "No clear '[Target Section Name, e.g., VD ord]' or equivalent section was identified in this document."
            *   If the section is found, but it contains no information relevant to the *specific analytical task* derived from the CURRENT ORIGINAL USER QUERY (e.g., the VD ord is found but has no discussion on X, Y, Z that the user asked about), it must state this clearly, referencing a short paraphrase of the user's specific analytical request.
            *   If the query was for general entity extraction throughout the document and nothing relevant is found, it must state: "No information relevant to the user's query '%%%USER_QUERY_SHORT_PARAPHRASE%%% ' was found in this document."

4.  **Clarity and Steerability:** Use firm, direct language in the generated "Map Prompt". The Map AI will follow instructions literally.
5.  **Placeholder:** In your generated Map Prompt, you MUST include the exact placeholder {text_content_of_single_document_will_be_injected_here} (with curly braces) at the location where the document text should be injected. Do not use any other placeholder or format.

CURRENT ORIGINAL USER QUERY:
---
%%%USER_QUERY%%%
---

Now, generate the "Map Prompt" that the document-analyzing AI will use. This generated prompt should be a complete set of instructions for the Map AI, ready for the document text to be injected. It should be tailored based on whether the CURRENT ORIGINAL USER QUERY (and prior context) implies a section-specific analysis or a general entity extraction.

Generated "Map Prompt":
`;

/**
 * Takes an original user query and optional prior conversation summary to generate a dynamic "Map Prompt"
 * tailored to guide the analysis of individual documents for the Deep Analysis feature.
 * @param originalUserQuery The user's current original query.
 * @param priorConversationSummary Optional. A summary of the preceding conversation turns.
 * @returns ActionResult containing the generated "Map Prompt" or an error.
 */
export async function generateDynamicMapPromptAction(originalUserQuery: string, priorConversationSummary?: string): Promise<ActionResult> {
  console.log("Attempting to generate dynamic 'Map Prompt' for user query:", originalUserQuery, "Prior context length:", priorConversationSummary?.length || 0);

  // Use primary Azure OpenAI environment variables
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deploymentName = process.env.AZURE_PROMPT_GEN_DEPLOYMENT_NAME; // Specific deployment for this task

  if (!endpoint || !apiKey || !deploymentName) {
    console.error("Azure OpenAI environment variables for map prompt generation (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_PROMPT_GEN_DEPLOYMENT_NAME) are not set.");
    return { success: false, error: "Server configuration error: Missing credentials for map prompt generation. Please contact support." };
  }

  // Create a short paraphrase of the user query for use in "nothing found" messages, to keep them concise.
  // This is a simple heuristic; a more complex summarization could be used if needed.
  const userQueryShortParaphrase = originalUserQuery.length > 50 ? originalUserQuery.substring(0, 47) + "..." : originalUserQuery;

  let fullMetaPrompt = META_PROMPT_FOR_MAP_PROMPT_GENERATION.replace(/%%%USER_QUERY%%%/g, originalUserQuery);
  fullMetaPrompt = fullMetaPrompt.replace(/%%%USER_QUERY_SHORT_PARAPHRASE%%%/g, userQueryShortParaphrase);

  if (priorConversationSummary && priorConversationSummary.trim() !== "") {
    fullMetaPrompt = fullMetaPrompt.replace(/%%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%/g, `PRIOR CONVERSATION CONTEXT:\n${priorConversationSummary}\n---\n`);
  } else {
    fullMetaPrompt = fullMetaPrompt.replace(/%%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%/g, "(This is the first query in the conversation.)\n");
  }

  try {
    const client = new OpenAIClient(
      endpoint, // Use primary endpoint
      new AzureKeyCredential(apiKey) // Use primary API key
    );

    const response = await client.getChatCompletions(deploymentName, [
      { role: "user", content: fullMetaPrompt }
    ], {
      maxTokens: 32000, // Increased to model max
      temperature: 0.2 // Low temperature for more deterministic prompt generation
    });

    const generatedMapPrompt = response.choices[0]?.message?.content?.trim();

    if (!generatedMapPrompt || generatedMapPrompt === "") {
      console.error("AI generated an empty or whitespace-only response for map prompt generation.", response);
      return { success: false, error: "AI failed to generate a map prompt. Please try rephrasing your query or check the AI model's status." };
    }

    // Ensure the placeholder is present in the generated prompt
    if (!generatedMapPrompt.includes("{text_content_of_single_document_will_be_injected_here}")) {
        console.error("Generated 'Map Prompt' is missing the required placeholder '{text_content_of_single_document_will_be_injected_here}'. Prompt: ", generatedMapPrompt);
        return { success: false, error: "AI generated an invalid map prompt (missing placeholder). Please try again."};
    }

    console.log("Successfully generated dynamic 'Map Prompt'.");
    return { success: true, mapPrompt: generatedMapPrompt };

  } catch (error) {
    console.error("Error calling Azure OpenAI for dynamic 'Map Prompt' generation:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    let detailedError = errorMessage;
    if (error && typeof error === 'object') {
        const code = 'code' in error ? error.code : 'N/A';
        const statusCode = 'statusCode' in error ? error.statusCode : 'N/A';
        detailedError = `${errorMessage} (Code: ${code}, Status: ${statusCode})`;
    }
    return { success: false, error: `Failed to generate map prompt due to an internal server error. Details: ${detailedError}` };
  }
} 