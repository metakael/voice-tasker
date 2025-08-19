import 'dotenv/config';
import { env } from '../lib/env.js';
import { getGoogleAccessToken, createGoogleTask, listTasklists } from '../lib/google.js';
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
    const { chatId, fileId } = body;
    console.log('[worker] payload', { hasChatId: Boolean(chatId), hasFileId: Boolean(fileId) });
    if (!chatId || !fileId) {
      return sendJson(res, 400, { error: 'Missing chatId or fileId' });
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
    console.log('[worker] transcription length', transcription?.length || 0);

    // 3) Analyze with GPT-5 Mini
    console.log('[worker] analyzing');
    const analysis = await analyzeTask(transcription);
    console.log('[worker] analysis', analysis);

    // 4) Google access token
    console.log('[worker] google token');
    const accessToken = await getGoogleAccessToken();

    // 5) Map category -> task list
    const categoryToList = env.CATEGORY_TO_LIST_MAP;
    const listId = categoryToList[analysis.category] || env.DEFAULT_TASKLIST_ID || undefined;

    // 6) Create task
    console.log('[worker] creating task');
    const createdTask = await createGoogleTask({
      accessToken,
      listId,
      title: analysis.title,
      notes: analysis.notes,
      due: analysis.due || undefined
    });

    // 7) Send confirmation
    const confirm = `✅ Task created: ${analysis.title}${analysis.due ? ` (due ${analysis.due})` : ''}`;
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


