// Enhanced YAML Generator and Validator for Sermon Metadata
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const matter = require('gray-matter');
const { DateTime } = require('luxon');

/**
 * Generate YAML frontmatter for a sermon
 * @param {Object} sermonData - Partial sermon data to include
 * @returns {Object} - Complete sermon YAML object
 */
function generateSermonYAML(sermonData = {}) {
  // Default radar scores
  const defaultRadarScore = {
    theological_cohesion: 0,
    scriptural_integration: 0,
    structural_clarity: 0,
    liturgical_harmony: 0,
    voice_fidelity: 0,
    emotional_presence: 0,
    metaphorical_resonance: 0,
    closing_force: 0,
    improvisational_trust: 0
  };

  // Get current date if not provided
  const preachedOn = sermonData.preached_on || DateTime.now().toISODate();
  
  // Create complete sermon object with defaults for missing fields
  const completeSermon = {
    sermon_title: sermonData.sermon_title || 'Untitled Sermon',
    preached_on: preachedOn,
    texts: sermonData.texts || [],
    bolt: sermonData.bolt || '',
    themes: sermonData.themes || [],
    metaphors: sermonData.metaphors || [],
    radar_score: { ...defaultRadarScore, ...(sermonData.radar_score || {}) },
    audio_url: sermonData.audio_url || '',
    manuscript_path: sermonData.manuscript_path || generateManuscriptPath(preachedOn)
  };
  
  // Optionally include radar justifications if provided
  if (sermonData.radar_justifications) {
    completeSermon.radar_justifications = sermonData.radar_justifications;
  }
  
  return completeSermon;
}

/**
 * Generate manuscript path based on date
 * @param {string} dateStr - ISO date string
 * @returns {string} - Path to store manuscript
 */
function generateManuscriptPath(dateStr) {
  const date = DateTime.fromISO(dateStr);
  const year = date.year;
  const month = date.month.toString().padStart(2, '0');
  const day = date.day.toString().padStart(2, '0');
  
  return `/${year}/Sermon ${month}.${day}.${year.toString().slice(-2)}.md`;
}

/**
 * Validate sermon YAML against schema
 * @param {Object} sermonYAML - Sermon YAML object to validate
 * @returns {Object} - Validation result { valid: boolean, errors: string[] }
 */
function validateSermonYAML(sermonYAML) {
  const errors = [];
  
  // Required fields (here only sermon_title is required)
  const requiredFields = ['sermon_title'];
  for (const field of requiredFields) {
    if (!sermonYAML[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Radar score validation (if present)
  if (sermonYAML.radar_score) {
    const scoreFields = [
      'theological_cohesion', 'scriptural_integration', 'structural_clarity',
      'liturgical_harmony', 'voice_fidelity', 'emotional_presence',
      'metaphorical_resonance', 'closing_force', 'improvisational_trust'
    ];
    for (const field of scoreFields) {
      const score = sermonYAML.radar_score[field];
      if (score !== undefined) {
        if (typeof score !== 'number' || score < 0 || score > 10) {
          errors.push(`Invalid radar score for ${field}. Must be a number between 0 and 10.`);
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Extract or create YAML frontmatter from a markdown file
 * @param {string} filePath - Path to markdown file
 * @returns {Object} - Extracted YAML data
 */
function extractYAMLFromFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data } = matter(fileContent);
    return data;
  } catch (error) {
    console.error(`Error extracting YAML from ${filePath}:`, error);
    return {};
  }
}

/**
 * Process all sermon files in a directory
 * @param {string} directoryPath - Path to directory containing sermon files
 * @returns {Object[]} - Array of processed sermon data
 */
function processSermonDirectory(directoryPath) {
  const sermons = [];
  const markdownFiles = findMarkdownFiles(directoryPath);
  
  for (const filePath of markdownFiles) {
    try {
      const yamlData = extractYAMLFromFile(filePath);
      const validation = validateSermonYAML(yamlData);
      
      if (!validation.valid && !yamlData.sermon_title) {
        const filename = path.basename(filePath, '.md');
        yamlData.sermon_title = filename.replace(/Sermon \d{2}\.\d{2}\.\d{2}/, '').trim() || 'Untitled';
      }
      
      yamlData.manuscript_path = path.relative(directoryPath, filePath);
      
      sermons.push({
        path: filePath,
        data: yamlData,
        validation
      });
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  return sermons;
}

/**
 * Recursively find all markdown files in a directory
 * @param {string} directoryPath - Directory to search
 * @returns {string[]} - Array of file paths
 */
function findMarkdownFiles(directoryPath) {
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
  
  traverseDirectory(directoryPath);
  return files;
}

/**
 * Update a markdown file with new YAML frontmatter
 * @param {string} filePath - Path to markdown file
 * @param {Object} yamlData - YAML data to insert/update
 * @returns {boolean} - Success status
 */
function updateFileWithYAML(filePath, yamlData) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { content } = matter(fileContent);
    const newContent = `---\n${yaml.dump(yamlData)}---\n\n${content.trim()}`;
    fs.writeFileSync(filePath, newContent);
    return true;
  } catch (error) {
    console.error(`Error updating ${filePath}:`, error);
    return false;
  }
}

/**
 * Update a markdown file with a radar analysis section.
 * This function removes any existing "## Radar Analysis" section from the content,
 * then appends a new section based on the provided radar scores and justifications.
 * @param {string} filePath - Path to markdown file
 * @param {Object} yamlData - YAML data to insert/update (should include radar_score)
 * @param {Object} justifications - Radar justifications for each category
 * @param {string} modelName - Name of the model that generated the scores
 * @returns {boolean} - Success status
 */
function updateFileWithRadarSection(filePath, yamlData, justifications, modelName = 'unknown') {
  try {
    // Read original content using gray-matter
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(fileContent);
    let contentWithoutRadar = parsed.content;

    // Remove any existing "## Radar Analysis" section.
    // This regex matches from a line starting with "## Radar Analysis" until the next level 1 heading (#) or end of file.
    contentWithoutRadar = contentWithoutRadar.replace(/(^## Radar Analysis[\s\S]*?)(?=^# |\n*$)/m, '');

    // Get current date and time for the timestamp
    const timestamp = new Date().toISOString();
    
    // Create the radar analysis section with model info and timestamp
    let radarSection = '## Radar Analysis\n';
    radarSection += `_Generated by model: ${modelName} | ${timestamp}_\n\n`;
    
    const categories = [
      'theological_cohesion',
      'scriptural_integration',
      'structural_clarity',
      'liturgical_harmony',
      'voice_fidelity',
      'emotional_presence',
      'metaphorical_resonance',
      'closing_force',
      'improvisational_trust'
    ];
    categories.forEach(category => {
      if (yamlData.radar_score && yamlData.radar_score[category] !== undefined) {
        const score = yamlData.radar_score[category];
        const justification = justifications[category] || '';
        const formattedName = category.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        radarSection += `- **${formattedName} (${score}/10)**: ${justification}\n`;
      }
    });
    radarSection += '\n';

    // Add model info to the YAML data
    yamlData.radar_info = `Model: ${modelName} | Generated: ${timestamp}`;
    
    // Remove radar_justifications from the YAML data before dumping
    const { radar_justifications, ...yamlWithoutJustifications } = yamlData;
    const newYaml = yaml.dump(yamlWithoutJustifications);
    
    // Assemble the new file content: YAML frontmatter, then the radar section, then the remaining content.
    const newContent = `---\n${newYaml}---\n\n${radarSection}${contentWithoutRadar.trim()}`;
    fs.writeFileSync(filePath, newContent);
    return true;
  } catch (error) {
    console.error(`Error updating ${filePath} with radar section:`, error);
    return false;
  }
}

module.exports = {
  generateSermonYAML,
  validateSermonYAML,
  extractYAMLFromFile,
  processSermonDirectory,
  updateFileWithYAML,
  updateFileWithRadarSection
};

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  
  switch (cmd) {
    case 'validate': {
      const [dirPath] = args;
      const sermons = processSermonDirectory(dirPath || '.');
      console.log(`\nProcessed ${sermons.length} sermon files:`);
      const validCount = sermons.filter(s => s.validation.valid).length;
      console.log(`✅ Valid: ${validCount}`);
      console.log(`❌ Invalid: ${sermons.length - validCount}`);
      const invalid = sermons.filter(s => !s.validation.valid);
      if (invalid.length > 0) {
        console.log('\nInvalid sermons:');
        for (const sermon of invalid) {
          console.log(`- ${sermon.path}`);
          for (const error of sermon.validation.errors) {
            console.log(`  - ${error}`);
          }
        }
      }
      break;
    }
    case 'generate': {
      const template = generateSermonYAML();
      console.log(yaml.dump(template));
      break;
    }
    case 'fix': {
      const [dirPath] = args;
      const sermons = processSermonDirectory(dirPath || '.');
      const invalid = sermons.filter(s => !s.validation.valid);
      if (invalid.length === 0) {
        console.log('No invalid sermons found.');
        break;
      }
      console.log(`\nAttempting to fix ${invalid.length} invalid sermons:`);
      let fixedCount = 0;
      for (const sermon of invalid) {
        const fixed = generateSermonYAML(sermon.data);
        const success = updateFileWithYAML(sermon.path, fixed);
        if (success) {
          fixedCount++;
          console.log(`✅ Fixed: ${sermon.path}`);
        } else {
          console.log(`❌ Failed to fix: ${sermon.path}`);
        }
      }
      console.log(`\nFixed ${fixedCount} out of ${invalid.length} invalid sermons.`);
      break;
    }
    default:
      console.log(`
YAML Generator and Validator for Sermon Metadata

Usage:
  node yaml-generator.js validate [directory]  - Validate all sermon files in directory
  node yaml-generator.js generate              - Generate YAML template
  node yaml-generator.js fix [directory]       - Attempt to fix invalid sermon files
      `);
  }
}