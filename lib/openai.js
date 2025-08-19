import { env } from './env.js';

const SYSTEM_PROMPT = () => `You are a task organizer. Convert voice transcriptions into structured tasks.

Available categories: ${JSON.stringify(env.CATEGORY_LIST)}

Rules:
1. Choose exactly ONE category that best fits
2. If no category fits, use "General Operations"  
3. Create short, imperative title (e.g., "Call dentist", "Review budget")
4. Include context in notes if helpful
5. Only set "due" if explicit date/time mentioned
6. Parse natural language dates (tomorrow, next Friday, in 2 weeks)
7. Always return all fields in English. If the transcription is not in English, translate title and notes to English.
8. The category MUST be one of the provided categories exactly. If uncertain, use "General Operations".

Return JSON only:
{
  "title": "Short imperative task title",
  "notes": "Additional context if needed", 
  "category": "Exact category name from list",
  "due": "2024-01-15" // ISO date, only if explicit deadline
}`;

export async function transcribeAudio(arrayBuffer) {
  const form = new FormData();
  form.append('file', new Blob([arrayBuffer], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', 'whisper-1');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Whisper transcription error: ${text}`);
  }
  const json = await resp.json();
  return json.text || '';
}

export async function analyzeTask(transcription) {
  const payload = {
    model: env.OPENAI_MODEL || 'gpt-5-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT() },
      { role: 'user', content: transcription }
    ],
    response_format: { type: 'json_object' }
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI analyze error: ${text}`);
  }
  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(content);
    const allowed = new Set(env.CATEGORY_LIST);
    const categoryCandidate = parsed.category || 'General Operations';
    const category = allowed.has(categoryCandidate) ? categoryCandidate : 'General Operations';
    return {
      title: parsed.title || 'Untitled task',
      notes: parsed.notes || '',
      category,
      due: parsed.due || undefined
    };
  } catch {
    return { title: 'Untitled task', notes: '', category: 'General Operations' };
  }
}


