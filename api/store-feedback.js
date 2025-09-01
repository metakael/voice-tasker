import 'dotenv/config';
import { env } from '../lib/env.js';
import { sendJson } from '../lib/http.js';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    // Security check
    if (env.SUMMARY_SECRET_KEY) {
      const key = req.query?.key || req.headers['x-summary-key'];
      if (key !== env.SUMMARY_SECRET_KEY) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
    }

    const chatId = req.query?.chatId;
    const feedback = req.query?.feedback;

    if (!chatId || !feedback) {
      return sendJson(res, 400, { error: 'Missing chatId or feedback' });
    }

    console.log('Storing feedback', { chatId, feedbackLength: feedback.length });

    // Load existing feedback log
    const feedbackPath = join(process.cwd(), '.taskmaster', 'feedback_log.json');
    let feedbackLog = { feedback: [] };
    
    try {
      const existingData = readFileSync(feedbackPath, 'utf8');
      feedbackLog = JSON.parse(existingData);
    } catch (error) {
      // File doesn't exist yet, start fresh
      try {
        mkdirSync(dirname(feedbackPath), { recursive: true });
      } catch {}
    }

    // Add new feedback
    const newFeedback = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      chat_id: chatId,
      feedback: feedback,
      task_title: 'General feedback', // Could be enhanced to reference specific tasks
      processed: false
    };

    feedbackLog.feedback = feedbackLog.feedback || [];
    feedbackLog.feedback.push(newFeedback);

    // Keep only last 50 feedback entries to prevent file bloat
    if (feedbackLog.feedback.length > 50) {
      feedbackLog.feedback = feedbackLog.feedback.slice(-50);
    }

    // Save updated feedback log
    writeFileSync(feedbackPath, JSON.stringify(feedbackLog, null, 2));

    console.log('Feedback stored successfully', { feedbackId: newFeedback.id });

    return sendJson(res, 200, { 
      success: true, 
      feedbackId: newFeedback.id,
      message: 'Feedback stored and will be used to improve future prioritization'
    });

  } catch (error) {
    console.error('Store feedback error:', error);
    return sendJson(res, 500, { error: 'Internal Server Error' });
  }
}

export const config = {
  api: {
    bodyParser: false
  }
};
