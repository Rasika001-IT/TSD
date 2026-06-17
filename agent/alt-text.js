// agent/alt-text.js
// Generates descriptive alt text for an editor-uploaded image using Claude
// vision, following the TSD guideline ("descriptive alt text with keyword").
// Editorial concern (accessibility + SEO), so it lives in /agent. The client is
// injectable for testing; falls back to a plain default if generation is off.

import { config } from '../bridge/config.js';

async function defaultClient() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic();
}

/**
 * @param {{ base64: string, mimeType: string, title?: string, keyword?: string }} img
 * @param {{ client?: object }} [deps]
 * @returns {Promise<string>} concise alt text (<= ~125 chars), never throws
 */
export async function generateAltText(img, deps = {}) {
  if (!config.anthropic?.enabled && !deps.client) {
    return img.title ? `Image for: ${img.title}` : '';
  }
  try {
    const client = deps.client ?? (await defaultClient());
    const context = [
      img.title ? `Article headline: ${img.title}.` : '',
      img.keyword ? `Primary keyword to include if natural: ${img.keyword}.` : '',
      'Write a single concise alt-text sentence (max ~125 characters) describing',
      'what is visibly in this image, for accessibility and SEO. Describe only what',
      'you can actually see — do not invent details. No "image of"/"photo of" prefix.',
      'Reply with the alt text only, nothing else.',
    ].filter(Boolean).join(' ');

    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } },
          { type: 'text', text: context },
        ],
      }],
    });
    const text = (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    return text.replace(/^"+|"+$/g, '').slice(0, 160) || (img.title ? `Image for: ${img.title}` : '');
  } catch {
    return img.title ? `Image for: ${img.title}` : '';
  }
}
