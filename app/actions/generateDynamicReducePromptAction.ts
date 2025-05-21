'use server';

import { OpenAIClient, AzureKeyCredential } from "@azure/openai";

interface ActionResult {
  success: boolean;
  reducePrompt?: string;
  error?: string;
}

// META_PROMPT_FOR_REDUCE_PROMPT_GENERATION:
// This meta-prompt instructs an LLM to generate a *specific system prompt* (the \"Reduce System Prompt\")
// that will then be used to guide the \"Reduce\" phase LLM during Deep Analysis.
// The generated \"Reduce System Prompt\" must be tailored to the original user query 
// and the nature of the data extracted during the map phase.
const META_PROMPT_FOR_REDUCE_PROMPT_GENERATION = `
You are an expert AI specializing in crafting highly effective, flexible, and goal-oriented system prompts for Large Language Models (LLMs), specifically GPT-4.1 class models.

**You MUST answer in the same language as the CURRENT ORIGINAL USER QUERY. If the query is in Swedish, answer in Swedish. If in English, answer in English, etc.**

Your task is to generate a "Reduce System Prompt". This prompt will instruct a "Reduce AI" on how to synthesize information extracted from multiple documents (by a previous "Map AI" phase) and generate a comprehensive, insightful, and potentially creative response to the CURRENT ORIGINAL USER QUERY, taking into account any relevant prior conversation.

Consider the following inputs when crafting the "Reduce System Prompt":
1.  **CURRENT ORIGINAL USER QUERY:** %%%USER_QUERY%%%
2.  **PRIOR CONVERSATION CONTEXT (if any):** %%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%
3.  **SUMMARY OF MAP OUTPUTS:** %%%SUMMARY_OF_MAP_OUTPUTS%%% 
    (This summary describes the *kind* of information extracted by the Map AI from each document, e.g., "full relevant text paragraphs related to sustainability goals" or "structured analyses of CEO statements, including themes, tone, and stylistic elements").

Follow these principles and steps to construct the "Reduce System Prompt":

A.  **Core Objective for the Reduce AI:**
    The primary goal for the Reduce AI is to synthesize the aggregated information from the Map AI's outputs to comprehensively answer the CURRENT ORIGINAL USER QUERY, informed by any %%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%. The nature of the answer (analytical, generative, comparative, etc.) should be guided by the CURRENT ORIGINAL USER QUERY and prior discussion.

B.  **Instructions for the Reduce AI (to be included in the generated prompt):**
    1.  **Understand the Goal:** Clearly state that the Reduce AI's first step is to understand the CURRENT ORIGINAL USER QUERY: "%%%USER_QUERY%%%", in the context of any prior conversation: %%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%.
    2.  **Input Data:** Explain that its input will be a consolidated block of text containing analyses/extractions from multiple documents. Each document's contribution is clearly demarcated and may contain citation markers such as 'Source ID: ...', 'File: ...', and 'Page: ...'. The extracted content will often be the full, relevant raw text paragraph(s) or section(s) from the document, not just summaries or metrics.
    3.  **Synthesize, Don't Just List:** Instruct the Reduce AI to go beyond merely listing the mapped information. It should consolidate findings, identify patterns, compare and contrast (if appropriate for the query), and draw insights *from the provided text only*.
    4.  **Address the User Query Directly:** The final output must directly and comprehensively answer the CURRENT ORIGINAL USER QUERY.
    5.  **Creative/Generative Tasks (If Applicable):** If the CURRENT ORIGINAL USER QUERY implies a creative or generative task (e.g., "suggest new ways", "write a proposal", "brainstorm ideas"), the Reduce AI should be explicitly instructed to perform this task, using the synthesized information as its foundation. For instance, for a query like "what are some good new ways of writing 'VD ord' that would stick out next year?", after analyzing provided VD ords, it should generate novel suggestions.
    6.  **Filter Noise & Prioritize Relevance:** Instruct the Reduce AI to critically evaluate the aggregated map outputs. It should identify and deprioritize or ignore repetitive noise, boilerplate, or information clearly irrelevant to the CURRENT ORIGINAL USER QUERY and %%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%. The aim is a coherent, focused answer.
    7.  **Accurate Citations:** MANDATE the preservation and correct use of any citation markers from the mapped information. This includes 'Source ID: ...', 'File: ...', and 'Page: ...'. When presenting information, the Reduce AI should cite the document name, page number, and source ID (if available) for each referenced paragraph or section. For example: (as stated in Annual_Report_2024.pdf, page 15, Source ID: 123) or (see file CEO_Speech.docx, pages 2-3, Source ID: None). If page or source ID is not determinable, it can omit that part or state it is unknown.
    8.  **No External Knowledge:** Strictly prohibit the use of any information not present in the aggregated map outputs.
    9.  **Handling Insufficient Information:** If the aggregated map outputs do not contain sufficient information to fully address the CURRENT ORIGINAL USER QUERY (even considering prior context), the Reduce AI must clearly state this, explaining what aspects cannot be answered and why (e.g., "While the documents provided details on X and Y, and our prior discussion covered A, they did not contain specific information regarding Z, which is needed to fully answer your current query about...").
    10. **Suggest Follow-up Questions (Agentic Behavior):** Instruct the Reduce AI to conclude its response by proposing 1-2 insightful follow-up questions that the user could ask to further refine the analysis, delve deeper into a specific aspect (possibly building on the %%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%), or explore related topics. These questions should aim to make the next turn in the conversation even more productive.
    11. **Response Style:** Unless the query implies a very specific format, guide the Reduce AI to produce a well-structured, articulate, and professional response. Avoid conversational fillers unless a conversational style is explicitly requested by the user query.

C.  **Flexibility and Adaptability:**
    While you are generating a system prompt, it should empower the Reduce AI to be flexible in *how* it structures its response to best fit the CURRENT ORIGINAL USER QUERY, the nature of the %%%SUMMARY_OF_MAP_OUTPUTS%%% and any %%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%. It should not be constrained by a rigid template if a different presentation would be more effective.

D.  **Placeholder for Aggregated Data:**
    The generated "Reduce System Prompt" does NOT need a placeholder for the aggregated map data. The aggregated data will be passed as a user message to the Reduce AI, and this generated system prompt will be its guiding instruction.

Now, generate the "Reduce System Prompt" for the Reduce AI.

Generated "Reduce System Prompt":
`;

/**
 * Takes an original user query, a summary of map phase outputs, and optional prior conversation summary
 * to generate a dynamic "Reduce System Prompt"
 * tailored to guide the synthesis and response generation for the Deep Analysis feature.
 * @param originalUserQuery The user's current original query.
 * @param summaryOfMapOutputs A brief description of the kind of data extracted by the map phase.
 * @param priorConversationSummary Optional. A summary of the preceding conversation turns.
 * @returns ActionResult containing the generated "Reduce System Prompt" or an error.
 */
export async function generateDynamicReducePromptAction(originalUserQuery: string, summaryOfMapOutputs: string, priorConversationSummary?: string): Promise<ActionResult> {
  console.log("Attempting to generate dynamic 'Reduce System Prompt' for user query:", originalUserQuery, "map summary:", summaryOfMapOutputs, "Prior context length:", priorConversationSummary?.length || 0);

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  // Consider using a different deployment if this meta-prompting task is significantly different
  // from map prompt generation or if you want to use a model more suited for complex instruction generation.
  const deploymentName = process.env.AZURE_PROMPT_GEN_DEPLOYMENT_NAME; 

  if (!endpoint || !apiKey || !deploymentName) {
    console.error("Azure OpenAI environment variables for reduce prompt generation (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_PROMPT_GEN_DEPLOYMENT_NAME) are not set.");
    return { success: false, error: "Server configuration error: Missing credentials for reduce prompt generation." };
  }

  let fullMetaPrompt = META_PROMPT_FOR_REDUCE_PROMPT_GENERATION.replace(/%%%USER_QUERY%%%/g, originalUserQuery);
  fullMetaPrompt = fullMetaPrompt.replace(/%%%SUMMARY_OF_MAP_OUTPUTS%%%/g, summaryOfMapOutputs);
  if (priorConversationSummary && priorConversationSummary.trim() !== "") {
    fullMetaPrompt = fullMetaPrompt.replace(/%%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%/g, `PRIOR CONVERSATION CONTEXT:\n${priorConversationSummary}\n---\n`);
  } else {
    fullMetaPrompt = fullMetaPrompt.replace(/%%%PRIOR_CONVERSATION_CONTEXT_IF_ANY%%%/g, "(This is the first query in the conversation.)\n");
  }

  try {
    const client = new OpenAIClient(endpoint, new AzureKeyCredential(apiKey));
    const response = await client.getChatCompletions(deploymentName, [
      { role: "user", content: fullMetaPrompt }
    ], {
      maxTokens: 32000, // Increased to model max
      temperature: 0.25 // Low-ish temperature for fairly deterministic but slightly flexible prompt generation
    });

    const generatedReducePrompt = response.choices[0]?.message?.content?.trim();

    if (!generatedReducePrompt || generatedReducePrompt === "") {
      console.error("AI generated an empty or whitespace-only response for reduce prompt generation.", response);
      return { success: false, error: "AI failed to generate a reduce system prompt." };
    }

    console.log("Successfully generated dynamic 'Reduce System Prompt'.");
    return { success: true, reducePrompt: generatedReducePrompt };

  } catch (error) {
    console.error("Error calling Azure OpenAI for dynamic 'Reduce System Prompt' generation:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Basic error formatting, can be expanded
    return { success: false, error: `Failed to generate reduce system prompt: ${errorMessage}` };
  }
} 