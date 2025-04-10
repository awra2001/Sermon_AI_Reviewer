// Optimized Sermon Metadata Generator
// This script uses OpenAI's API, Claude API, or OpenRouter for model-agnostic LLM access

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const yaml = require('js-yaml');
const { OpenAI } = require('openai');
const { Anthropic } = require('@anthropic-ai/sdk');
const { DateTime } = require('luxon');
const { validateSermonYAML, updateFileWithYAML, updateFileWithRadarSection, generateSermonYAML } = require('./yaml-generator');
const OpenRouterClient = require('./openrouter-client');

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

// Initialize Claude client
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
}) : null;

// Initialize OpenRouter client if available
const openRouter = process.env.OPENROUTER_API_KEY ? 
  new OpenRouterClient(
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  ) : null;

// Define radar categories for consistent reference
const RADAR_CATEGORIES = [
  "theological_cohesion",
  "scriptural_integration", 
  "structural_clarity",
  "liturgical_harmony",
  "voice_fidelity",
  "emotional_presence",
  "metaphorical_resonance",
  "closing_force",
  "embodied_authority"
];

// Helper function to check if we should use OpenRouter
function shouldUseOpenRouter(options) {
  return options.useOpenRouter === true && openRouter !== null;
}

// Fetch available models from OpenRouter
async function listAvailableModels() {
  if (!openRouter) {
    console.error("OpenRouter API key not configured");
    return [];
  }
  
  try {
    const models = await openRouter.listModels();
    return models.map(model => ({
      id: model.id,
      name: model.name || model.id,
      provider: model.id.split('/')[0],
      context_length: model.context_length,
      pricing: model.pricing
    }));
  } catch (error) {
    console.error("Error fetching models:", error);
    return [];
  }
}

// Async function to call OpenAI API with a retry mechanism
async function callOpenAIWithRetry(messages, options = {}, maxRetries = 3) {
  let retries = 0;
  
  // Check if we should use OpenRouter
  if (shouldUseOpenRouter(options)) {
    console.log(`Using OpenRouter with model: ${options.model || process.env.OPENAI_MODEL || 'gpt-4'}`);
    
    try {
      const model = options.model || process.env.OPENAI_MODEL || 'gpt-4';
      const formattedModel = openRouter.formatModelId(model);
      
      const response = await openRouter.createChatCompletion(formattedModel, messages, {
        temperature: options.temperature || 0.3,
        max_tokens: options.max_tokens || 1500
      }); // Ensure this is closing a properly opened block
      
      return {
        choices: [{
          message: {
            content: response.choices[0].message.content
          }
        }]
      };
    } catch (error) {
      console.error('Error using OpenRouter:', error);
      throw error;
    }
  } else {
    // Use OpenAI directly
    if (!openai) {
      throw new Error("OpenAI API key not configured and OpenRouter not enabled");
    }
    
    while (true) {
      try {
        const response = await openai.chat.completions.create({
          ...options,
          messages,
        });
        return response;
      } catch (error) {
        if (error.code === 'rate_limit_exceeded' && retries < maxRetries) {
          const waitTime =
            parseInt(error.headers['retry-after-ms']) ||
            (parseInt(error.headers['retry-after']) * 1000) ||
            2000;
          console.warn(`Rate limit reached, waiting ${waitTime} ms before retrying...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          retries++;
        } else {
          throw error;
        }
      }
    }
  }
}

// Async function to call Claude API with a retry mechanism
async function callClaudeWithRetry(systemPrompt, userPrompt, options = {}, maxRetries = 5) {
  let retries = 0;
  
  // Check if we should use OpenRouter
  if (shouldUseOpenRouter(options)) {
    console.log(`Using OpenRouter with model: ${options.model || process.env.CLAUDE_MODEL || "claude-3-7-sonnet-20250219"}`);
    
    try {
      const model = options.model || process.env.CLAUDE_MODEL || "claude-3-7-sonnet-20250219";
      const formattedModel = openRouter.formatModelId(model);
      
      const response = await openRouter.createChatCompletion(formattedModel, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ], {
        temperature: options.temperature || 0.3,
        max_tokens: options.max_tokens || 1500
      });
      
      return {
        content: [{ text: response.choices[0].message.content }]
      };
    } catch (error) {
      console.error('Error using OpenRouter:', error);
      throw error;
    }
  } else {
    // Use Anthropic API directly
    if (!anthropic) {
      throw new Error("Anthropic API key not configured and OpenRouter not enabled");
    }
    
    while (true) {
      try {
        const response = await anthropic.messages.create({
          model: options.model || process.env.CLAUDE_MODEL || "claude-3-7-sonnet-20250219",
          system: systemPrompt,
          messages: [
            { role: "user", content: userPrompt }
          ],
          temperature: options.temperature || 0.3,
          max_tokens: options.max_tokens || 1500,
        });
        return response;
      } catch (error) {
        // Handle rate limiting (429)
        if (error.status === 429 && retries < maxRetries) {
          const waitTime = 2000 * Math.pow(2, retries); // Exponential backoff
          console.warn(`Rate limit reached, waiting ${waitTime} ms before retrying...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          retries++;
        } 
        // Handle server overload (529)
        else if (error.status === 529 && retries < maxRetries) {
          const waitTime = 5000 * Math.pow(2, retries); // Longer exponential backoff for overload
          console.warn(`Claude API is overloaded, waiting ${waitTime} ms before retrying (attempt ${retries + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          retries++;
        }
        // Handle other retryable errors (based on x-should-retry header)
        else if (error.headers && error.headers['x-should-retry'] === 'true' && retries < maxRetries) {
          const waitTime = 3000 * Math.pow(2, retries);
          console.warn(`Retryable error (${error.status}), waiting ${waitTime} ms before retrying...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          retries++;
        }
        else {
          if (retries >= maxRetries) {
            console.error(`Max retries (${maxRetries}) reached when calling Claude API.`);
          }
          throw error;
        }
      }
    }
  }
}

/**
 * Generate sermon metadata using LLM
 * @param {string} content - The full sermon text
 * @param {Object} existingMetadata - Any existing metadata to preserve
 * @param {Object} options - Options including model selection
 * @returns {Promise<Object>} - Generated metadata
 */
async function generateSermonMetadata(content, existingMetadata = {}, options = {}) {
  try {
    const systemPrompt = `
You are a sermon metadata analysis assistant. Your task is to analyze sermon manuscripts
and extract or generate key metadata, including:

1. Sermon title (if not provided)
2. Scripture texts referenced (formatted as "Book Chapter:Verse-Verse")
3. A concise "bolt" statement (1 sentence that captures the sermon's central message)
4. Themes (5-8 keywords)
5. Metaphors used (3-5 keywords)

Return ONLY a valid JSON object with these fields, structured exactly like this:
{
  "sermon_title": "Title of the Sermon",
  "texts": ["Scripture reference 1", "Scripture reference 2"],
  "bolt": "The central message of the sermon in one sentence",
  "themes": ["theme1", "theme2", "theme3", "theme4", "theme5"],
  "metaphors": ["metaphor1", "metaphor2", "metaphor3"]
}
`;

    const existingMetadataYaml = yaml.dump(existingMetadata);
    const userPrompt = `
Here is a sermon manuscript that needs metadata generation. Some metadata may already exist:

EXISTING METADATA:
\`\`\`yaml
${existingMetadataYaml}
\`\`\`

SERMON TEXT:
${content.slice(0, 15000)} // Limiting to first ~15000 chars for token limits

Please extract or generate the metadata fields. If specific fields already exist in the metadata,
preserve them unless you have strong evidence to change them. For new fields, generate appropriate values.

Return ONLY a valid JSON object with the metadata fields. Include sermon_title, texts (array), bolt, themes (array),
and metaphors (array).
`;

    let llmResponse;
    const useOpenRouterOptions = {
      useOpenRouter: options.useOpenRouter,
      model: options.model
    };
    
    // Check if the selected model is Claude
    const isClaudeModel = options.model && (
      options.model.includes('claude') || 
      options.model.startsWith('anthropic/')
    );
    
    if (isClaudeModel) {
      // Use Claude for metadata generation
      const response = await callClaudeWithRetry(
        systemPrompt,
        userPrompt,
        useOpenRouterOptions
      );
      llmResponse = response.content[0].text;
    } else {
      // Use OpenAI by default for metadata
      const response = await callOpenAIWithRetry(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        {
          model: options.model || "gpt-3.5-turbo",
          temperature: 0.3,
          max_tokens: 1000,
          ...useOpenRouterOptions
        }
      );
      llmResponse = response.choices[0].message.content;
    }

    let metadata;
    try {
      const jsonBlockMatch = llmResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        metadata = JSON.parse(jsonBlockMatch[1].trim());
      } else {
        const jsonMatch = llmResponse.match(/{[\s\S]*?}/);
        if (jsonMatch) {
          metadata = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found in response");
        }
      }
    } catch (error) {
      console.error("Failed to parse metadata JSON:", error.message);
      console.log("Raw LLM response:", llmResponse);
      return existingMetadata;
    }

    const mergedMetadata = {
      ...metadata,
      ...existingMetadata,
      bolt: metadata.bolt || existingMetadata.bolt,
      themes: metadata.themes || existingMetadata.themes,
      metaphors: metadata.metaphors || existingMetadata.metaphors,
      radar_score: {
        ...(existingMetadata.radar_score || {}),
        ...(metadata.radar_score || {})
      },
      // Preserve existing radar justifications if any
      radar_justifications: existingMetadata.radar_justifications || {}
    };
    
    return mergedMetadata;
  } catch (error) {
    console.error('Error generating metadata with LLM:', error);
    return existingMetadata;
  }
}

/**
 * Generate radar scores using LLM with structured format
 * @param {string} content - The full sermon text
 * @param {Object} existingMetadata - Any existing metadata
 * @param {Object} options - Options including model selection
 * @returns {Promise<Object>} - Radar scores and justifications
 */
async function generateRadarScores(content, existingMetadata = {}, options = {}) {
  try {
    const systemPrompt = `
You are a sermon evaluation assistant trained to assess manuscripts using elite homiletical and theological criteria.  The individual you are evaluating is an early mid-career PCUSA pastor.

He received his Theological education from Austin Theological Presbyterian Seminary, earning a 3.95 GPA, a full-ride fellowship to attend the school, and a fellowship at graduation recognizing his excellence in theology and ethics.

Your task is to provide radar scores across nine dimensions. You must grade with clarity and integrity. This scoring is used for voice refinement and elite-level preaching growth.

The scale is as follows:
- 10 = Elite mastery (1% of sermons achieve this)
- 7–9 = Strong, intentional, compelling
- 5 = Competent average (functional but not elevated)
- 3 = Weaknesses apparent, undeveloped
- 0–2 = Absent, incoherent, or theologically flawed

Do not inflate scores, as the point is for this pastor to grow and become the best he can be, not flattery.  
Only assign a 10 when the sermon achieves something extraordinary and the pastor legitimately has earned recognition as being among the top 1% of sermons.

You may receive additional instructions and context at the beginning of the manuscript. It will start with "NOTE TO AI REVIEWER:" Please leave a few sentences at the bottom to ensure you have read the notes and respond accordingly. Those suggestions can supersede this prompt.


Categories:

1. theological_cohesion – Does the sermon make a theological claim ("bolt") and sustain it across the sermon?
   - 10: Deep synthesis across Scripture, tradition, context.
   - 5: Concepts are there but unfocused.
   - 0: No claim, contradiction, or theological shallowness.

2. scriptural_integration – Does Scripture shape the sermon, not just decorate it?
   - 10: Text drives the sermon's arc, images, and theology.
   - 5: Text is referenced but secondary.
   - 0: Prooftexting, token reference, or absence.

3. structural_clarity – Does the sermon have intentional movement (spiral, arc, return)?
   - 10: Structure is elegant, clear, and moves the sermon.
   - 5: Linear but works.
   - 0: Disorganized or repetitive.

4. liturgical_harmony – Does the sermon reflect its season or liturgical context?
   - 10: Sermon feels inseparable from the liturgical moment.
   - 5: Gesture toward season, but not central.
   - 0: Liturgical mismatch or neglect.

5. voice_fidelity – Is the preacher's voice distinct, embodied, and theologically rooted?
   - 10: Voice is authentic, relaxed, and owned.
   - 5: Neutral or a bit unsure.
   - 0: Generic, performative, or incoherent.

6. emotional_presence – Does the sermon name and carry emotional weight?
   - 10: Emotion is sustained and transformed.
   - 5: Present but fleeting or surface-level.
   - 0: Avoidant, manipulative, or missing.

7. metaphorical_resonance – Do metaphors shape theology or sermon movement?
   - 10: Metaphors are layered, central, and returned to.
   - 5: Used, but not developed.
   - 0: Absent, clichéd, or unrelated.

8. closing_force – Does the sermon end with compression, resolve, or liturgical release?
   - 10: Ending is theologically charged and memorable.
   - 5: Clear but expected.
   - 0: Fades out or repeats prior ideas.

9. embodied_authority – Does the preacher’s voice, presence, and delivery carry the weight of the sermon’s theological and emotional arc?
	- 10: Voice and body fully integrated; proclamation is alive and present, whether manuscripted or extemporaneous
	- 5: Delivery is clear and sincere, but either overly safe or emotionally flat.
	- 0: Voice and presence are disengaged; sermon feels read, robotic, or disconnected from proclamation.

Guidelines:
- If unsure, or you believe more analysis is needed by the complementary agent (for instance, you do not have access to audio data, and being able to hear the manuscript would aid your evaluation), do not evaluate the domain.
- Do not replace categories with general traits like "clarity" or "relevance."
- Score based only on what is present in the manuscript.
- With each justification, provide feedback that would improve the score in the future.  At a minimum, your response should be 2-3 sentences.  However, if you believe more detail is valuable and warranted, you can add more.

IMPORTANT: Respond in EXACTLY this format with no other text:

SCORE theological_cohesion: [number]
JUSTIFICATION theological_cohesion: 

SCORE scriptural_integration: [number]
JUSTIFICATION scriptural_integration: 

And so on for all nine categories.

At the end, provide a paragraph with overall thoughts of the sermon, what you believe causes it to attain its level, and more generalized feedback.  End with a cumulative score, but not a grade.

When possible and available, utilize the link in the metadata to access the sermon audio recording. Take this into consideration when adjusting your score. 
Provide feedback regarding oratorical style, amplifications or distractions from the sermon and its manuscript, and recommendations for growth.
Append the changes and why to the end of your evaluation.  If you cannot access the audio, indicate that in the response.

`;
    const userPrompt = `
Here is a sermon manuscript that needs evaluation:

SERMON TITLE: ${existingMetadata.sermon_title || 'Untitled Sermon'}
${existingMetadata.texts ? `TEXTS: ${existingMetadata.texts.join(', ')}` : ''}

AUDIO LINK: ${existingMetadata.audio_link || 'Audio Link'}

SERMON TEXT:
${content.slice(0, 25000)} // Truncated to ~25000 characters

Please evaluate this sermon using the criteria described.
Respond ONLY in the specified format.
`;

    let llmResponse;
    const useOpenRouterOptions = {
      useOpenRouter: options.useOpenRouter,
      model: options.model
    };
    
    // Determine if we should use Claude-based model based on model name
    const isClaudeModel = options.model && (
      options.model.includes('claude') || 
      options.model.startsWith('anthropic/')
    );
    
    if (isClaudeModel || options.useClaude) {
      console.log("Using Claude (or Claude-like) model for radar score analysis...");
      const response = await callClaudeWithRetry(
        systemPrompt,
        userPrompt,
        {
          ...useOpenRouterOptions,
          model: options.model || process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20240620",
          temperature: 0.3,
          max_tokens: 1500,
        }
      );
      llmResponse = response.content[0].text;
    } else {
      console.log("Using OpenAI (or GPT-like) model for radar score analysis...");
      const response = await callOpenAIWithRetry(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        {
          ...useOpenRouterOptions,
          model: options.model || process.env.OPENAI_MODEL || "gpt-4",
          temperature: 0.3,
          max_tokens: 1500,
        }
      );
      llmResponse = response.choices[0].message.content;
    }

    const radar_score = {};
    const justifications = {};
    
    RADAR_CATEGORIES.forEach(category => {
      // Extract score
      const scorePattern = new RegExp(`SCORE ${category}:\\s*(\\d+(?:\\.\\d+)?)`, 'i');
      const scoreMatch = llmResponse.match(scorePattern);
      if (scoreMatch && scoreMatch[1]) {
        const score = parseFloat(scoreMatch[1]);
        if (!isNaN(score)) {
          radar_score[category] = score;
        }
      }
      
      // Extract justification
      const justPattern = new RegExp(`JUSTIFICATION ${category}:\\s*(.+?)(?=\\n\\s*SCORE|\\n\\s*JUSTIFICATION|$)`, 'is');
      const justMatch = llmResponse.match(justPattern);
      if (justMatch && justMatch[1]) {
        justifications[category] = justMatch[1].trim();
      }
    });
    
    // Fallback: ensure all domains are present
    RADAR_CATEGORIES.forEach(category => {
      if (radar_score[category] === undefined) {
        radar_score[category] = 0; // Default score (or you can choose another default)
        justifications[category] = "No evaluation provided.";
      }
    });
    
    return { radar_score, justifications };
  } catch (error) {
    console.error('Error generating radar scores with LLM:', error);
    return {
      radar_score: existingMetadata.radar_score || {},
      justifications: {}
    };
  }
}

/**
 * Process a single sermon file to generate or update metadata
 * @param {string} filePath - Path to sermon file
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processing result
 */
async function processSermonFile(filePath, options = {}) {
  const { 
    generateMissing = true, 
    updateExisting = false, 
    scoreOnly = false, 
    dryRun = false,
    useClaude = false,
    useOpenRouter = false,
    model = null,
    fallbackModel = false
  } = options;
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data: existingMetadata, content } = matter(fileContent);
    
    let needsFullMetadata = generateMissing && (
      !existingMetadata.sermon_title ||
      !existingMetadata.bolt ||
      !existingMetadata.themes ||
      (Array.isArray(existingMetadata.themes) && existingMetadata.themes.length === 0) ||
      !existingMetadata.metaphors ||
      (Array.isArray(existingMetadata.metaphors) && existingMetadata.metaphors.length === 0)
    );
    
    let needsRadarScores = (generateMissing || scoreOnly) && (
      !existingMetadata.radar_score ||
      Object.keys(existingMetadata.radar_score || {}).length === 0
    );
    
    if (updateExisting) {
      needsFullMetadata = !scoreOnly;
      needsRadarScores = true;
    }
    
    let newMetadata = { ...existingMetadata };
    let justifications = {};
    
    const metadataOptions = {
      useClaude,
      useOpenRouter,
      model: options.modelForMetadata
    };
    
    const radarOptions = {
      useClaude,
      useOpenRouter,
      model: options.modelForRadar
    };
    
    if (needsFullMetadata) {
      console.log(`Generating full metadata for ${filePath} using ${model || 'default model'}...`);
      newMetadata = await generateSermonMetadata(content, existingMetadata, metadataOptions);
    }
    
    if (needsRadarScores) {
      console.log(`Generating radar scores for ${filePath} using ${model || 'default model'}...`);
      
      try {
        const { radar_score, justifications: radarJustifications } = 
          await generateRadarScores(content, { ...existingMetadata, ...newMetadata }, radarOptions);
        newMetadata.radar_score = radar_score;
        justifications = radarJustifications;
      } catch (error) {
        // If fallback model is enabled, try with a fallback model
        if (fallbackModel && error.message) {
          console.warn(`Main model failed, trying fallback model...`);
          
          // Save original model
          const originalModel = options.model;
          
          // Determine fallback model based on the error
          let fallbackModelName;
          
          if (originalModel && originalModel.includes('claude-3-7')) {
            fallbackModelName = "claude-3-5-sonnet-20240620";
          } else if (originalModel && originalModel.includes('gpt-4')) {
            fallbackModelName = "gpt-3.5-turbo";
          } else {
            // Default fallbacks
            fallbackModelName = useClaude ? "claude-3-5-sonnet-20240620" : "gpt-3.5-turbo";
          }
          
          console.log(`Using fallback model: ${fallbackModelName}`);
          
          try {
            const { radar_score, justifications: radarJustifications } = 
              await generateRadarScores(content, { ...existingMetadata, ...newMetadata }, {
                ...llmOptions,
                model: fallbackModelName
              });
            newMetadata.radar_score = radar_score;
            justifications = radarJustifications;
            console.log("Successfully used fallback model.");
          } catch (fallbackError) {
            console.error("Fallback model also failed:", fallbackError.message);
            throw fallbackError;
          }
        } else {
          throw error;
        }
      }
    }
    
    const validation = validateSermonYAML(newMetadata);
    if (!validation.valid) {
      console.warn(`Warning: Generated metadata for ${filePath} is invalid:`, validation.errors);
    }
    
    if (!dryRun && (needsFullMetadata || needsRadarScores)) {
      const success = updateFileWithRadarSection(
        filePath, 
        newMetadata, 
        justifications, 
        options.modelForRadar || options.model || 'default model'
      );
      if (!success) {
        console.error(`Failed to update ${filePath}.`);
      } else {
        console.log(`Successfully updated ${filePath}.`);
      }
    }
    
    return {
      path: filePath,
      metadata: newMetadata,
      justifications,
      validation,
      updated: !dryRun && (needsFullMetadata || needsRadarScores)
    };
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    return { path: filePath, error: error.message, updated: false };
  }
}

/**
 * Process all sermon files in a directory
 * @param {string} directoryPath - Path to directory containing sermon files
 * @param {Object} options - Processing options
 * @returns {Promise<Object[]>} - Processing results
 */
async function processSermonDirectory(directoryPath, options = {}) {
  function findMarkdownFiles(dir) {
    const files = [];
    function traverseDirectory(currentPath) {
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const stats = fs.statSync(itemPath);
        if (stats.isDirectory()) {
          traverseDirectory(itemPath);
        } else if (stats.isFile() && item.endsWith('.md')) {
          files.push(itemPath);
        }
      }
    }
    traverseDirectory(dir);
    return files;
  }
  
  const files = findMarkdownFiles(directoryPath);
  console.log(`Found ${files.length} markdown files to process.`);
  const results = [];
  const batchSize = 5;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(files.length / batchSize)}...`);
    const batchResults = await Promise.all(batch.map(file => processSermonFile(file, options)));
    results.push(...batchResults);
    if (i + batchSize < files.length) {
      console.log('Waiting 10 seconds before next batch...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  return results;
}

/**
 * Pretty print justifications with scores
 * @param {Object} radar_score - Radar scores
 * @param {Object} justifications - Justifications
 * @param {string} modelName - Name of the model that generated the scores
 */
function printJustifications(radar_score, justifications, modelName = 'unknown') {
  // Get current date and time
  const timestamp = new Date().toISOString();
  
  console.log(`\nScore justifications [Model: ${modelName} | Generated: ${timestamp}]:`);
  console.log('----------------------------------------------------------------');
  
  RADAR_CATEGORIES.forEach(category => {
    if (radar_score[category] === undefined ||
        isNaN(radar_score[category]) ||
        radar_score[category] < 0 ||
        radar_score[category] > 10) {
      radar_score[category] = null;
      justifications[category] = "No evaluation provided.";
    }
    console.log(`- ${category}: ${radar_score[category]} - ${justifications[category]}`);
  });
  
  console.log('----------------------------------------------------------------');
}

/**
 * Compare two sets of radar scores
 * @param {Object} openaiScores - Radar scores from OpenAI
 * @param {Object} claudeScores - Radar scores from Claude 
 * @param {Object} options - Comparison options
 */
async function compareRadarScores(filePath, options = {}) {
  const { exportPath, modelOnly } = options;
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data: existingMetadata, content } = matter(fileContent);
    const filename = path.basename(filePath);
    
    // Get model names
    let model1 = options.model1 || process.env.OPENAI_MODEL || "gpt-4";
    let model2 = options.model2 || process.env.CLAUDE_MODEL || "claude-3-7-sonnet-20250219";
    
    console.log(`Analyzing sermon: ${filename}`);
    console.log(`Using model 1: ${model1}`);
    console.log(`Using model 2: ${model2}`);
    
    // First model analysis
    let model1Result = { radar_score: {}, justifications: {} };
    if (modelOnly !== 'model2') {
      console.log(`Generating radar scores with ${model1}...`);
      model1Result = await generateRadarScores(content, existingMetadata, { 
        useOpenRouter: options.useOpenRouter,
        model: model1
      });
    }
    
    // Second model analysis
    let model2Result = { radar_score: {}, justifications: {} };
    if (modelOnly !== 'model1') {
      console.log(`Generating radar scores with ${model2}...`);
      model2Result = await generateRadarScores(content, existingMetadata, { 
        useOpenRouter: options.useOpenRouter,
        model: model2
      });
    }
    
    // Comparison table
    if (modelOnly !== 'model1' && modelOnly !== 'model2') {
      console.log('\nComparison of radar scores:');
      console.log('|-----------------------|-----------|-----------|----------|-----------|');
      console.log('| Category              | Model 1   | Model 2   | Diff     | Agreement |');
      console.log('|-----------------------|-----------|-----------|----------|-----------|');
      
      let totalDiff = 0;
      let count = 0;
      const differences = [];
      const agreements = [];
      
      RADAR_CATEGORIES.forEach(category => {
        const score1 = model1Result.radar_score[category] || 0;
        const score2 = model2Result.radar_score[category] || 0;
        const diff = Math.abs(score1 - score2);
        
        // Calculate agreement percentage (within 1 point is considered similar)
        const agreement = diff <= 1 ? "High" : diff <= 2 ? "Medium" : "Low";
        differences.push(diff);
        agreements.push(agreement);
        totalDiff += diff;
        count++;
        
        console.log(`| ${category.padEnd(21)} | ${score1.toFixed(1).padEnd(9)} | ${score2.toFixed(1).padEnd(9)} | ${diff.toFixed(1).padEnd(8)} | ${agreement.padEnd(9)} |`);
      });
      
      // Calculate standard deviation of differences
      const avgDiff = totalDiff / count;
      const variance = differences.reduce((acc, diff) => acc + Math.pow(diff - avgDiff, 2), 0) / count;
      const stdDev = Math.sqrt(variance);
      
      // Calculate high agreement percentage
      const highAgreementCount = agreements.filter(a => a === "High").length;
      const highAgreementPercent = (highAgreementCount / count) * 100;
      
      console.log('|-----------------------|-----------|-----------|----------|-----------|');
      console.log(`| Average Difference    |           |           | ${avgDiff.toFixed(1).padEnd(8)} |           |`);
      console.log(`| Standard Deviation    |           |           | ${stdDev.toFixed(1).padEnd(8)} |           |`);
      console.log(`| High Agreement        |           |           |          | ${highAgreementPercent.toFixed(0)}%       |`);
      console.log('|-----------------------|-----------|-----------|----------|-----------|');
      
      // Radar chart statistics
      const radar = {
        model1: { sum: 0, avg: 0, min: 10, max: 0 },
        model2: { sum: 0, avg: 0, min: 10, max: 0 }
      };
      
      RADAR_CATEGORIES.forEach(category => {
        const score1 = model1Result.radar_score[category] || 0;
        const score2 = model2Result.radar_score[category] || 0;
        
        radar.model1.sum += score1;
        radar.model1.min = Math.min(radar.model1.min, score1);
        radar.model1.max = Math.max(radar.model1.max, score1);
        
        radar.model2.sum += score2;
        radar.model2.min = Math.min(radar.model2.min, score2);
        radar.model2.max = Math.max(radar.model2.max, score2);
      });
      
      radar.model1.avg = radar.model1.sum / count;
      radar.model2.avg = radar.model2.sum / count;
      
      console.log('\nOverall Statistics:');
      console.log('|----------------|-----------|-----------|');
      console.log('| Metric         | Model 1   | Model 2   |');
      console.log('|----------------|-----------|-----------|');
      console.log(`| Average Score  | ${radar.model1.avg.toFixed(1).padEnd(9)} | ${radar.model2.avg.toFixed(1).padEnd(9)} |`);
      console.log(`| Minimum Score  | ${radar.model1.min.toFixed(1).padEnd(9)} | ${radar.model2.min.toFixed(1).padEnd(9)} |`);
      console.log(`| Maximum Score  | ${radar.model1.max.toFixed(1).padEnd(9)} | ${radar.model2.max.toFixed(1).padEnd(9)} |`);
      console.log(`| Range          | ${(radar.model1.max - radar.model1.min).toFixed(1).padEnd(9)} | ${(radar.model2.max - radar.model2.min).toFixed(1).padEnd(9)} |`);
      console.log('|----------------|-----------|-----------|');
    }
    
    // Print model-specific results
    if (modelOnly === 'model1' || modelOnly === undefined) {
      console.log('\nModel 1 Justifications:');
      printJustifications(model1Result.radar_score, model1Result.justifications);
    }
    
    if (modelOnly === 'model2' || modelOnly === undefined) {
      console.log('\nModel 2 Justifications:');
      printJustifications(model2Result.radar_score, model2Result.justifications);
    }
    
    // Export results to JSON if requested
    if (exportPath) {
      const exportData = {
        sermon: filename,
        metadata: existingMetadata,
        date: new Date().toISOString(),
        models: {
          model1,
          model2
        },
        results: {
          model1: {
            scores: model1Result.radar_score,
            justifications: model1Result.justifications
          },
          model2: {
            scores: model2Result.radar_score,
            justifications: model2Result.justifications
          }
        }
      };
      
      // Create export directory if it doesn't exist
      const exportDir = path.dirname(exportPath);
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      
      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
      console.log(`\nComparison data exported to: ${exportPath}`);
    }
    
    return {
      model1: model1Result,
      model2: model2Result
    };
  } catch (error) {
    console.error(`Error comparing radar scores for ${filePath}:`, error);
    return { error: error.message };
  }
}

/**
 * Main CLI function
 */
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  
  // Check if we're using OpenRouter
  const useOpenRouter = args.includes('--use-openrouter');
  
  // If using OpenRouter, we need the API key
  if (useOpenRouter && !process.env.OPENROUTER_API_KEY) {
    console.error('Error: OPENROUTER_API_KEY environment variable is not set but --use-openrouter flag is present.');
    process.exit(1);
  }
  
  // If not using OpenRouter, check if we have the required API keys
  if (!useOpenRouter) {
    const useClaude = args.includes('--use-claude');
    
    if (!process.env.OPENAI_API_KEY && !useClaude) {
      console.error('Error: OPENAI_API_KEY environment variable is not set.');
      process.exit(1);
    }
    
    if (useClaude && !process.env.ANTHROPIC_API_KEY) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is not set but --use-claude flag is present.');
      process.exit(1);
    }
  }
  
  // Extract model parameter if present
  let model = null;
  const modelIndex = args.indexOf('--model');
  if (modelIndex !== -1 && args.length > modelIndex + 1) {
    model = args[modelIndex + 1];
  }
  
  switch (cmd) {
    case 'list-models': {
      if (!useOpenRouter) {
        console.error('Error: --use-openrouter flag is required to list models.');
        process.exit(1);
      }
      
      try {
        console.log('Fetching available models from OpenRouter...');
        const models = await listAvailableModels();
        
        if (models.length === 0) {
          console.log('No models found or error occurred fetching models.');
          process.exit(1);
        }

        console.log('|--------------------------------------------------------------|----------------|----------------------|------------------------|------------------------|---------------------------|');
        console.log('| Model ID                                                     | Context Size   | Pricing: prompt      | Pricing: completion    | Pricing: image         | Per Request Limits        |');
        console.log('|--------------------------------------------------------------|----------------|----------------------|------------------------|------------------------|---------------------------|');
        
        models.forEach(model => {
          const modelId = model.id.padEnd(60);
          const contextSize = (model.context_length !== undefined ? model.context_length.toString() : 'unknown').padEnd(14);
          
          let pricingPrompt, pricingCompletion, pricingImage;
          if (model.pricing && typeof model.pricing === 'object') {
            // Try to get a numeric value for prompt
            let promptVal = parseFloat(model.pricing.prompt);
            if (!isNaN(promptVal)) {
              pricingPrompt = `$${promptVal.toFixed(6)}`;
            } else {
              let inputVal = parseFloat(model.pricing.input);
              if (!isNaN(inputVal)) {
                pricingPrompt = `$${inputVal.toFixed(6)}`;
              } else {
                pricingPrompt = null;
              }
            }
            
            // Try to get a numeric value for completion
            let completionVal = parseFloat(model.pricing.completion);
            if (!isNaN(completionVal)) {
              pricingCompletion = `$${completionVal.toFixed(6)}`;
            } else {
              let outputVal = parseFloat(model.pricing.output);
              if (!isNaN(outputVal)) {
                pricingCompletion = `$${outputVal.toFixed(6)}`;
              } else {
                pricingCompletion = null;
              }
            }
            
            // Try to get a numeric value for image
            let imageVal = parseFloat(model.pricing.image);
            if (!isNaN(imageVal)) {
              pricingImage = `$${imageVal.toFixed(6)}`;
            } else {
              pricingImage = null;
            }
            
            // Fallback: if any pricing value is still null, concatenate all pricing entries
            if (!pricingPrompt || !pricingCompletion || !pricingImage) {
              const pricingEntries = Object.entries(model.pricing).map(([key, value]) => `${key}:${value}`);
              const fallbackPricing = pricingEntries.join(', ');
              pricingPrompt = pricingPrompt || fallbackPricing || 'unknown';
              pricingCompletion = pricingCompletion || fallbackPricing || 'unknown';
              pricingImage = pricingImage || fallbackPricing || 'unknown';
            }
          } else {
            pricingPrompt = 'unknown';
            pricingCompletion = 'unknown';
            pricingImage = 'unknown';
          }
          pricingPrompt = pricingPrompt.padEnd(20);
          pricingCompletion = pricingCompletion.padEnd(22);
          pricingImage = pricingImage.padEnd(22);
          
          let perRequestLimits;
          if (model.per_request_limits && typeof model.per_request_limits === 'object') {
            const prlEntries = Object.entries(model.per_request_limits).map(([key, value]) => `${key}:${value}`);
            perRequestLimits = prlEntries.join(', ');
            if (perRequestLimits.length > 25) perRequestLimits = perRequestLimits.substring(0,22) + '...';
            perRequestLimits = perRequestLimits.padEnd(25);
          } else {
            perRequestLimits = 'n/a'.padEnd(25);
          }
          
          console.log(`| ${modelId} | ${contextSize} | ${pricingPrompt} | ${pricingCompletion} | ${pricingImage} | ${perRequestLimits} |`);
        });
        
        console.log('|--------------------------------------------------------------|----------------|----------------------|------------------------|------------------------|---------------------------|');
      } catch (error) {
        console.error('Error listing models:', error);
        process.exit(1);
      }
      break;
    }
    
    case 'generate': {
      // Extract model parameters for metadata and radar separately
      let modelForMetadata = null;
      let modelForRadar = null;
      
      const metadataModelIndex = args.indexOf('--metadata-model');
      if (metadataModelIndex !== -1 && args.length > metadataModelIndex + 1) {
        modelForMetadata = args[metadataModelIndex + 1];
      }
      
      const radarModelIndex = args.indexOf('--radar-model');
      if (radarModelIndex !== -1 && args.length > radarModelIndex + 1) {
        modelForRadar = args[radarModelIndex + 1];
      }
      
      // Filter out the file path - exclude all model identifiers and flags
      const excludedIndices = new Set();
      
      // Mark indices to exclude for --model flag
      if (modelIndex !== -1 && args.length > modelIndex + 1) {
        excludedIndices.add(modelIndex);
        excludedIndices.add(modelIndex + 1);
      }
      
      // Mark indices to exclude for --metadata-model flag
      if (metadataModelIndex !== -1 && args.length > metadataModelIndex + 1) {
        excludedIndices.add(metadataModelIndex);
        excludedIndices.add(metadataModelIndex + 1);
      }
      
      // Mark indices to exclude for --radar-model flag
      if (radarModelIndex !== -1 && args.length > radarModelIndex + 1) {
        excludedIndices.add(radarModelIndex);
        excludedIndices.add(radarModelIndex + 1);
      }
      
      // Get the file path - the first arg that's not a flag or model identifier
      const filePath = args.find((arg, index) => 
        !arg.startsWith('--') && !excludedIndices.has(index)
      );
      
      if (!filePath) {
        console.error('Error: File path is required.');
        process.exit(1);
      }
      
      const options = {
        generateMissing: true,
        updateExisting: args.includes('--update'),
        scoreOnly: args.includes('--score-only'),
        dryRun: args.includes('--dry-run'),
        useClaude: args.includes('--use-claude'),
        useOpenRouter,
        // Use the specific models if provided, otherwise fall back to the general model
        modelForMetadata: modelForMetadata || model,
        modelForRadar: modelForRadar || model
      };
      
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          const results = await processSermonDirectory(filePath, options);
          const successful = results.filter(r => !r.error);
          const failed = results.filter(r => r.error);
          const updated = results.filter(r => r.updated);
          console.log('\nProcessing complete!');
          console.log(`Total files: ${results.length}`);
          console.log(`Successfully processed: ${successful.length}`);
          console.log(`Failed: ${failed.length}`);
          console.log(`Updated: ${updated.length}`);
          if (failed.length > 0) {
            console.log('\nFailed files:');
            failed.forEach(r => console.log(`- ${r.path}: ${r.error}`));
          }
        } else {
          const result = await processSermonFile(filePath, options);
          console.log('\nProcessing complete!');
          if (result.error) {
            console.error(`Error: ${result.error}`);
          } else {
            console.log('Generated metadata:');
            console.log(yaml.dump(result.metadata));
            if (Object.keys(result.justifications).length > 0) {
              printJustifications(
                result.metadata.radar_score,
                result.justifications,
                options.modelForRadar || options.model || 'default model'
              );
            }
            if (result.updated) {
              console.log('\nFile updated successfully.');
            } else if (options.dryRun) {
              console.log('\nDry run - file not updated.');
            } else {
              console.log('\nNo updates needed.');
            }
          }
        }
      } catch (error) {
        console.error('Error:', error);
        process.exit(1);
      }
      break;
    }
    
    case 'analyze': {
      let filePath = null;
      for (let i = 0; i < args.length; i++) {
        if (!args[i].startsWith('--')) {
          filePath = args[i];
          break;
        } else {
          // Skip flag and its associated value (if any)
          if (i < args.length - 1 && !args[i+1].startsWith('--')) {
            i++;
          }
        }
      }
if (!filePath) {
  console.error('Error: No file path provided.');
  process.exit(1);
}
      
      if (!filePath) {
        console.error('Error: File path is required.');
        process.exit(1);
      }
      
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const { data: existingMetadata, content } = matter(fileContent);
        
        console.log(`Analyzing sermon using ${model || 'default model'}...`);
        
        const llmOptions = {
          useClaude: args.includes('--use-claude'),
          useOpenRouter,
          model
        };
        
        const metadata = await generateSermonMetadata(content, existingMetadata, llmOptions);
        const { radar_score, justifications } = await generateRadarScores(content, metadata, llmOptions);
        
        metadata.radar_score = radar_score;
        metadata.radar_justifications = justifications;
        
        console.log('\nAnalysis complete!');
        console.log('\nGenerated metadata:');
        console.log(yaml.dump(metadata));
        printJustifications(radar_score, justifications);
      } catch (error) {
        console.error('Error:', error);
        process.exit(1);
      }
      break;
    }
    
    case 'compare': {
      const [filePath] = args.filter(arg => 
        !arg.startsWith('--') && 
        arg !== args[modelIndex] && 
        arg !== args[modelIndex + 1]
      );
      
      if (!filePath) {
        console.error('Error: File path is required.');
        process.exit(1);
      }
      
      // Extract model1 and model2 if specified
      let model1 = null;
      let model2 = null;
      
      const model1Index = args.indexOf('--model1');
      if (model1Index !== -1 && args.length > model1Index + 1) {
        model1 = args[model1Index + 1];
      }
      
      const model2Index = args.indexOf('--model2');
      if (model2Index !== -1 && args.length > model2Index + 1) {
        model2 = args[model2Index + 1];
      }
      
      // If using OpenRouter, we don't need API keys
      if (!useOpenRouter) {
        // If not using OpenRouter but using OpenAI, we need the API key
        if (!model1 || !model1.includes('claude')) {
          if (!process.env.OPENAI_API_KEY) {
            console.error('Error: OPENAI_API_KEY environment variable is not set but required for comparison.');
            process.exit(1);
          }
        }
        
        // If not using OpenRouter but using Claude, we need the API key
        if (!model2 || model2.includes('claude')) {
          if (!process.env.ANTHROPIC_API_KEY) {
            console.error('Error: ANTHROPIC_API_KEY environment variable is not set but required for comparison.');
            process.exit(1);
          }
        }
      }
      
      const options = {
        useOpenRouter,
        model1,
        model2,
        exportPath: args.includes('--export') ? 
          args[args.indexOf('--export') + 1] || `./comparison_${new Date().toISOString().slice(0,10)}.json` : 
          null,
        modelOnly: args.includes('--model1-only') ? 'model1' : 
                  args.includes('--model2-only') ? 'model2' : 
                  null
      };
      
      try {
        await compareRadarScores(filePath, options);
      } catch (error) {
        console.error('Error:', error);
        process.exit(1);
      }
      break;
    }
    
    default:
      console.log(`
Usage:
  node llm-metadata-generator.js list-models --use-openrouter    - List all available models from OpenRouter
  node llm-metadata-generator.js generate <file-or-directory> [options]  - Generate metadata for sermon file(s)
  node llm-metadata-generator.js analyze <file> [options]                - Analyze sermon without saving
  node llm-metadata-generator.js compare <file> [options]                - Compare two models' radar scores

Options for all commands:
  --use-openrouter        Use OpenRouter for model access (requires OPENROUTER_API_KEY)
  --model <model-id>      Specify the model to use (e.g., 'gpt-4', 'claude-3-7-sonnet-20250219', or OpenRouter model ID)

Options for generate command:
  --metadata-model <model-id>  Specify the model to use for metadata generation
  --radar-model <model-id>     Specify the model to use for radar scores generation
  --update                     Update all metadata fields, even if they exist
  --score-only                 Only generate or update radar scores
  --dry-run                    Don't actually write changes to files
  --use-claude                 Use Claude API for radar score generation (requires ANTHROPIC_API_KEY, ignored if --use-openrouter is set)
  --allow-fallback             Try using a fallback model if the primary model fails

Options for analyze:
  --update                Update all metadata fields, even if they exist
  --score-only            Only generate or update radar scores
  --dry-run               Don't actually write changes to files
  --use-claude            Use Claude API for radar score generation (requires ANTHROPIC_API_KEY, ignored if --use-openrouter is set)
  --allow-fallback        Try using a fallback model if the primary model fails

Options for compare:
  --model1 <model-id>     Specify the first model to use in comparison
  --model2 <model-id>     Specify the second model to use in comparison
  --export [path]         Export comparison results to JSON file (defaults to ./comparison_DATE.json)
  --model1-only           Only run analysis with the first model
  --model2-only           Only run analysis with the second model
      `);
  }
}

// If running directly
if (require.main === module) {
  main().catch(console.error);
}

// Export modules
module.exports = {
  generateSermonMetadata,
  generateRadarScores,
  processSermonFile,
  processSermonDirectory,
  compareRadarScores,
  listAvailableModels
};
