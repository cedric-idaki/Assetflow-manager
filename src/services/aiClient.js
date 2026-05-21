import axios from 'axios';

/**
 * Generic Lambda function caller
 * Works with any Lambda endpoint and payload
 * 
 * @param {string} endpoint - Lambda endpoint URL
 * @param {object} payload - Request payload
 * @returns {Promise} Response from Lambda
 */
export async function callLambdaFunction(endpoint, payload) {
  try {
    const response = await axios?.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response?.data;
  } catch (error) {
    // Log for monitoring
    if (error?.response?.data?.error) {
      console.error('Lambda Function Error:', {
        error: error?.response?.data?.error,
        details: error?.response?.data?.details,
      });
      
      throw new Error(error.response.data.error);
    }
    
    console.error('Lambda function error:', error);
    throw error;
  }
}