import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { logger } from '@/lib/logger';

interface OpenAIConfig {
  apiKey: string;
  modelName: string;
  promptTemplateBasicPath: string;
  promptTemplateExtendedPath: string;
  promptTemplateContentIdeasNormalPath: string;
  promptTemplateContentIdeasYTCommentsPath: string;
}

/**
 * Retrieves OpenAI configuration from environment variables.
 * Throws an error if essential configurations are missing.
 */
export function getOpenAIConfig(): OpenAIConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL_NAME;
  
  // Helper function to trim leading slashes for robust path joining
  const getSanitizedPath = (envVar?: string) => envVar?.replace(/^\/|E^\\/, '') || '';

  const promptTemplateBasicPath = getSanitizedPath(process.env.PROMPT_TEMPLATE_BASIC_SUMMARY_PATH);
  const promptTemplateExtendedPath = getSanitizedPath(process.env.PROMPT_TEMPLATE_EXTENDED_SUMMARY_PATH);
  const promptTemplateContentIdeasNormalPath = getSanitizedPath(process.env.PROMPT_TEMPLATE_CONTENT_IDEAS_NORMAL_PATH);
  const promptTemplateContentIdeasYTCommentsPath = getSanitizedPath(process.env.PROMPT_TEMPLATE_CONTENT_IDEAS_YT_COMMENTS_PATH);

  if (!apiKey) {
    logger.error('[OpenAIConfig] OPENAI_API_KEY is not configured.');
    throw new Error('OPENAI_API_KEY is not configured.');
  }
  if (!modelName) {
    logger.error('[OpenAIConfig] OPENAI_MODEL_NAME is not configured.');
    throw new Error('OPENAI_MODEL_NAME is not configured.');
  }
  if (!promptTemplateBasicPath) {
    logger.error('[OpenAIConfig] PROMPT_TEMPLATE_BASIC_SUMMARY_PATH is not configured.');
    throw new Error('PROMPT_TEMPLATE_BASIC_SUMMARY_PATH is not configured.');
  }
  if (!promptTemplateExtendedPath) {
    logger.error('[OpenAIConfig] PROMPT_TEMPLATE_EXTENDED_SUMMARY_PATH is not configured.');
    throw new Error('PROMPT_TEMPLATE_EXTENDED_SUMMARY_PATH is not configured.');
  }
  if (!promptTemplateContentIdeasNormalPath) {
    logger.error('[OpenAIConfig] PROMPT_TEMPLATE_CONTENT_IDEAS_NORMAL_PATH is not configured.');
    throw new Error('PROMPT_TEMPLATE_CONTENT_IDEAS_NORMAL_PATH is not configured.');
  }
  if (!promptTemplateContentIdeasYTCommentsPath) {
    logger.error('[OpenAIConfig] PROMPT_TEMPLATE_CONTENT_IDEAS_YT_COMMENTS_PATH is not configured.');
    throw new Error('PROMPT_TEMPLATE_CONTENT_IDEAS_YT_COMMENTS_PATH is not configured.');
  }

  return { 
    apiKey, 
    modelName,
    promptTemplateBasicPath,
    promptTemplateExtendedPath,
    promptTemplateContentIdeasNormalPath,
    promptTemplateContentIdeasYTCommentsPath,
  };
}

/**
 * Loads the specified prompt template.
 * @param templateType - The type of template to load ('basic_summary', 'extended_summary', 'content_ideas_normal', etc.).
 * @returns The prompt template string.
 * @throws Error if the template file cannot be read or is empty.
 */
async function loadPromptTemplate(templateType: 'basic_summary' | 'extended_summary' | 'content_ideas_normal' | 'content_ideas_yt_comments'): Promise<string> {
  const config = getOpenAIConfig();
  let templatePath: string;

  switch (templateType) {
    case 'basic_summary':
      templatePath = config.promptTemplateBasicPath;
      break;
    case 'extended_summary':
      templatePath = config.promptTemplateExtendedPath;
      break;
    case 'content_ideas_normal':
      templatePath = config.promptTemplateContentIdeasNormalPath;
      break;
    case 'content_ideas_yt_comments':
      templatePath = config.promptTemplateContentIdeasYTCommentsPath;
      break;
    default:
      logger.error(`[OpenAIService] Unknown prompt template type: ${templateType}`);
      throw new Error(`Unknown prompt template type: ${templateType}`);
  }
  
  const fullPath = path.resolve(process.cwd(), templatePath);
  logger.info(`[OpenAIService] Loading prompt template from: ${fullPath}`);

  try {
    const template = await fs.readFile(fullPath, 'utf-8');
    if (!template.trim()) {
      logger.error(`[OpenAIService] Prompt template file is empty: ${fullPath}`);
      throw new Error(`Prompt template file is empty: ${templatePath}`);
    }
    return template;
  } catch (error) {
    logger.error(`[OpenAIService] Error loading prompt template ${templatePath}:`, error);
    throw new Error(`Failed to load prompt template ${templatePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generates a summary for the given transcript using OpenAI.
 * @param transcriptText - The text of the transcript.
 * @param summaryType - The type of summary to generate ('basic' or 'extended').
 * @returns The generated summary text.
 * @throws Error if summary generation fails.
 */
export async function generateOpenAISummary(
  transcriptText: string,
  summaryType: 'basic' | 'extended'
): Promise<string> {
  logger.info(`[OpenAIService] Generating ${summaryType} summary...`);
  const { apiKey, modelName } = getOpenAIConfig();
  
  if (!transcriptText.trim()) {
    logger.warn('[OpenAIService] Transcript text is empty. Returning empty summary.');
    return ""; // Or throw an error, depending on desired behavior
  }

  let promptTemplate: string;
  try {
    promptTemplate = await loadPromptTemplate(summaryType === 'basic' ? 'basic_summary' : 'extended_summary');
  } catch (error) {
    // Error already logged by loadPromptTemplate
    throw error; // Re-throw to be caught by the worker
  }

  const populatedPrompt = promptTemplate.replace('{{transcript_text}}', transcriptText);

  const openai = new OpenAI({ apiKey });

  try {
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'user', content: populatedPrompt }
      ],
      // temperature: 0.7, // Optional: Adjust for creativity
      // max_tokens: summaryType === 'basic' ? 150 : 400, // Optional: Adjust based on desired length
    });

    // const summary = completion.choices[0]?.message?.content?.trim();
    // Handle potential API response variations
    let summary: string | null = null;
    if (completion.choices && completion.choices.length > 0) {
        const message = completion.choices[0].message;
        if (message && message.content) {
            summary = message.content.trim();
        }
    }

    if (!summary) {
      logger.error('[OpenAIService] OpenAI response did not contain a summary or content was null.');
      throw new Error('OpenAI did not return a valid summary.');
    }
    
    logger.info(`[OpenAIService] ${summaryType} summary generated successfully. Length: ${summary.length}`);
    return summary;
  } catch (error) {
    logger.error(`[OpenAIService] OpenAI API error during summary generation:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Check for specific OpenAI error types if needed
    if (error instanceof OpenAI.APIError) {
        logger.error(`[OpenAIService] OpenAI APIError: Status ${error.status}, Type ${error.type}, Code ${error.code}`);
        throw new Error(`OpenAI API Error (${error.status || 'unknown_status'}): ${error.message}`);
    }
    throw new Error(`Failed to generate summary using OpenAI: ${errorMessage}`);
  }
}

/**
 * Parses the LLM response to extract plain text and a JSON object.
 * Assumes the response is structured with a single "---JSON_SEPARATOR---"
 * dividing the plaintext report from the JSON object.
 * @param llmResponse - The full string response from the LLM.
 * @returns An object containing resultTxt and resultJson.
 */
function parseLLMResponseForTextAndJson(llmResponse: string): { resultTxt: string; resultJson: object | null } {
  const separator = "---JSON_SEPARATOR---";
  const separatorIndex = llmResponse.indexOf(separator);

  let resultTxt = "";
  let resultJson: object | null = null;

  if (separatorIndex !== -1) {
    resultTxt = llmResponse.substring(0, separatorIndex).trim();
    const jsonString = llmResponse.substring(separatorIndex + separator.length).trim();
    if (jsonString) {
      try {
        resultJson = JSON.parse(jsonString);
      } catch (error) {
        logger.error(`[OpenAIService-ParseUtil] Failed to parse JSON after separator: ${error instanceof Error ? error.message : String(error)}`);
        const snippet = jsonString.substring(0, Math.min(jsonString.length, 500));
        logger.debug(`[OpenAIService-ParseUtil] JSON string snippet that failed: "${snippet}"`);
        resultJson = null;
      }
    } else {
      logger.warn('[OpenAIService-ParseUtil] JSON string after separator was empty.');
      resultJson = null;
    }
  } else {
    logger.warn(`[OpenAIService-ParseUtil] Separator "${separator}" not found. Assuming entire response is plaintext.`);
    resultTxt = llmResponse.trim();
    resultJson = null;
  }
  return { resultTxt, resultJson };
}

/**
 * Generates content ideas for a given transcript using OpenAI.
 * @param transcriptText - The text of the transcript.
 * @param optionalSummaryText - Optional summary text to include in the prompt.
 * @returns An object containing the generated text and JSON results.
 * @throws Error if content idea generation fails.
 */
export async function generateNormalContentIdeas(
  transcriptText: string,
  optionalSummaryText?: string | null
): Promise<{ resultTxt: string; resultJson: object | null }> {
  const operationType = 'content_ideas_normal';
  logger.info(`[OpenAIService] Generating ${operationType}...`);
  const { apiKey, modelName } = getOpenAIConfig();
  
  if (!transcriptText.trim()) {
    logger.warn('[OpenAIService] Transcript text is empty for content ideas. Returning empty results.');
    return { resultTxt: "", resultJson: null }; 
  }

  let promptTemplate: string;
  try {
    promptTemplate = await loadPromptTemplate(operationType);
  } catch (error) {
    throw error; 
  }

  let populatedPrompt = promptTemplate.replace('{{transcript_text}}', transcriptText);
  
  // Handle simplified {{summary_text}} placeholder
  if (optionalSummaryText && optionalSummaryText.trim()) {
    populatedPrompt = populatedPrompt.replace('{{summary_text}}', optionalSummaryText);
  } else {
    // If no summary, replace the placeholder with an empty string
    // This handles the case where the template directly uses {{summary_text}}
    // without an {{#if}} block, like "SUMMARY:\n{{summary_text}}"
    populatedPrompt = populatedPrompt.replace('{{summary_text}}', '');
    // Optionally, if you want to remove the whole line "SUMMARY:\n" when summary is empty:
    // populatedPrompt = populatedPrompt.replace(/^SUMMARY:\n{{summary_text}}\n?/m, '');
    // The above line uses regex: ^ for start of line, \n? for optional newline, m for multiline.
    // For now, just replacing {{summary_text}} with empty string is safer and simpler.
  }

  const openai = new OpenAI({ apiKey });

  // Log the populated prompt before sending to OpenAI for debugging
  logger.debug(`[OpenAIService] Populated prompt for ${operationType}:\n${populatedPrompt.substring(0, 500)}...`); // Log first 500 chars

  try {
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'user', content: populatedPrompt }
      ],
    });

    let rawResponse: string | null = null;
    if (completion.choices && completion.choices.length > 0) {
        const message = completion.choices[0].message;
        if (message && message.content) {
            rawResponse = message.content.trim();
        }
    }

    if (!rawResponse) {
      logger.error('[OpenAIService] OpenAI response did not contain content for content ideas.');
      throw new Error('OpenAI did not return valid content for ideas.');
    }
    
    const { resultTxt, resultJson } = parseLLMResponseForTextAndJson(rawResponse);

    // Allow one of them to be null/empty, but not both.
    if (!resultTxt && !resultJson) { 
        logger.error('[OpenAIService] Failed to parse any text or JSON from LLM response for content ideas.');
        throw new Error('Failed to parse content ideas from OpenAI response.');
    }

    logger.info(`[OpenAIService] ${operationType} generated successfully.`);
    return { resultTxt, resultJson };

  } catch (error: unknown) { // Changed from 'error' to 'error: unknown' for better type safety
    logger.error(`[OpenAIService] OpenAI API error during ${operationType} generation:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Check for specific OpenAI error types if needed
    if (error instanceof OpenAI.APIError) { // Added 'OpenAI.' prefix
        logger.error(`[OpenAIService] OpenAI APIError: Status ${error.status}, Type ${error.type}, Code ${error.code}`);
        throw new Error(`OpenAI API Error (${error.status || 'unknown_status'}): ${error.message}`);
    }
    throw new Error(`Failed to generate ${operationType} using OpenAI: ${errorMessage}`);
  }
}

/**
 * NEW FUNCTION
 * Generates content ideas based on transcript text and YouTube comments using OpenAI.
 * @param transcriptText - The text of the transcript.
 * @param filteredCommentsText - A string containing the processed and filtered YouTube comments.
 * @returns An object containing the generated text and JSON results.
 * @throws Error if content idea generation fails.
 */
export async function generateCommentBasedContentIdeas(
  transcriptText: string,
  filteredCommentsText: string
): Promise<{ resultTxt: string; resultJson: object | null }> {
  const operationType = 'content_ideas_yt_comments';
  logger.info(`[OpenAIService] Generating ${operationType}...`);
  const { apiKey, modelName } = getOpenAIConfig();

  if (!transcriptText.trim()) {
    logger.warn('[OpenAIService] Transcript text is empty for comment-based content ideas. Aborting.');
    return { resultTxt: "Error: Transcript text was empty.", resultJson: null };
  }
  if (!filteredCommentsText.trim()) {
    logger.warn('[OpenAIService] Filtered comments text is empty for comment-based content ideas. Proceeding with transcript only might yield poor results, but attempting.');
    // Or, optionally return an error/empty result: return { resultTxt: "Error: Filtered comments text was empty.", resultJson: null };
  }

  let promptTemplate: string;
  try {
    promptTemplate = await loadPromptTemplate(operationType);
  } catch (error) {
    throw error; // Re-throw to be caught by the worker/caller
  }

  let populatedPrompt = promptTemplate.replace('{{transcript_text}}', transcriptText);
  populatedPrompt = populatedPrompt.replace('{{filtered_comments_text}}', filteredCommentsText);

  const openai = new OpenAI({ apiKey });

  // Log the populated prompt before sending to OpenAI for debugging
  logger.debug(`[OpenAIService] Populated prompt for ${operationType}:\n${populatedPrompt.substring(0, 500)}...`); // Log first 500 chars

  try {
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'user', content: populatedPrompt }
      ],
      // Consider adjusting temperature or max_tokens if needed for this specific task
    });

    let rawResponse: string | null = null;
    if (completion.choices && completion.choices.length > 0 && completion.choices[0].message) {
      rawResponse = completion.choices[0].message.content;
    }

    if (!rawResponse) {
      logger.error(`[OpenAIService] OpenAI response did not contain content for ${operationType}.`);
      throw new Error(`OpenAI did not return a valid response for ${operationType}.`);
    }

    logger.info(`[OpenAIService] ${operationType} ideas generated successfully. Raw response length: ${rawResponse.length}`);
    return parseLLMResponseForTextAndJson(rawResponse);
  } catch (error) {
    logger.error(`[OpenAIService] OpenAI API error during ${operationType} generation:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (error instanceof OpenAI.APIError) {
        logger.error(`[OpenAIService] OpenAI APIError: Status ${error.status}, Type ${error.type}, Code ${error.code}`);
        throw new Error(`OpenAI API Error (${error.status || 'unknown_status'}) for ${operationType}: ${error.message}`);
    }
    throw new Error(`Failed to generate ${operationType} using OpenAI: ${errorMessage}`);
  }
} 