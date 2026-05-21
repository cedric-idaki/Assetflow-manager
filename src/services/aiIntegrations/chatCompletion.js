import { callLambdaFunction } from '../aiClient';

/**
 * Lambda endpoints configuration
 */
const CHAT_COMPLETION_ENDPOINT = import.meta.env?.VITE_AWS_LAMBDA_CHAT_COMPLETION_URL;

/**
 * Get chat completion from any AI provider
 * 
 * @param {string} provider - Provider identifier (e.g., 'ANTHROPIC', 'OPENAI')
 * @param {string} model - Model name
 * @param {array} messages - Messages array
 * @param {object} options - Additional parameters
 */
export async function getChatCompletion(provider, model, messages, options = {}) {
  const payload = {
    provider,
    model,
    messages,
    stream: false,
    parameters: options,
  };

  const response = await callLambdaFunction(
    CHAT_COMPLETION_ENDPOINT,
    payload
  );

  // Return full SDK response for maximum flexibility
  return response;
}

/**
 * Stream chat completion from any AI provider
 */
export async function getStreamingChatCompletion(
  provider,
  model,
  messages,
  onChunk,
  onComplete,
  onError,
  options = {}
) {
  const payload = {
    provider,
    model,
    messages,
    stream: true,
    parameters: options,
  };

  try {
    const response = await fetch(CHAT_COMPLETION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response?.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response?.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader?.read();
      if (done) break;

      buffer += decoder?.decode(value, { stream: true });
      const lines = buffer?.split('\n');
      buffer = lines?.pop() || '';

      for (const line of lines) {
        if (line?.startsWith('data: ')) {
          try {
            const data = JSON.parse(line?.slice(6));
            
            if (data?.type === 'chunk' && data?.chunk) {
              onChunk(data?.chunk);
            } else if (data?.type === 'done') {
              onComplete();
            } else if (data?.type === 'error') {
              console.error('Lambda Function Error:', {
                error: data?.error,
                details: data?.details,
              });
              onError(new Error(data.error));
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } catch (error) {
    console.error('Streaming error:', error);
    onError(error);
  }
}