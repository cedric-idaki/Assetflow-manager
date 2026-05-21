import { useState, useCallback } from 'react';
import { generateImage } from '../services/aiIntegrations/imageGeneration';

/**
 * Hook for image generation - works with any provider
 * 
 * @param {string} provider - Provider identifier (e.g., 'OPEN_AI', 'GEMINI')
 * @param {string} model - Model name
 */
export function useImageGeneration(provider, model) {
  const [image, setImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = useCallback(
    async (prompt, options = {}) => {
      setImage(null);
      setIsLoading(true);
      setError(null);

      try {
        const result = await generateImage(provider, model, prompt, options);
        setImage(result);
        return result;
      } catch (err) {
        setError(err);
      } finally {
        setIsLoading(false);
      }
    },
    [provider, model]
  );

  return { image, isLoading, error, generate };
}
