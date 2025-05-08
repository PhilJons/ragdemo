'use server';

// Use the base @azure/openai client for explicit configuration
import { OpenAIClient, AzureKeyCredential } from "@azure/openai"; 
// Keep generateText from 'ai' but we won't use @ai-sdk/azure here
import { generateText } from 'ai'; 

interface ActionResult {
  success: boolean;
  structuredPrompt?: string;
  error?: string;
}

// Placeholder for the actual meta-prompt engineering logic
const META_PROMPT = `
You are an Expert Prompt Engineer AI, tasked with assisting a user in creating a high-quality, effective system prompt for a RAG (Retrieval Augmented Generation) application.
The user will provide their raw ideas, instructions, or bullet points. Your goal is to transform these into a well-structured system prompt that will guide an advanced Large Language Model (LLM) like GPT-4.1.

The generated system prompt MUST enable the target LLM to:
1.  **Leverage Retrieved Context:** Primarily base its answers on textual context retrieved from a knowledge base.
2.  **Cite Sources Accurately:** When using information from retrieved documents, cite them using the application's standard format: [Source ID: <id>, sourcefile: <filename>].
3.  **Handle Missing Information as Specified:** Follow user-defined instructions on how to respond if the retrieved context does not contain the answer (e.g., "State 'Information not found in the provided documents.'", or "Attempt a general answer but indicate context was missing.").
4.  **Follow Instructions Literally and Precisely (GPT-4.1 Principle):** Execute the user's defined task with high fidelity.

**Your Process for Structuring the System Prompt:**

A.  **Understand User's Core Goal:**
    *   Parse the user's raw input to understand who the AI is (ROLE), what it needs to achieve (TASK), the subject matter (CONTEXT), and who the output is for (AUDIENCE).
    *   Pay close attention to any user examples of desired input/output or specific formatting requests.

B.  **Construct the System Prompt with these Sections:**

    1.  **\`## Role\`**: Define the persona or role the target LLM should adopt.
        *(Example: "You are a financial analyst AI specializing in summarizing quarterly earnings reports.")*

    2.  **\`## Primary Directive & Task\`**: Clearly state the main objective. Be specific and unambiguous.
        *(Example: "Your primary directive is to answer user questions based *solely* on the provided context from retrieved documents. Analyze the documents to extract relevant information and synthesize a comprehensive answer. Your task is to {specific task based on user input, e.g., 'identify key ESG risks mentioned in CSR reports'}.")*

    3.  **\`## Context & Knowledge Base Interaction (RAG Instructions)\`**: This is CRITICAL.
        *   **Context Primacy:** "You will be provided with text segments from various documents under the label 'Retrieved Context'. Your answers MUST be grounded in this retrieved information. Do not use external knowledge unless explicitly instructed by the user for a specific part of the task."
        *   **Source Citation:** "When you use information directly from a retrieved document segment, you MUST cite the source at the end of the relevant sentence or paragraph using the format: \`[Source ID: <id_from_context>, sourcefile: <filename_from_context>]\`. Strive to cite multiple sources if information is synthesized from them."
        *   **Handling Insufficient Context:** "If the retrieved context does not contain information to answer the query, you will respond by {USER_SPECIFIED_MISSING_INFO_BEHAVIOR}. If the user hasn't specified this, default to: 'Based on the provided documents, I cannot answer that question.'" *(Your goal is to make sure this placeholder is in the generated prompt for the user to fill or for you to infer from their raw input if possible).*
        *   **Quoting:** "If the user asks for direct quotes or extractions, provide them verbatim and cite the source."

    4.  **\`## User Input Interpretation\`**: How the LLM should understand the user's chat messages.
        *(Example: "The user will ask questions or provide instructions related to the documents. Interpret their queries literally to find the most relevant information.")*

    5.  **\`## Output Requirements & Structure\`**: Define the desired format, style, and length of the LLM's response.
        *   Incorporate any specific structure the user requests (e.g., bullet points, report sections).
        *   If the user provided an example of good output, model the structure after it.
        *   *(Example: "Respond in a concise, professional tone. If summarizing, use bullet points for key findings. Ensure all claims are backed by cited evidence from the context.")*

    6.  **\`## Response if Unsure (Beyond RAG)\`**: (Optional, but good practice from GPT-4.1 guide)
        *   "If a query is ambiguous or you require clarification to provide an accurate RAG-based answer, clearly state what information you need from the user."

C.  **Refinement & Principles:**
    *   **Clarity and Unambiguity:** Ensure every instruction is crystal clear.
    *   **Specificity:** Avoid vague language. Use precise terms.
    *   **Completeness:** Equip the target LLM with all necessary information for its role and task.
    *   **Steerability:** Phrase instructions to guide the target LLM's behavior effectively and reliably. A single, firm sentence can often steer the model.

D.  **Your Output to the User (The System Prompt):**
    *   Provide ONLY the structured system prompt content. Do NOT include any conversational preface, your own reasoning notes, or "Here's the prompt:" type of statements.
    *   The section for \`{USER_SPECIFIED_MISSING_INFO_BEHAVIOR}\` should be clearly identifiable if you couldn't infer it, so the user can easily edit it. Example: "...you will respond by [Specify AI behavior for missing information, e.g., 'stating information is not found'].".

User's Raw Input:
---
{USER_INPUT}
---

Structured System Prompt:
`;

/**
 * Takes raw user input intended for a system prompt and uses an AI model
 * to structure it into a more effective prompt.
 * @param rawPromptContent The user\'s unstructured thoughts.
 * @returns ActionResult containing the structured prompt or an error.
 */
export async function structureUserInputsIntoSystemPromptAction(rawPromptContent: string): Promise<ActionResult> {
  console.log("Attempting to structure prompt for raw input:", rawPromptContent);

  // Basic check for environment variables for the Prompt Generation service
  const promptGenEndpoint = process.env.AZURE_PROMPT_GEN_ENDPOINT;
  const promptGenApiKey = process.env.AZURE_PROMPT_GEN_API_KEY;
  const promptGenDeploymentName = process.env.AZURE_PROMPT_GEN_DEPLOYMENT_NAME; 
  // Note: AZURE_PROMPT_GEN_RESOURCE_NAME is not directly used by OpenAIClient constructor

  if (!promptGenEndpoint || !promptGenApiKey || !promptGenDeploymentName) {
    console.error("Prompt Generation Service environment variables are not set. This action will not work. Please check server configuration. Ensure AZURE_PROMPT_GEN_ENDPOINT, AZURE_PROMPT_GEN_API_KEY, and AZURE_PROMPT_GEN_DEPLOYMENT_NAME are defined.");
    return { success: false, error: "Server configuration error: Missing Prompt Generation Service credentials. Please contact support or check environment variables." };
  }

  const fullPrompt = META_PROMPT.replace("{USER_INPUT}", rawPromptContent);

  try {
    // Initialize OpenAIClient specifically for the Prompt Gen service
    const client = new OpenAIClient(
      promptGenEndpoint,
      new AzureKeyCredential(promptGenApiKey)
    );

    // Use the client to get chat completions directly
    const response = await client.getChatCompletions(promptGenDeploymentName, [
      // We are using the META_PROMPT as the user message here, 
      // as the generateText function is not directly compatible 
      // with this client without more complex wrapping.
      { role: "user", content: fullPrompt }
      // If META_PROMPT was intended as a system message, adjust structure here:
      // { role: "system", content: "... extracted meta prompt role/task ..." },
      // { role: "user", content: rawPromptContent }
    ], {
      // Optional parameters
      maxTokens: 1500,
      temperature: 0.5
    });

    const structuredPromptOutput = response.choices[0]?.message?.content?.trim();

    if (!structuredPromptOutput || structuredPromptOutput === "") {
      console.error("AI generated an empty or whitespace-only response for prompt structuring.", response);
      return { success: false, error: "AI generated an empty response. Please try rephrasing your input or check the AI model's status." };
    }

    console.log("Successfully structured prompt."); // Avoid logging potentially large prompt here
    return { success: true, structuredPrompt: structuredPromptOutput };

  } catch (error) {
    console.error("Error calling Azure OpenAI (@azure/openai) for prompt structuring:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Add more details if available from Azure OpenAI errors
    let detailedError = errorMessage;
    // Safely check for code and statusCode properties
    if (error && typeof error === 'object') {
        const code = 'code' in error ? error.code : 'N/A';
        const statusCode = 'statusCode' in error ? error.statusCode : 'N/A';
        detailedError = `${errorMessage} (Code: ${code}, Status: ${statusCode})`;
    }
    return { success: false, error: `Failed to generate structured prompt due to an internal server error. Details: ${detailedError}` };
  }
}