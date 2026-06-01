/**
 * Synapse v3 — Context Compiler (Graph-Aware)
 *
 * Extracts the MemoryBlock from the conversation graph.
 * Operates on graph nodes instead of the raw flat message list.
 *
 * Memory Layers produced:
 *   full          — ordered array of all message nodes (for replay)
 *   summary       — 2–3 sentence overview from first exchange
 *   goals         — detected user intent signals
 *   decisions     — detected decisions from decision nodes + assistant heuristics
 *   constraints   — detected must/cannot/limited patterns
 *   entities      — technical entities (libraries, frameworks, APIs, names)
 *   openQuestions — unresolved questions from last assistant messages
 *   continuation  — last 10 message tail for hydration
 */

import { getMessageNodes, getDecisionNodes, getContinuationTail } from './graph-builder.js';

/**
 * @param {{ nodes: Object[], edges: Object[] }} graph
 * @returns {import('./types.js').MemoryBlock & { continuation: Object[], entities: string[] }}
 */
export function compileMemory(graph) {
  const memory = {
    summary:       '',
    goals:         [],
    decisions:     [],
    constraints:   [],
    openQuestions: [],
    entities:      [],
    continuation:  [],  // last 10 message nodes for hydration
  };

  const msgNodes = getMessageNodes(graph);
  if (msgNodes.length === 0) return memory;

  // ── SUMMARY: first user → first assistant exchange ───────────────────────
  const firstUser   = msgNodes.find(n => n.role === 'user');
  const firstAssist = msgNodes.find(n => n.role === 'assistant');

  if (firstUser && firstAssist) {
    const q = firstUser.content.substring(0, 120).replace(/\n/g, ' ').trim();
    const a = firstAssist.content.substring(0, 120).replace(/\n/g, ' ').trim();
    memory.summary = `${q} — ${a}`;
  } else if (firstUser) {
    memory.summary = firstUser.content.substring(0, 200).replace(/\n/g, ' ').trim();
  }

  // ── Goals: scan all USER messages ────────────────────────────────────────
  const GOAL_RE = /(?:I (?:need|want|have) to|we (?:need|want) to|goal is to|trying to|working on|building|create|implement|make)\s+(.{10,100}?)(?:\.|!|\n|$)/gi;
  const goalSet = new Set();

  for (const node of msgNodes.filter(n => n.role === 'user')) {
    let m;
    GOAL_RE.lastIndex = 0;
    while ((m = GOAL_RE.exec(node.content)) !== null) {
      const g = m[1].trim().replace(/\s+/g, ' ');
      if (g.length > 8) goalSet.add(g.substring(0, 120));
      if (goalSet.size >= 6) break;
    }
  }
  memory.goals = Array.from(goalSet).slice(0, 5);

  // ── Decisions: from decision nodes + assistant heuristic ─────────────────
  const decNodes = getDecisionNodes(graph);
  const decSet   = new Set(decNodes.map(n => n.content));

  // Also scan assistant messages directly for stronger signal
  const DEC_RE = /(?:(?:we('ll| will) (?:use|go with|implement|adopt)|I recommend(?:ed)?|(?:decided|chose|selected|picked) to(?: use)?)\s+)(.{5,80}?)(?:\.|,|\n|$)/gi;

  for (const node of msgNodes.filter(n => n.role === 'assistant')) {
    let m;
    DEC_RE.lastIndex = 0;
    while ((m = DEC_RE.exec(node.content)) !== null) {
      const d = (m[3] || m[2] || '').trim().replace(/\s+/g, ' ');
      if (d.length > 4) decSet.add(d.substring(0, 100));
      if (decSet.size >= 8) break;
    }
  }
  memory.decisions = Array.from(decSet).slice(0, 5);

  // ── Constraints: scan ALL messages ───────────────────────────────────────
  const CON_RE = /(?:must(?! not)|cannot|can't|should not|required to|limited to|only (?:use|allow)|no more than|at most|at least|never)\s+(.{5,80}?)(?:\.|!|\n|$)/gi;
  const conSet = new Set();

  for (const node of msgNodes) {
    let m;
    CON_RE.lastIndex = 0;
    while ((m = CON_RE.exec(node.content)) !== null) {
      const c = m[1].trim().replace(/\s+/g, ' ');
      if (c.length > 4) conSet.add(c.substring(0, 100));
      if (conSet.size >= 6) break;
    }
  }
  memory.constraints = Array.from(conSet).slice(0, 4);

  // ── Open Questions: from last 5 assistant messages ────────────────────────
  const QUESTION_RE = /([^.!?]*\?)/g;
  const qSet = new Set();
  const recentAssist = msgNodes.filter(n => n.role === 'assistant').slice(-5);

  for (const node of recentAssist) {
    const sentences = (node.content || '').split(/(?<=[.!?])\s+/);
    // Prefer questions at the END of assistant responses (closing prompts)
    for (const s of sentences.slice(-3)) {
      if (s.trim().endsWith('?') && s.length > 10 && s.length < 150) {
        qSet.add(s.trim());
        if (qSet.size >= 4) break;
      }
    }
  }
  memory.openQuestions = Array.from(qSet).slice(0, 3);

  // ── Entities: technical terms across all messages ─────────────────────────
  const entitySet = new Set();
  // Match: PascalCase, ALLCAPS (min 3), code-like (word.word), version tags
  const ENT_RE = /\b(?:[A-Z][a-z]+(?:[A-Z][a-z]+)+|[A-Z]{3,}|[a-z]+\.[a-z]{2,}|v?\d+\.\d+(?:\.\d+)?)\b/g;

  // Skip common English words that pass the pattern
  const SKIP = new Set([
    'The', 'That', 'This', 'With', 'From', 'Have', 'Will', 'When',
    'Can', 'You', 'For', 'Our', 'Your', 'Its', 'But', 'And', 'Not',
    'Are', 'Was', 'Has', 'Had', 'We', 'In', 'To', 'Of', 'At', 'Is',
  ]);

  for (const node of msgNodes) {
    let m;
    ENT_RE.lastIndex = 0;
    while ((m = ENT_RE.exec(node.content)) !== null) {
      const e = m[0];
      if (e.length >= 3 && e.length <= 30 && !SKIP.has(e)) {
        entitySet.add(e);
        if (entitySet.size >= 20) break;
      }
    }
  }
  memory.entities = Array.from(entitySet).slice(0, 12);

  // ── Continuation tail: last 10 messages for hydration ────────────────────
  memory.continuation = getContinuationTail(graph, 10).map(n => ({
    role:    n.role,
    content: n.content.substring(0, 1500), // cap per message to keep payload manageable
    index:   n.index,
  }));

  return memory;
}
