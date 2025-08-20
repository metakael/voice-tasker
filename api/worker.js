import 'dotenv/config';
import { env } from '../lib/env.js';
import { getGoogleAccessToken, createGoogleTask, listTasklists, findDuplicateTask } from '../lib/google.js';
import { getTelegramFileUrl, sendTelegramMessage, downloadArrayBuffer } from '../lib/telegram.js';
import { transcribeAudio, analyzeTask } from '../lib/openai.js';
import { sendJson, readJsonBody } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || authHeader !== `Bearer ${env.WORKER_SHARED_SECRET}`) {
      console.warn('[worker] unauthorized request');
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    const body = await readJsonBody(req);
    const { chatId, fileId, fromId } = body;
    console.log('[worker] payload', { hasChatId: Boolean(chatId), hasFileId: Boolean(fileId) });
    if (!chatId || !fileId) {
      return sendJson(res, 400, { error: 'Missing chatId or fileId' });
    }

    // Enforce allowed Telegram user
    if (env.TELEGRAM_ALLOWED_USER_ID && fromId && fromId !== env.TELEGRAM_ALLOWED_USER_ID) {
      return sendJson(res, 200, { ok: true });
    }

    // Notify user early
    try {
      await sendTelegramMessage(chatId, '🎙️ Processing your voice note...');
    } catch (e) {
      console.warn('[worker] failed to send early message');
    }

    // 1) Download voice from Telegram
    console.log('[worker] fetching telegram file');
    const fileUrl = await getTelegramFileUrl(fileId);
    console.log('[worker] file url', fileUrl);
    const audioBuffer = await downloadArrayBuffer(fileUrl);

    // 2) Transcribe via Whisper
    console.log('[worker] transcribing');
    const transcription = await transcribeAudio(audioBuffer);
    console.log('[worker] transcription:', JSON.stringify(transcription));
    console.log('[worker] transcription length', transcription?.length || 0);

    // 3) Analyze with GPT-5 Mini
    console.log('[worker] analyzing');
    const analysis = await analyzeTask(transcription);
    console.log('[worker] analysis', analysis);

    // Sanitize notes to remove any language labels or quoted original text
    function sanitizeNotes(notes) {
      if (!notes) return '';
      let out = notes;
      // Drop prefixes like: User request (Malay): '...'
      out = out.replace(/^\s*User request[^:]*:\s*("[^"]*"|'[^']*'|[^—]*)(—\s*)?/i, '');
      // Remove surrounding quotes if any remain
      out = out.replace(/^\s*['"]|['"]\s*$/g, '');
      return out.trim();
    }
    analysis.notes = sanitizeNotes(analysis.notes);

    // 4) Google access token
    console.log('[worker] google token');
    const accessToken = await getGoogleAccessToken();

    // 5) Map category -> task list (env mapping, then dynamic match by list title, then default)
    const categoryToList = env.CATEGORY_TO_LIST_MAP;
    console.log('[worker] mapping category', analysis.category, 'available mappings:', Object.keys(categoryToList || {}));
    let listId = categoryToList[analysis.category];
    if (!listId) {
      console.warn('[worker] no list mapping for category', analysis.category, 'raw:', analysis.categoryRaw, '— attempting dynamic match by title');
      const accessToken = await getGoogleAccessToken();
      const lists = await listTasklists(accessToken);
      const found = lists.find((l) => l.title === analysis.category);
      if (found) {
        listId = found.id;
        console.log('[worker] dynamically matched list id', listId, 'for title', analysis.category);
      }
      if (!listId) {
        listId = env.DEFAULT_TASKLIST_ID || undefined;
        console.warn('[worker] using default list id', listId || '@default');
      }
    }

    // 6) Create task
    // De-duplicate by title + due (best-effort)
    const existing = await findDuplicateTask({ accessToken, listId, title: analysis.title, due: analysis.due || undefined });
    if (existing) {
      console.log('[worker] duplicate task detected, skipping create');
    }
    console.log('[worker] creating task');
    const createdTask = existing || await createGoogleTask({
      accessToken,
      listId,
      title: analysis.title,
      notes: analysis.notes,
      due: analysis.due || undefined
    });

    // 7) Send confirmation
    const confirm = `✅ Task created in ${analysis.category}: ${analysis.title}${analysis.due ? ` (due ${analysis.due})` : ''}`;
    console.log('[worker] sending confirmation');
    await sendTelegramMessage(chatId, confirm);

    return sendJson(res, 200, { ok: true, transcription, analysis, createdTask });
  } catch (error) {
    console.error('[worker] error:', error);
    try {
      const body = req.body || {};
      if (body.chatId) {
        await sendTelegramMessage(body.chatId, '❌ Sorry, I could not process your voice note.');
      }
    } catch {}
    return sendJson(res, 500, { error: 'Internal Server Error' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb'
    }
  }
};


