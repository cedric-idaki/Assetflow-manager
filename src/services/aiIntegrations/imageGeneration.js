import { callLambdaFunction } from '../aiClient';

/**
 * Lambda endpoint for image generation
 */
const IMAGE_GENERATION_ENDPOINT = import.meta.env?.VITE_AWS_LAMBDA_IMAGE_GENERATION_URL;

/**
 * Generate image from any AI provider
 * 
 * @param {string} provider - Provider identifier (e.g., 'OPEN_AI', 'GEMINI')
 * @param {string} model - Model name
 * @param {string} prompt - Image description prompt
 * @param {object} options - Additional parameters
 * @returns {Promise<object>} Raw Lambda response
 */
export async function generateImage(provider, model, prompt, options = {}) {
  const payload = {
    provider,
    model,
    prompt,
    parameters: options,
  };

  const response = await callLambdaFunction(
    IMAGE_GENERATION_ENDPOINT,
    payload
  );

  return response;
}