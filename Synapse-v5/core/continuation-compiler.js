/**
 * Synapse v3 — Continuation Compiler (Graph-Memory Aware)
 *
 * Produces a minimal hydration payload from the capsule's memory layers.
 *
 * Limits:
 *   - Hard cap: 3000 characters
 *   - Captures full verbatim conversation turns
 */

/**
 * @param {import('./types.js').SynapseCapsule} capsule
 * @returns {string}
 */
export function buildContinuationPrompt(capsule) {
  const title = capsule.title || 'Previous session';
  const platform = capsule.platform || 'unknown';
  
  // Format the prompt exactly using the user's updated injection prompt code
  let prompt = `Hey, these are the contents captured from the previous chat ("${title}" on ${platform.toUpperCase()}).\n`;
  prompt += `Please read through them carefully and provide a concise list of key points for every topic covered in the entire conversation.\n`;
  prompt += `Do not continue the chat or expand on the discussion — only summarize the topics into clear, structured key points.\n`;
  prompt += `The user will then review your summary and select a specific point or topic to continue the conversation.\n\n`;
  prompt += `--- Captured Conversation History ---\n`;

  // Get the complete verbatim history turns from the captured capsule
  const msgs = capsule.messages || [];
  if (msgs.length > 0) {
    for (const m of msgs) {
      const roleName = m.role === 'user' ? 'User' : 'Assistant';
      prompt += `${roleName}: ${m.content}\n\n`;
    }
  } else if (capsule.raw_items && capsule.raw_items.length > 0) {
    const rawMsgs = capsule.raw_items.filter(x => x && x.content);
    for (const m of rawMsgs) {
      const roleName = m.role === 'user' ? 'User' : 'Assistant';
      prompt += `${roleName}: ${m.content}\n\n`;
    }
  }

  prompt += `--------------------------------------\n`;
  prompt += `Remember: Only summarize the topics into clear, structured key points, then stop and wait for the user's choice.`;

  // Robust limit (e.g., 3000 characters) to fit rich, verbatim multi-turn conversation context
  if (prompt.length > 3000) {
    prompt = prompt.substring(0, 2997) + '…';
  }

  return prompt;
}
