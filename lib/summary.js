import { env } from './env.js';
import { getGoogleAccessToken, listTasklists } from './google.js';
import { readFileSync } from 'fs';
import { join } from 'path';

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

function loadPriorities() {
  try {
    const prioritiesPath = join(process.cwd(), '.taskmaster', 'priorities.json');
    const prioritiesData = readFileSync(prioritiesPath, 'utf8');
    return JSON.parse(prioritiesData);
  } catch (error) {
    console.log('Using default priorities (priorities.json not found)');
    return {
      top_priorities: [
        "People & HR (hiring, EVP, onboarding, L&D)",
        "Leadership Council (fundraising & funder engagement)", 
        "CRM backbone (staffing, BD, finance integration)"
      ]
    };
  }
}

function buildTaskAnalysisSystemPrompt() {
  const priorities = loadPriorities();
  return `You are a productivity assistant analyzing tasks for daily planning.

TOP PRIORITIES (COO Focus Areas):
${priorities.top_priorities.map((p, i) => `${i + 1}. ${p}`).join('\n')}

For each task, provide:
1. Time estimate (realistic completion time in minutes or hours)
2. Priority score (1-3): 3=directly matches top priorities, 2=indirectly related, 1=general work
3. Priority area (which top priority it aligns with, if any)
4. Complexity score (1-5)
5. Quick completion tips

Consider:
- Due dates and urgency
- Task alignment with TOP PRIORITIES above
- Task complexity and scope
- Context from task notes
- Realistic human working patterns

Return JSON format:
{
  "timeEstimate": "45 minutes",
  "priorityScore": 3,
  "priorityArea": "People & HR (hiring, EVP, onboarding, L&D)",
  "complexity": 3,
  "tips": "Break into smaller steps, start with research phase",
  "category": "Work"
}`;
}

async function analyzeTasksWithGPT(tasks) {
  if (!tasks.length) return [];
  const chunks = [];
  const batchSize = 15;
  for (let i = 0; i < tasks.length; i += batchSize) {
    chunks.push(tasks.slice(i, i + batchSize));
  }

  const analyzed = [];
  for (const chunk of chunks) {
    const userContent = chunk.map((t) => ({
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
          priorityScore: Number(analysis.priorityScore || 1),
          priorityArea: analysis.priorityArea || null,
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
  const priorities = loadPriorities();

  // Sort tasks by priority score, then due date, then urgency
  const sortByPriorityAndUrgency = (a, b) => {
    // Priority score (3=highest, 1=lowest)
    const pa = a.analysis?.priorityScore || 1;
    const pb = b.analysis?.priorityScore || 1;
    if (pa !== pb) return pb - pa; // Higher priority first

    // Due date urgency
    const dueA = a.dueDate ? new Date(a.dueDate) : null;
    const dueB = b.dueDate ? new Date(b.dueDate) : null;
    const isOverdueA = dueA && dueA < startOfToday;
    const isOverdueB = dueB && dueB < startOfToday;
    const isTodayA = dueA && dueA.getTime() === startOfToday.getTime();
    const isTodayB = dueB && dueB.getTime() === startOfToday.getTime();
    
    if (isOverdueA && !isOverdueB) return -1;
    if (!isOverdueA && isOverdueB) return 1;
    if (isTodayA && !isTodayB) return -1;
    if (!isTodayA && isTodayB) return 1;
    
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  };

  // Add minutes and sort all tasks
  const tasksWithMinutes = analyzedTasks.map(t => ({
    ...t,
    _minutes: parseMinutesFromEstimate(t.analysis?.timeEstimate)
  })).sort(sortByPriorityAndUrgency);

  // Separate overdue tasks first
  const overdueTasks = [];
  const availableTasks = [];
  
  for (const task of tasksWithMinutes) {
    const due = task.dueDate ? new Date(task.dueDate) : null;
    const isOverdue = due && due < startOfToday;
    
    if (isOverdue) {
      overdueTasks.push(task);
    } else {
      availableTasks.push(task);
    }
  }

  // Apply 12-hour cap (720 minutes) to available tasks
  const maxDailyMinutes = 12 * 60; // 720 minutes = 12 hours
  const todaysFocus = [];
  const deferred = [];
  let focusMinutes = 0;

  // Always include overdue tasks in focus (they're urgent)
  for (const task of overdueTasks) {
    todaysFocus.push(task);
    focusMinutes += task._minutes;
  }

  // Add other tasks until 12-hour cap
  for (const task of availableTasks) {
    if (focusMinutes + task._minutes <= maxDailyMinutes) {
      todaysFocus.push(task);
      focusMinutes += task._minutes;
    } else {
      deferred.push(task);
    }
  }

  // Calculate totals
  const totalTasks = analyzedTasks.length;
  const totalMinutes = tasksWithMinutes.reduce((sum, t) => sum + t._minutes, 0);
  const deferredMinutes = deferred.reduce((sum, t) => sum + t._minutes, 0);

  const formatTime = (minutes) => {
    return minutes >= 60 ? `${(minutes / 60).toFixed(1)}h` : `${minutes}min`;
  };

  // Check priority coverage
  const priorityCoverage = priorities.top_priorities.map(priority => {
    const hasCoverage = todaysFocus.some(task => 
      task.analysis?.priorityArea === priority || 
      (task.analysis?.priorityScore >= 2 && 
       priority.toLowerCase().includes(task.analysis?.priorityArea?.toLowerCase() || ''))
    );
    return { priority, covered: hasCoverage };
  });

  const recommendations = [];
  if (overdueTasks.length) recommendations.push('Start with overdue items');
  if (todaysFocus.some(t => (t.analysis?.priorityScore || 1) >= 3)) {
    recommendations.push('Focus on high-priority COO initiatives');
  }
  if (todaysFocus.some(t => (t.analysis?.complexity || 0) >= 4)) {
    recommendations.push('Block 2-hour window for complex tasks');
  }
  if (deferred.length) {
    recommendations.push(`${deferred.length} tasks deferred to maintain 12h focus`);
  }

  const motivation = `Focused day ahead! ${todaysFocus.length} priority tasks in ${formatTime(focusMinutes)} - strategic and achievable.`;

  return {
    date: startOfToday.toISOString().slice(0, 10),
    totalTasks,
    totalEstimatedTime: formatTime(totalMinutes),
    focusTime: formatTime(focusMinutes),
    deferredTime: formatTime(deferredMinutes),
    sections: {
      todaysFocus,
      deferred,
      overdue: overdueTasks // Keep for backward compatibility
    },
    priorityCoverage,
    recommendations,
    motivation
  };
}

function formatTaskLine(t) {
  const mins = t._minutes ?? parseMinutesFromEstimate(t.analysis?.timeEstimate);
  const timeStr = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}min`;
  const dueTag = t.dueDate ? (new Date(t.dueDate) < new Date() ? ' - Overdue 🔴' : ` - Due ${t.dueDate}`) : '';
  const priorityTag = t.analysis?.priorityArea ? ` – ${t.analysis.priorityArea.split('(')[0].trim()}` : '';
  return `• ${t.title} (${timeStr})${priorityTag}${dueTag}`;
}

function formatSummaryForTelegram(summary) {
  const date = new Date(summary.date + 'T00:00:00Z');
  const dateStr = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const lines = [];
  lines.push(`🌅 Daily Task Summary - ${dateStr}`);
  lines.push('');
  
  // Priority-aware focus section (≤12h)
  if (summary.sections.todaysFocus.length) {
    lines.push(`📋 Today's Focus (≤12h):`);
    for (const t of summary.sections.todaysFocus.slice(0, env.SUMMARY_MAX_TASKS)) {
      lines.push(formatTaskLine(t));
    }
    lines.push('');
  }

  // Deferred section (beyond 12h)
  if (summary.sections.deferred?.length) {
    lines.push(`🗂️ Deferred (beyond 12h):`);
    for (const t of summary.sections.deferred.slice(0, env.SUMMARY_MAX_TASKS)) {
      lines.push(formatTaskLine(t));
    }
    lines.push('');
  }

  // Summary stats
  lines.push('📊 Summary:');
  lines.push(`• Focus Hours: ${summary.focusTime}`);
  if (summary.sections.deferred?.length) {
    lines.push(`• Deferred: ${summary.deferredTime}`);
  }
  
  // Priority coverage
  if (summary.priorityCoverage?.length) {
    const coverageText = summary.priorityCoverage
      .map(p => `${p.priority.split('(')[0].trim()} ${p.covered ? '✅' : '❌'}`)
      .join(' | ');
    lines.push(`• Priority Coverage: ${coverageText}`);
  }
  lines.push('');

  // Recommendations
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
  return text.length > 3900 ? text.slice(0, 3900) + '\n…' : text;
}

export async function collectAndAnalyzeTasks() {
  const accessToken = await getGoogleAccessToken();
  const taskLists = await listTasklists(accessToken);
  const allTasks = await fetchAllOpenTasks(accessToken, taskLists);
  const limitedTasks = env.SUMMARY_MAX_TASKS > 0 ? allTasks.slice(0, env.SUMMARY_MAX_TASKS) : allTasks;
  const analyzedTasks = await analyzeTasksWithGPT(limitedTasks);
  const summary = generateDailySummary(analyzedTasks);
  const messageText = formatSummaryForTelegram(summary);
  return { summary, taskCount: allTasks.length, messageText };
}

export { analyzeTasksWithGPT, generateDailySummary, formatSummaryForTelegram };


