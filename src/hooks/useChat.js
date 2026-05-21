import { useState, useCallback } from 'react';
import { getChatCompletion, getStreamingChatCompletion } from '../services/aiIntegrations/chatCompletion';

/**
 * Unified chat hook - works with any provider
 * 
 * @param {string} provider - Provider identifier (e.g., 'ANTHROPIC', 'OPENAI')
 * @param {string} model - Model name
 * @param {boolean} streaming - Enable streaming mode
 * 
 * @returns {object} { response, fullResponse, isLoading, error, sendMessage }
 * - response: Extracted content string (for simple use cases)
 * - fullResponse: Full SDK response - array of chunks (streaming) or response object (non-streaming)
 */
export function useChat(provider, model, streaming = true) {
  const [response, setResponse] = useState('');
  const [fullResponse, setFullResponse] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const sendMessage = useCallback(
    async (messages, options = {}) => {
      setResponse('');
      setFullResponse(streaming ? [] : null);
      setIsLoading(true);
      setError(null);

      try {
        if (streaming) {
          await getStreamingChatCompletion(
            provider,
            model,
            messages,
            (chunk) => {
              // Store full chunk for advanced use cases
              setFullResponse(prev => [...prev, chunk]);
              // Extract content for simple use cases
              const content = chunk?.choices?.[0]?.delta?.content;
              if (content) {
                setResponse(prev => prev + content);
              }
            },
            () => setIsLoading(false),
            (err) => {
              setError(err);
              setIsLoading(false);
            },
            options
          );
        } else {
          const result = await getChatCompletion(provider, model, messages, options);
          // Store full response for advanced use cases
          setFullResponse(result);
          // Extract content for simple use cases
          const content = result?.choices?.[0]?.message?.content || '';
          setResponse(content);
          setIsLoading(false);
        }
      } catch (err) {
        setError(err);
        setIsLoading(false);
      }
    },
    [provider, model, streaming]
  );

  return { response, fullResponse, isLoading, error, sendMessage };
}