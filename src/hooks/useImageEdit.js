import { useState, useCallback } from 'react';
import { editImage } from '../services/aiIntegrations/imageEdit';

/**
 * Hook for image editing - works with any provider
 * 
 * @param {string} provider - Provider identifier (e.g., 'OPEN_AI', 'GEMINI')
 * @param {string} model - Model name
 */
export function useImageEdit(provider, model) {
  const [image, setImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const edit = useCallback(
    async (sourceImage, prompt, options = {}) => {
      setImage(null);
      setIsLoading(true);
      setError(null);

      try {
        const result = await editImage(provider, model, sourceImage, prompt, options);
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

  return { image, isLoading, error, edit };
}
