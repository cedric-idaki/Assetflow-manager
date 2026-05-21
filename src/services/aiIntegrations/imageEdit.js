import { callLambdaFunction } from '../aiClient';

/**
 * Lambda endpoint for image editing
 */
const IMAGE_EDIT_ENDPOINT = import.meta.env?.VITE_AWS_LAMBDA_IMAGE_EDIT_URL;

/**
 * Edit image using any AI provider
 * 
 * @param {string} provider - Provider identifier (e.g., 'OPEN_AI', 'GEMINI')
 * @param {string} model - Model name
 * @param {string} image - Base64 image string
 * @param {string} prompt - Edit instructions
 * @param {object} options - Additional parameters
 * @returns {Promise<object>} Raw Lambda response
 */
export async function editImage(provider, model, image, prompt, options = {}) {
  const payload = {
    provider,
    model,
    image,
    prompt,
    parameters: options,
  };

  const response = await callLambdaFunction(
    IMAGE_EDIT_ENDPOINT,
    payload
  );

  return response;
}
