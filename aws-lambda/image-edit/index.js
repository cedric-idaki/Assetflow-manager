/**
 * AWS Lambda Function for Image Editing
 * Supports OpenAI and Gemini providers
 * Uses @rocketnew/llm-sdk for multi-provider support
 */

const { imageEdit } = require('@rocketnew/llm-sdk');

function formatErrorResponse(error, provider) {
  const statusCode = error?.statusCode || 500;
  const providerName = error?.llmProvider || provider || 'Unknown';
  
  return {
    error: `${providerName?.toUpperCase()} API error: ${statusCode}`,
    details: error?.message || error?.body || String(error),
  };
}

exports.handler = async (event) => {
  // Set response headers
  const headers = {
    'Content-Type': 'application/json',
  };

  // Only allow POST requests
  if (event?.requestContext?.http?.method !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: 'Method not allowed: Use POST',
        details: 'This endpoint only accepts POST requests',
      }),
    };
  }

  let body = {};

  try {
    // Parse request body
    if (event?.body) {
      try {
        body = typeof event?.body === 'string' ? JSON.parse(event?.body) : event?.body;
      } catch (e) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Invalid JSON in request body',
            details: e?.message,
          }),
        };
      }
    }

    // Get API key from environment variable based on provider
    let apiKey;
    if (body?.provider === 'OPEN_AI') {
      apiKey = process.env.OPENAI_API_KEY;
    } else if (body?.provider === 'GEMINI') {
      apiKey = process.env.GEMINI_API_KEY;
    }

    if (!apiKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: `${body?.provider ? body?.provider?.toUpperCase() : 'LLM Provider'} API key is not configured`,
          details: 'The API key for this provider is missing in environment variables',
        }),
      };
    }

    const { prompt } = body;
    if (!prompt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid request: Prompt is required',
          details: 'The request must include a prompt describing the edit to apply',
        }),
      };
    }

    const { image } = body;
    if (!image) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid request: Image is required',
          details: 'The request must include an image as base64 string or data URL',
        }),
      };
    }

    const { model } = body;
    if (!model) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid request: Model is required',
          details: 'The request must include a model name for image editing',
        }),
      };
    }

    // Process image - handle base64 strings (with or without data URL prefix)
    let processedImage = image;
    if (typeof image === 'string') {
      // Remove data URL prefix if present (e.g., "data:image/png;base64,")
      if (image?.startsWith('data:')) {
        processedImage = image?.split(',')?.[1];
      }
    }

    // All optional parameters are passed through body.parameters
    const response = await imageEdit({
      model,
      prompt,
      image: processedImage,
      api_key: apiKey,
      ...(body?.parameters || {}),
    });

    // Return JSON response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };
  } catch (error) {
    // Return error response
    const errorResponse = formatErrorResponse(error, body?.provider);
    return {
      statusCode: error?.statusCode || 500,
      headers,
      body: JSON.stringify(errorResponse),
    };
  }
};
