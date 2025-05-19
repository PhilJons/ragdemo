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
You are an expert AI specializing in crafting highly effective prompts for Large Language Models (LLMs).
Your task is to generate a "Map Prompt" that will be used by another AI to analyze individual documents in detail.
The goal of this "Map Prompt" is to guide the document-analyzing AI to extract information specifically relevant to the following original user query:
---
ORIGINAL USER QUERY: {user_query}
---

The "Map Prompt" you generate MUST instruct the document-analyzing AI to:
1.  Focus SOLELY AND EXCLUSIVELY on the content of the single document provided to it.
2.  Identify and extract ONLY the information directly relevant to answering the ORIGINAL USER QUERY.
3.  When extracting a piece of information (e.g., a statement, a fact, a recommendation), it MUST also capture and preserve the precise original Source ID associated with that piece of information if present in the document text. Document text segments are often formatted like this: \`[Source ID: <ID_VALUE>, sourcefile: <FILENAME>] <TEXT_OF_CHUNK>\`. The document-analyzing AI must extract the <ID_VALUE>.
4.  The output for each extracted piece of information should be structured to clearly pair the information with its Source ID. For example: "Extracted detail: [The extracted text] [Source ID: <original_ID_VALUE>]". Multiple such pairings can be listed.
5.  If no information relevant to the ORIGINAL USER QUERY is found in the specific document text it is analyzing, it MUST state this clearly (e.g., "No information relevant to the user's query was found in this document.").
6.  It must NOT use any external knowledge or make assumptions beyond the provided document text.

Example of what the *generated "Map Prompt"* might look like (if the user query was "What are the key financial risks?"):
---
You are an AI Document Analyzer. The overall user query is about "What are the key financial risks?".
Based SOLELY AND EXCLUSIVELY on the document text provided below, identify and list all explicit mentions of financial risks.
For each financial risk identified, if the text includes a [Source ID: <ID_VALUE>, sourcefile: <FILENAME>] marker associated with it, you MUST output the risk along with its specific <ID_VALUE> like this: 'Financial Risk: [Text of the risk] [Source ID: <original_ID_VALUE>]'.
If no financial risks are mentioned, state 'No financial risks found in this document.'

Document Text:
---
{text_content_of_single_document_will_be_injected_here}
---

Financial Risks found (with Source IDs):
---

Remember, you are generating the PROMPT that the document-analyzing AI will use. Do not try to answer the user's query yourself.
The "Map Prompt" should be ready to have the actual document text injected into the placeholder {text_content_of_single_document_will_be_injected_here}.

Generated "Map Prompt":
`;

/**
 * Takes an original user query and generates a dynamic "Map Prompt"
 * tailored to guide the analysis of individual documents for the Deep Analysis feature.
 * @param originalUserQuery The user's original query.
 * @returns ActionResult containing the generated "Map Prompt" or an error.
 */
export async function generateDynamicMapPromptAction(originalUserQuery: string): Promise<ActionResult> {
  console.log("Attempting to generate dynamic 'Map Prompt' for user query:", originalUserQuery);

  const promptGenEndpoint = process.env.AZURE_PROMPT_GEN_ENDPOINT;
  const promptGenApiKey = process.env.AZURE_PROMPT_GEN_API_KEY;
  const promptGenDeploymentName = process.env.AZURE_PROMPT_GEN_DEPLOYMENT_NAME;

  if (!promptGenEndpoint || !promptGenApiKey || !promptGenDeploymentName) {
    console.error("Prompt Generation Service environment variables for map prompt generation are not set. Ensure AZURE_PROMPT_GEN_ENDPOINT, AZURE_PROMPT_GEN_API_KEY, and AZURE_PROMPT_GEN_DEPLOYMENT_NAME are defined.");
    return { success: false, error: "Server configuration error: Missing credentials for map prompt generation. Please contact support." };
  }

  const fullMetaPrompt = META_PROMPT_FOR_MAP_PROMPT_GENERATION.replace("{user_query}", originalUserQuery);

  try {
    const client = new OpenAIClient(
      promptGenEndpoint,
      new AzureKeyCredential(promptGenApiKey)
    );

    const response = await client.getChatCompletions(promptGenDeploymentName, [
      { role: "user", content: fullMetaPrompt }
    ], {
      maxTokens: 1000, // Max tokens for the generated map prompt itself
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