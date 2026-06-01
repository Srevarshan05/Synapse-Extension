/**
 * Synapse v3 — Conversation Graph Builder
 *
 * Transforms the flat captured message list into a semantic graph:
 *
 * Nodes:
 *   message    — a single turn (user or assistant)
 *   code       — a code block extracted from a message
 *   attachment — a file/image referenced in a message
 *   decision   — a detected decision node
 *   reference  — a URL or citation referenced in the conversation
 *   artifact   — a named output (file, doc, canvas item)
 *   system     — system prompt / instructions
 *
 * Edges:
 *   reply_to       — message N is a direct reply to message N-1
 *   depends_on     — code block uses a variable/function from another message
 *   explains       — assistant message explains a user question
 *   continues      — message continues a previous topic thread
 *   references     — message references an attachment or URL
 *   created_after  — temporal ordering edge (always present)
 *   branch_of      — message belongs to a detected branch/thread
 *
 * Design principle:
 *   The graph is built locally, zero network, using heuristic rules.
 *   It runs after full capture — never interrupts capture.
 */

import { semanticHash, prefixHash, isDuplicate } from './semantic-hasher.js';

// ─── Node factory ─────────────────────────────────────────────────────────────

let _nodeSeq = 0;
function nodeId(type) { return `${type}-${Date.now()}-${++_nodeSeq}`; }

// ─── Graph builder ────────────────────────────────────────────────────────────

/**
 * Build a conversation graph from captured messages.
 *
 * @param {Array<{
 *   id: string, role: string, content: string, index: number,
 *   codeBlocks?: Array<{language:string, content:string}>,
 *   tables?: string[], hasMath?: boolean
 * }>} messages
 * @param {Array} attachments
 * @returns {{ nodes: Object[], edges: Object[], stats: Object }}
 */
export function buildConversationGraph(messages, attachments = []) {
  const nodes = [];
  const edges = [];
  const seenHashes = new Set();

  // Track the last assistant and user node IDs for edge building
  let prevNodeId   = null;
  let lastUserId   = null;
  let lastAssistId = null;

  // ── Pass 1: Create message nodes ──────────────────────────────────────────
  for (const msg of messages) {
    const content = (msg.content || '').trim();
    if (!content) continue;

    // Deduplication: skip if semantically identical to the previous message
    const hash = prefixHash(content);
    if (seenHashes.has(hash)) {
      console.log(`[Synapse Graph] Dedup skip: msg index ${msg.index}`);
      continue;
    }
    seenHashes.add(hash);

    // Message node
    const msgNode = {
      id:           msg.id || nodeId('msg'),
      type:         'message',
      role:         msg.role,
      index:        msg.index,
      content,
      semanticHash: hash,
      fullHash:     semanticHash(content),
      // Rich content
      codeBlocks:   msg.codeBlocks  || [],
      tables:       msg.tables      || [],
      hasMath:      msg.hasMath     || false,
      // Metadata
      charCount:    content.length,
      wordCount:    content.split(/\s+/).filter(Boolean).length,
      hasCode:      (msg.codeBlocks?.length ?? 0) > 0,
      hasTable:     (msg.tables?.length ?? 0) > 0,
      // Children populated in pass 2
      children:     [],
    };

    nodes.push(msgNode);

    // ── Edge: created_after (always, for ordering) ─────────────────────────
    if (prevNodeId) {
      edges.push({
        id:   nodeId('edge'),
        type: 'created_after',
        from: prevNodeId,
        to:   msgNode.id,
      });
    }

    // ── Edge: reply_to / explains ─────────────────────────────────────────
    if (msg.role === 'assistant' && lastUserId) {
      edges.push({
        id:   nodeId('edge'),
        type: 'explains',
        from: msgNode.id,
        to:   lastUserId,
      });
      lastAssistId = msgNode.id;
    } else if (msg.role === 'user' && lastAssistId) {
      edges.push({
        id:   nodeId('edge'),
        type: 'reply_to',
        from: msgNode.id,
        to:   lastAssistId,
      });
      lastUserId = msgNode.id;
    } else if (msg.role === 'user') {
      lastUserId = msgNode.id;
    }

    // ── Edge: continues (topic continuity heuristic) ───────────────────────
    // If user message has < 50 chars and no code, likely a continuation
    if (msg.role === 'user' && content.length < 80 && !msgNode.hasCode && prevNodeId) {
      edges.push({
        id:   nodeId('edge'),
        type: 'continues',
        from: msgNode.id,
        to:   prevNodeId,
      });
    }

    prevNodeId = msgNode.id;
  }

  // ── Pass 2: Create code nodes + depends_on edges ──────────────────────────
  const codeSeenHashes = new Set();

  for (const msgNode of nodes.filter(n => n.type === 'message' && n.hasCode)) {
    for (const block of (msgNode.codeBlocks || [])) {
      const codeContent = (block.content || '').trim();
      if (!codeContent) continue;

      const codeHash = semanticHash(codeContent.substring(0, 300));
      if (codeSeenHashes.has(codeHash)) continue; // deduplicate code blocks
      codeSeenHashes.add(codeHash);

      const codeNode = {
        id:           nodeId('code'),
        type:         'code',
        language:     block.language || 'text',
        content:      codeContent,
        semanticHash: codeHash,
        lineCount:    codeContent.split('\n').length,
        parentId:     msgNode.id,
      };

      nodes.push(codeNode);
      msgNode.children.push(codeNode.id);

      // Edge: message → code (depends_on)
      edges.push({
        id:   nodeId('edge'),
        type: 'depends_on',
        from: msgNode.id,
        to:   codeNode.id,
      });
    }
  }

  // ── Pass 3: Attachment nodes ──────────────────────────────────────────────
  for (const att of attachments) {
    const attNode = {
      id:       att.id || nodeId('att'),
      type:     'attachment',
      name:     att.name,
      fileType: att.type,
      status:   att.status,
      summary:  att.summary,
      fullText: att.fullText || null,
    };

    nodes.push(attNode);

    // Edge: references (from the first message that likely introduced it)
    // Heuristic: link to the first user message that mentions the filename
    const attName = (att.name || '').toLowerCase();
    if (attName) {
      const mentioningMsg = nodes.find(n =>
        n.type === 'message' && n.role === 'user' &&
        (n.content || '').toLowerCase().includes(attName.split('.')[0])
      );
      if (mentioningMsg) {
        edges.push({
          id:   nodeId('edge'),
          type: 'references',
          from: mentioningMsg.id,
          to:   attNode.id,
        });
      }
    }
  }

  // ── Pass 4: Decision nodes ────────────────────────────────────────────────
  // Extract assistant messages that contain explicit decisions
  const DECISION_PATTERNS = [
    /(?:we('ll| will)|let's|I recommend|I suggest|go with|use|adopt)\s+([A-Z][a-z]+[\w\s]{2,40})/g,
    /(?:decided to|decision:)\s+(.+?)(?:\.|$)/gi,
  ];

  for (const msgNode of nodes.filter(n => n.type === 'message' && n.role === 'assistant')) {
    const text = msgNode.content;
    const decisions = [];

    for (const pattern of DECISION_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const decision = (m[2] || m[1] || '').trim().substring(0, 100);
        if (decision.length > 5) decisions.push(decision);
        if (decisions.length >= 3) break;
      }
    }

    for (const decText of decisions) {
      const decNode = {
        id:       nodeId('decision'),
        type:     'decision',
        content:  decText,
        parentId: msgNode.id,
      };
      nodes.push(decNode);
      msgNode.children.push(decNode.id);
      edges.push({
        id:   nodeId('edge'),
        type: 'depends_on',
        from: msgNode.id,
        to:   decNode.id,
      });
    }
  }

  // ── Pass 5: Reference nodes (URLs mentioned in conversation) ─────────────
  const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
  const seenUrls = new Set();

  for (const msgNode of nodes.filter(n => n.type === 'message')) {
    const urls = (msgNode.content || '').match(URL_RE) || [];
    for (const url of urls) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const refNode = {
        id:   nodeId('ref'),
        type: 'reference',
        url,
        mentionedBy: msgNode.id,
      };
      nodes.push(refNode);
      edges.push({
        id:   nodeId('edge'),
        type: 'references',
        from: msgNode.id,
        to:   refNode.id,
      });
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = {
    totalNodes:       nodes.length,
    totalEdges:       edges.length,
    messageNodes:     nodes.filter(n => n.type === 'message').length,
    codeNodes:        nodes.filter(n => n.type === 'code').length,
    attachmentNodes:  nodes.filter(n => n.type === 'attachment').length,
    decisionNodes:    nodes.filter(n => n.type === 'decision').length,
    referenceNodes:   nodes.filter(n => n.type === 'reference').length,
    deduplicatedMsgs: messages.length - nodes.filter(n => n.type === 'message').length,
  };

  return { nodes, edges, stats };
}

/**
 * Get ordered message nodes from the graph (preserves capture order).
 * @param {{ nodes: Object[] }} graph
 * @returns {Object[]}
 */
export function getMessageNodes(graph) {
  return graph.nodes
    .filter(n => n.type === 'message')
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/**
 * Get the continuation tail: last N message nodes in order.
 * Used by the hydration engine's continuation compiler.
 * @param {{ nodes: Object[] }} graph
 * @param {number} [n=10]
 * @returns {Object[]}
 */
export function getContinuationTail(graph, n = 10) {
  return getMessageNodes(graph).slice(-n);
}

/**
 * Get all unique code nodes, sorted by first appearance.
 * @param {{ nodes: Object[] }} graph
 * @returns {Object[]}
 */
export function getCodeNodes(graph) {
  return graph.nodes.filter(n => n.type === 'code');
}

/**
 * Get all decision nodes.
 * @param {{ nodes: Object[] }} graph
 * @returns {Object[]}
 */
export function getDecisionNodes(graph) {
  return graph.nodes.filter(n => n.type === 'decision');
}
