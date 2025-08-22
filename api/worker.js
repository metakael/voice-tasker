import 'dotenv/config';
import { env } from '../lib/env.js';
import { getGoogleAccessToken, createGoogleTask, listTasklists } from '../lib/google.js';
import { getTelegramFileUrl, sendTelegramMessage, downloadArrayBuffer } from '../lib/telegram.js';
import { transcribeAudio, analyzeTask } from '../lib/openai.js';
import { sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || authHeader !== `Bearer ${env.WORKER_SHARED_SECRET}`) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    const { chatId, fileId } = req.body || {};
    if (!chatId || !fileId) {
      return sendJson(res, 400, { error: 'Missing chatId or fileId' });
    }

    console.log('Worker start', { chatId, hasFileId: !!fileId });

    // 1) Download voice from Telegram
    const fileUrl = await getTelegramFileUrl(fileId);
    console.log('Worker got file URL');
    const audioBuffer = await downloadArrayBuffer(fileUrl);
    console.log('Worker downloaded audio');

    // 2) Transcribe via Whisper
    const transcription = await transcribeAudio(audioBuffer);
    console.log('Worker transcription done');

    // 3) Analyze with GPT-5 Mini
    const analysis = await analyzeTask(transcription);
    console.log('Worker analyze done');

    // 4) Google access token
    const accessToken = await getGoogleAccessToken();
    console.log('Worker google token ok');

    // 5) Map category -> task list
    const categoryToList = env.CATEGORY_TO_LIST_MAP;
    const listId = categoryToList[analysis.category] || env.DEFAULT_TASKLIST_ID || undefined;

    // 6) Create task
    const createdTask = await createGoogleTask({
      accessToken,
      listId,
      title: analysis.title,
      notes: analysis.notes,
      due: analysis.due || undefined
    });
    console.log('Worker created task');

    // 7) Send confirmation
    const confirm = `✅ Task created: ${analysis.title}${analysis.due ? ` (due ${analysis.due})` : ''}`;
    await sendTelegramMessage(chatId, confirm);
    console.log('Worker sent confirmation');

    return sendJson(res, 200, { ok: true, transcription, analysis, createdTask });
  } catch (error) {
    console.error('worker error:', error);
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


