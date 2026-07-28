import fs from 'node:fs/promises';
import path from 'node:path';

const escapeXml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]));

export async function createPrompt(productName, description) {
  if (process.env.GROQ_API_KEY) {
    console.log(`[job prompt] Using Groq for: ${productName}`);
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Write one concise, production-ready image-generation prompt. Keep the described product faithful; do not add brand logos or text in the image.' },
          { role: 'user', content: `Product: ${productName}\nDescription: ${description}` }
        ],
        temperature: 0.7
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error(`[job prompt] Groq returned ${response.status}: ${detail}`);
      throw new Error(`Prompt service returned ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  console.log(`[job prompt] No Groq key configured; using local prompt for: ${productName}`);
  return `Premium editorial lifestyle product photograph of ${productName}. ${description} Warm natural daylight, tactile materials, carefully styled table setting, summer atmosphere, realistic photography, product centered and clearly visible, no lettering, no watermark.`;
}

export async function generatePlaceholder({ id, productName }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f9e6cc"/><stop offset="1" stop-color="#a2b69b"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-opacity=".22"/></filter></defs>
    <style>.title{font:700 48px Georgia,serif;fill:#28352d}.label{font:600 18px Arial,sans-serif;letter-spacing:3px;fill:#53685d}</style>
    <rect width="1200" height="800" fill="url(#bg)"/><circle cx="930" cy="260" r="240" fill="#fef6e7" opacity=".7"/><ellipse cx="600" cy="350" rx="285" ry="155" fill="#734c2b" filter="url(#shadow)"/><ellipse cx="600" cy="320" rx="245" ry="125" fill="#bd8150"/><ellipse cx="600" cy="307" rx="210" ry="96" fill="#e6bb80"/>
    <text x="80" y="105" class="label">MINI CONTENT ENGINE - LOCAL DEMO OUTPUT</text><text x="80" y="175" class="title">${escapeXml(productName)}</text><text x="80" y="700" class="label">GENERATED FROM PRODUCT BRIEF + REFERENCE</text>
  </svg>`;
  const fileName = `${id}.svg`;
  await fs.writeFile(path.join('generated', fileName), svg, 'utf8');
  return `/generated/${fileName}`;
}
