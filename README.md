# Sermon Metadata Generator

A Node.js tool for automatically generating metadata for sermon manuscripts using LLMs (Large Language Models). This tool can analyze sermon content and generate structured metadata including themes, metaphors, key scripture references, and detailed "radar" evaluations of sermon quality across multiple dimensions.

## Changes in V2:
- Actually uploaded the llm-metadata-generator.js, the most critical code for the whole thing.
- Reworked the final domain, moving it from "improvisational_trust" to "embodied_authority".
- Added an ability to have the llm read a link to a podcast feed.  If you're using Obsidian/Markdown, place it in front matter YAML under "audio_link".

## Features

- Generate comprehensive metadata for sermon manuscripts
- Evaluate sermons across 9 homiletical dimensions with "radar" scores
- Support for multiple LLM providers (OpenAI, Claude, or any model via OpenRouter)
- Batch processing for multiple sermon files
- Markdown compatibility for seamless integration with Obsidian and other note-taking tools
- Model-specific labeling with timestamps for tracking evaluations over time

## Prerequisites

- This is used through Obsidian, although you could use just a plain file structure, so long as your files are .md
- Node.js (v14 or higher)
- An API key for at least one of:
  - OpenAI API (for GPT models) - [Get API key](https://platform.openai.com/)
  - Anthropic API (for Claude models) - [Get API key](https://console.anthropic.com/)
  - OpenRouter API (for access to multiple models) - [Get API key](https://openrouter.ai/)
- npm packages:
  - dotenv
  - fs (built-in)
  - path (built-in)
  - gray-matter
  - js-yaml
  - @anthropic-ai/sdk
  - openai
  - luxon

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/awra2001/sermon-metadata-generator.git
   cd sermon-metadata-generator
   ```

2. Install dependencies:
   ```bash
   npm install dotenv fs path matter js-yaml @anthropic-ai/sdk openai luxon
   ```

3. Create a `.env` file in the project root with your API keys (I've included a .env.example file that should allow you to use any of the sites below.  You'll just need the API.  I'd recommend OpenRouter, as it allows you to use multiple models.  I don't free models do just as good with metadata tagging so far in testing):
   ```
   # You'll need to obtain your own API keys from one or more of these services:
   # - OpenAI: https://platform.openai.com/
   # - Anthropic: https://console.anthropic.com/ 
   # - OpenRouter: https://openrouter.ai/
   
   # Choose one or more of these options
   OPENAI_API_KEY=your_openai_api_key
   ANTHROPIC_API_KEY=your_anthropic_api_key
   OPENROUTER_API_KEY=your_openrouter_api_key
   
   # Optional: Set default models
   OPENAI_MODEL=gpt-4
   CLAUDE_MODEL=claude-3-7-sonnet-20250219
   ```

## Setting Up With Obsidian

1. Create a new folder in your Obsidian vault (e.g., "tools") where you'll store this tool
2. Clone this repository into that folder or copy the files there
3. Make sure your sermon files are Markdown (.md) files with standard frontmatter YAML format
4. You can run the tool directly from your vault's tools directory

## Usage

### Basic Usage

Generate metadata for a single sermon file:

```bash
node llm-metadata-generator.js generate "/path/to/your/sermon.md"
```

Generate metadata for all sermons in a directory:

```bash
node llm-metadata-generator.js generate "/path/to/your/sermons"
```

### Using Different Models

You can specify which models to use for different parts of the process:

```bash
# Use a single model for everything
node llm-metadata-generator.js generate "/path/to/your/sermon.md" --model gpt-4

# Use different models for metadata and radar score generation
node llm-metadata-generator.js generate "/path/to/your/sermon.md" --metadata-model gpt-4 --radar-model claude-3-7-sonnet-20250219

# Use OpenRouter to access models from different providers
node llm-metadata-generator.js generate "/path/to/your/sermon.md" --use-openrouter --metadata-model meta-llama/llama-3-70b-instruct --radar-model anthropic/claude-3-5-sonnet
```

### Listing Available Models (with OpenRouter)

```bash
node llm-metadata-generator.js list-models --use-openrouter
```

### Advanced Options

```bash
# Only generate radar scores (preserve existing metadata)
node llm-metadata-generator.js generate "/path/to/your/sermon.md" --score-only

# Update all metadata even if it exists
node llm-metadata-generator.js generate "/path/to/your/sermon.md" --update

# Preview changes without writing to files
node llm-metadata-generator.js generate "/path/to/your/sermon.md" --dry-run

# Compare radar scores from two different models
node llm-metadata-generator.js compare "/path/to/your/sermon.md" --model1 "gpt-4" --model2 "claude-3-7-sonnet-20250219"
```

## Sermon File Format

This tool works with Markdown files that have YAML frontmatter. Here's an example of the expected format:

```markdown
---
sermon_title: "The Good Shepherd"
preached_on: "2025-03-23"
texts: ["John 10:1-18", "Psalm 23"]
bolt: "Jesus is the Good Shepherd who lays down his life for his sheep."
themes: ["salvation", "sacrifice", "protection", "identity", "belonging"]
metaphors: ["shepherd", "door", "thief", "wolf"]
radar_info: "Model: gpt-4 | Generated: 2025-03-27T12:34:56.789Z"
radar_score:
  theological_cohesion: 8
  scriptural_integration: 9
  structural_clarity: 7
  liturgical_harmony: 6
  voice_fidelity: 8
  emotional_presence: 7
  metaphorical_resonance: 9
  closing_force: 8
  embodied_authority: 6
---

## Radar Analysis
_Generated by model: gpt-4 | 2025-03-27T12:34:56.789Z_

- **Theological Cohesion (8/10)**: The sermon maintains a consistent theological claim about Jesus as the Good Shepherd who sacrificially protects his sheep. This theme is effectively developed through multiple scriptural passages and real-world applications.
- **Scriptural Integration (9/10)**: The sermon expertly weaves together John 10 and Psalm 23, allowing the texts to drive the sermon's structure and theology rather than using them as mere decoration.
- ...

# The Good Shepherd

[Sermon content goes here...]
```

## Understanding Radar Scores

**When I created these, I focused on development with a lens to a PCUSA church. Certain things like Liturgical Harmony won't be as valuable in other traditions.  Should you want to change that, you'll want to go into the "llm-metadata-generator.js" code, and around line 359, change the code to reflect whatever dimensions you choose.  NOTE for v2: I've updated these for in the newest version.  Multiple reasons for why, but mainly that I didn't think the improvisational_trust actually attended to any meaningful feedback.  Even backtesting against multiple models, they didn't seem to grasp what definied the idea.  So, I moved to what I think fundamentally it was meant to be, Embodied Authority.**

The tool evaluates sermons across 9 dimensions on a scale of 0-10:

1. **Theological Cohesion** - Does the sermon make and sustain a theological claim?
2. **Scriptural Integration** - Does Scripture shape the sermon's movement and theology?
3. **Structural Clarity** - Does the sermon have intentional movement?
4. **Liturgical Harmony** - Does the sermon reflect its liturgical context/season?
5. **Voice Fidelity** - Is the preacher's voice distinct and authentic?
6. **Emotional Presence** - Does the sermon engage emotional dimensions?
7. **Metaphorical Resonance** - Do metaphors shape theology or sermon movement?
8. **Closing Force** - Does the sermon end with theological compression?
9. **Embodied Authority** - Does the preacher’s voice, presence, and delivery carry the weight of the sermon’s theological and emotional arc?

## Troubleshooting

- **API Key Issues**: Make sure your `.env` file contains valid API keys
- **Model Selection**: When using OpenRouter, check available models with `list-models`
- **File Access Errors**: Ensure the tool has read/write permissions to your sermon files
- **Rate Limiting**: If you hit rate limits, the tool implements exponential backoff

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.  Admittedly, I'm a bit of a novice with some vibe-coding going on, but I'm learning along the way, and any support would be great.

License
This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.
CopyGNU GENERAL PUBLIC LICENSE
Version 3, 29 June 2007

Copyright (c) 2025 Adam Anderson

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
