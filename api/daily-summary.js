import 'dotenv/config';
import { env } from '../lib/env.js';
import { sendJson } from '../lib/http.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { collectAndAnalyzeTasks } from '../lib/summary.js';

async function fetchAllOpenTasks(accessToken, taskLists) {
  const results = [];
  const showCompleted = env.SUMMARY_INCLUDE_COMPLETED ? 'true' : 'false';
  for (const list of taskLists) {
    const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=${showCompleted}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) continue;
    const json = await resp.json();
    const items = json.items || [];
    for (const t of items) {
      if (!env.SUMMARY_INCLUDE_COMPLETED) {
        if (t.status && t.status.toLowerCase() === 'completed') continue;
      }
      results.push({
        id: t.id,
        title: t.title || 'Untitled',
        notes: t.notes || '',
        dueDate: t.due ? t.due.slice(0, 10) : undefined,
        listName: list.title || 'Tasks'
      });
    }
  }
  return results;
}

function buildTaskAnalysisSystemPrompt() {
  return `You are a productivity assistant analyzing tasks for daily planning.\n\nFor each task, provide:\n1. Time estimate (realistic completion time)\n2. Priority level (High/Medium/Low)\n3. Complexity score (1-5)\n4. Quick completion tips\n\nConsider:\n- Due dates and urgency\n- Task complexity and scope\n- Context from task notes\n- Realistic human working patterns\n\nReturn JSON format:\n{\n  "timeEstimate": "45 minutes",\n  "priority": "High",\n  "complexity": 3,\n  "tips": "Break into smaller steps, start with research phase",\n  "category": "Work"\n}`;
}

async function analyzeTasksWithGPT(tasks) {
  if (!tasks.length) return [];
  const chunks = [];
  const batchSize = 15; // cost-effective batching
  for (let i = 0; i < tasks.length; i += batchSize) {
    chunks.push(tasks.slice(i, i + batchSize));
  }

  const analyzed = [];
  for (const chunk of chunks) {
    const userContent = chunk.map((t, idx) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      dueDate: t.dueDate,
      listName: t.listName
    }));

    const payload = {
      model: env.OPENAI_MODEL || 'gpt-5-mini',
      messages: [
        { role: 'system', content: buildTaskAnalysisSystemPrompt() },
        { role: 'user', content: `Analyze these tasks and return an array of JSON objects, one per task, in the same order. Tasks: ${JSON.stringify(userContent)}` }
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
      throw new Error(`OpenAI analysis error: ${text}`);
    }
    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }
    const results = Array.isArray(parsed) ? parsed : parsed.results || parsed.tasks || [];
    for (let i = 0; i < chunk.length; i++) {
      const base = chunk[i];
      const analysis = results[i] || {};
      analyzed.push({
        ...base,
        analysis: {
          timeEstimate: analysis.timeEstimate || '30 minutes',
          priority: analysis.priority || 'Medium',
          complexity: Number(analysis.complexity || 3),
          tips: analysis.tips || ''
        },
        category: analysis.category || undefined
      });
    }
  }
  return analyzed;
}

function parseMinutesFromEstimate(text) {
  if (!text) return 0;
  const lower = String(text).toLowerCase();
  let minutes = 0;
  const hMatch = lower.match(/(\d+(?:\.\d+)?)\s*h/);
  const mMatch = lower.match(/(\d+(?:\.\d+)?)\s*m/);
  if (hMatch) minutes += Math.round(parseFloat(hMatch[1]) * 60);
  if (mMatch) minutes += Math.round(parseFloat(mMatch[1]));
  if (!hMatch && !mMatch) {
    const num = parseFloat(lower);
    if (!Number.isNaN(num)) minutes += Math.round(num);
  }
  return minutes;
}

function generateDailySummary(analyzedTasks) {
  const today = new Date();
  const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const in7Days = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const sections = { todaysFocus: [], quickWins: [], thisWeek: [], overdue: [] };
  let totalMinutes = 0;

  for (const t of analyzedTasks) {
    const minutes = parseMinutesFromEstimate(t.analysis?.timeEstimate);
    totalMinutes += minutes;

    const due = t.dueDate ? new Date(t.dueDate) : null;
    const isOverdue = due && due < startOfToday;
    const isTodayOrDue = due && due.getTime() === startOfToday.getTime();
    const withinWeek = due && due > startOfToday && due <= in7Days;

    if (isOverdue) {
      sections.overdue.push({ ...t, _minutes: minutes });
      continue;
    }

    if (minutes > 0 && minutes <= 30) {
      sections.quickWins.push({ ...t, _minutes: minutes });
    }

    if (isTodayOrDue || (t.analysis?.priority || '').toLowerCase() === 'high') {
      sections.todaysFocus.push({ ...t, _minutes: minutes });
    } else if (withinWeek) {
      sections.thisWeek.push({ ...t, _minutes: minutes });
    }
  }

  const sortByPriorityThenDue = (a, b) => {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    const pa = priorityRank[(a.analysis?.priority || 'medium').toLowerCase()] ?? 1;
    const pb = priorityRank[(b.analysis?.priority || 'medium').toLowerCase()] ?? 1;
    if (pa !== pb) return pa - pb;
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  };

  sections.todaysFocus.sort(sortByPriorityThenDue);
  sections.quickWins.sort((a, b) => a._minutes - b._minutes);
  sections.thisWeek.sort(sortByPriorityThenDue);
  sections.overdue.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  const totalTasks = analyzedTasks.length;
  const totalEstimatedTime = totalMinutes >= 60
    ? `${(totalMinutes / 60).toFixed(1)} hours`
    : `${totalMinutes} minutes`;

  const recommendations = [];
  if (sections.overdue.length) recommendations.push('Start with overdue items');
  if (sections.todaysFocus.some(t => (t.analysis?.complexity || 0) >= 4)) {
    recommendations.push('Block 2-hour window for complex tasks');
  }
  if (sections.quickWins.length >= 2) recommendations.push('Batch quick wins together');

  const motivation = `You\'ve got this! ${totalTasks} tasks estimated at ${totalEstimatedTime} - totally manageable.`;

  return {
    date: startOfToday.toISOString().slice(0, 10),
    totalTasks,
    totalEstimatedTime,
    sections: {
      todaysFocus: sections.todaysFocus,
      quickWins: sections.quickWins,
      thisWeek: sections.thisWeek,
      overdue: sections.overdue
    },
    recommendations,
    motivation
  };
}

function formatTaskLine(t) {
  const mins = t._minutes ?? parseMinutesFromEstimate(t.analysis?.timeEstimate);
  const timeStr = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}min`;
  const dueTag = t.dueDate ? (new Date(t.dueDate) < new Date() ? ' - Overdue 🔴' : ` - Due ${t.dueDate}`) : '';
  return `• ${t.title} (${timeStr})${dueTag}`;
}

function formatSummaryForTelegram(summary) {
  const date = new Date(summary.date + 'T00:00:00Z');
  const dateStr = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const tfMins = summary.sections.todaysFocus.reduce((acc, t) => acc + (t._minutes || 0), 0);
  const qwMins = summary.sections.quickWins.reduce((acc, t) => acc + (t._minutes || 0), 0);
  const twMins = summary.sections.thisWeek.reduce((acc, t) => acc + (t._minutes || 0), 0);

  const tfTime = tfMins >= 60 ? `${(tfMins / 60).toFixed(1)} hours` : `${tfMins} minutes`;
  const qwTime = qwMins >= 60 ? `${(qwMins / 60).toFixed(1)} hours` : `${qwMins} minutes`;
  const twTime = twMins >= 60 ? `${(twMins / 60).toFixed(1)} hours` : `${twMins} minutes`;

  const lines = [];
  lines.push(`🌅 Daily Task Summary - ${dateStr}`);
  lines.push('');
  if (summary.sections.todaysFocus.length) {
    lines.push(`📋 Today\'s Focus (${tfTime}):`);
    for (const t of summary.sections.todaysFocus.slice(0, env.SUMMARY_MAX_TASKS)) lines.push(formatTaskLine(t));
    lines.push('');
  }
  if (summary.sections.quickWins.length) {
    lines.push(`⚡ Quick Wins (${qwTime}):`);
    for (const t of summary.sections.quickWins.slice(0, env.SUMMARY_MAX_TASKS)) lines.push(formatTaskLine(t));
    lines.push('');
  }
  if (summary.sections.thisWeek.length) {
    lines.push(`📅 This Week (${twTime}):`);
    for (const t of summary.sections.thisWeek.slice(0, env.SUMMARY_MAX_TASKS)) lines.push(formatTaskLine(t));
    lines.push('');
  }
  if (summary.sections.overdue.length) {
    lines.push('⏰ Overdue:');
    for (const t of summary.sections.overdue.slice(0, env.SUMMARY_MAX_TASKS)) lines.push(formatTaskLine(t));
    lines.push('');
  }

  lines.push('📊 Summary:');
  lines.push(`• Total: ${summary.totalTasks} open tasks`);
  lines.push(`• Estimated: ${summary.totalEstimatedTime}`);
  if (summary.sections.overdue.length) lines.push(`• Overdue: ${summary.sections.overdue.length} task(s) need attention`);
  lines.push('');
  if (summary.recommendations?.length) {
    lines.push('💡 Recommendations:');
    for (const r of summary.recommendations) lines.push(`• ${r}`);
    lines.push('');
  }
  lines.push(`🚀 ${summary.motivation}`);
  lines.push('');
  lines.push('---');
  lines.push('Reply /summary for updated brief');

  const text = lines.join('\n');
  // Telegram limit ~4096 chars; truncate safely
  return text.length > 3900 ? text.slice(0, 3900) + '\n…' : text;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const cronHeader = req.headers['x-vercel-cron'];
    const isCronJob = !!cronHeader;
    console.log('Daily summary triggered', { 
      isCronJob, 
      cronHeader, 
      userAgent: req.headers['user-agent'],
      query: req.query 
    });

    if (!env.SUMMARY_ENABLED) {
      return sendJson(res, 403, { error: 'Summary disabled' });
    }

    if (env.SUMMARY_SECRET_KEY) {
      const key = req.query?.key || req.headers['x-summary-key'];
      if (!cronHeader && key !== env.SUMMARY_SECRET_KEY) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
    }

    const { summary: dailySummary, taskCount, messageText: telegramMessage } = await collectAndAnalyzeTasks();

    const targetChatId = (req.query && req.query.chatId) ? String(req.query.chatId) : env.DAILY_SUMMARY_CHAT_ID;
    if (targetChatId) {
      await sendTelegramMessage(targetChatId, telegramMessage);
    }

    return sendJson(res, 200, { success: true, summary: dailySummary, taskCount });
  } catch (error) {
    console.error('Daily summary error:', error);
    return sendJson(res, 500, { error: 'Internal Server Error' });
  }
}

export const config = {
  api: {
    bodyParser: false
  }
};


