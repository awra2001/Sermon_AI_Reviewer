// OpenRouter Client for model-agnostic LLM access
const fetch = require('node-fetch');

class OpenRouterClient {
  constructor(apiKey, baseUrl = 'https://openrouter.ai/api/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://sermon-curation-system',
          'X-Title': 'Sermon Curation System'
        }
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Error fetching models from OpenRouter:', error);
      throw error;
    }
  }

  async createChatCompletion(model, messages, options = {}) {
    try {
      const payload = {
        model,
        messages,
        temperature: options.temperature || 0.3,
        max_tokens: options.max_tokens || 1500,
        ...options
      };

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://sermon-curation-system',
          'X-Title': 'Sermon Curation System'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error calling OpenRouter API:', error);
      throw error;
    }
  }

  // Helper function to determine if a model ID is an OpenAI model
  isOpenAIModel(model) {
    return model.startsWith('openai/') || 
           model.includes('gpt') || 
           model.startsWith('text-') || 
           model.startsWith('davinci');
  }

  // Helper function to determine if a model ID is a Claude model
  isClaudeModel(model) {
    return model.startsWith('anthropic/') || 
           model.includes('claude');
  }

  // Format model identifier for OpenRouter if needed
  formatModelId(modelId) {
    // If model already has a provider prefix (like anthropic/claude-3), return as is
    if (modelId.includes('/')) {
      return modelId;
    }

    // Add prefix based on model name
    if (modelId.includes('claude')) {
      return `anthropic/${modelId}`;
    } else if (modelId.includes('gpt') || modelId.includes('text-davinci')) {
      return `openai/${modelId}`;
    }

    // Return as is if we can't determine the provider
    return modelId;
  }
}

module.exports = OpenRouterClient;