import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { logger } from '@/lib/logger';

interface OpenAIConfig {
  apiKey: string;
  modelName: string;
  promptTemplateBasicPath: string;
  promptTemplateExtendedPath: string;
}

/**
 * Retrieves OpenAI configuration from environment variables.
 * Throws an error if essential configurations are missing.
 */
export function getOpenAIConfig(): OpenAIConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL_NAME;
  const promptTemplateBasicPath = process.env.PROMPT_TEMPLATE_BASIC_SUMMARY_PATH;
  const promptTemplateExtendedPath = process.env.PROMPT_TEMPLATE_EXTENDED_SUMMARY_PATH;

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

  return { 
    apiKey, 
    modelName,
    promptTemplateBasicPath,
    promptTemplateExtendedPath
  };
}

/**
 * Loads the specified prompt template.
 * @param summaryType - The type of summary ('basic' or 'extended').
 * @returns The prompt template string.
 * @throws Error if the template file cannot be read or is empty.
 */
async function loadPromptTemplate(summaryType: 'basic' | 'extended'): Promise<string> {
  const config = getOpenAIConfig();
  const templatePath = summaryType === 'basic' 
    ? config.promptTemplateBasicPath 
    : config.promptTemplateExtendedPath;
  
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
    promptTemplate = await loadPromptTemplate(summaryType);
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