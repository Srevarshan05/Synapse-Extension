/**
 * Synapse v3 — Security & Redaction Engine
 * Scans text (messages, attachment summaries, code snippets) for sensitive
 * secrets (API keys, JWTs, credentials) and replaces them with safe placeholders.
 * Runs locally on device before any data is encrypted or compressed.
 */

const REDACTION_PATTERNS = [
  {
    name: 'OpenAI API Key',
    regex: /\b(sk-[A-Za-z0-9]{20,})\b/g,
    placeholder: '[REDACTED_OPENAI_KEY]'
  },
  {
    name: 'Anthropic API Key',
    regex: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    placeholder: '[REDACTED_ANTHROPIC_KEY]'
  },
  {
    name: 'Google Gemini API Key',
    regex: /\b(AIza[0-9A-Za-z-_]{35})\b/g,
    placeholder: '[REDACTED_GEMINI_KEY]'
  },
  {
    name: 'AWS Access Key ID',
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    placeholder: '[REDACTED_AWS_KEY]'
  },
  {
    name: 'JWT / Bearer Token',
    regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    placeholder: '[REDACTED_JWT]'
  },
  {
    name: 'Generic Bearer Token',
    regex: /\b(Bearer\s+[A-Za-z0-9._-]{20,})\b/g,
    placeholder: 'Bearer [REDACTED_TOKEN]'
  },
  {
    name: 'Basic Auth in URL',
    regex: /(?:\w+:\/\/)([^:]+:[^@]+)@/g,
    // Note: this regex captures the auth part to replace it, but we need to keep the protocol and @.
    // We handle this specially in the replace function if needed, or just replace the whole match.
    // For simplicity, we capture the auth part.
    placeholder: '[REDACTED_AUTH]'
  },
  {
    name: 'Private Key',
    regex: /-----BEGIN[\s\w]+PRIVATE KEY-----[^-]+-----END[\s\w]+PRIVATE KEY-----/g,
    placeholder: '[REDACTED_PRIVATE_KEY]'
  },
  {
    name: 'Generic API Key / Secret',
    regex: /(?:api_key|apikey|secret|password|passwd|pwd|token)(?:\s*[:=]\s*['"]?)([A-Za-z0-9_.-]{16,})['"]?/gi,
    placeholder: '[REDACTED_SECRET]' // Placeholder substitution needs to preserve the key name, handled below.
  }
];

/**
 * Redacts sensitive information from a string.
 * @param {string} text - The input text to sanitize.
 * @returns {{ redactedText: string, secretsFound: boolean }}
 */
export function redact(text) {
  if (!text) return { redactedText: text, secretsFound: false };

  let secretsFound = false;
  let result = text;

  // Pattern 1-6 & 8: direct replacement of the capture group
  for (const pattern of REDACTION_PATTERNS) {
    if (pattern.name === 'Basic Auth in URL') {
      result = result.replace(pattern.regex, (match, authGroup) => {
        secretsFound = true;
        return match.replace(authGroup, pattern.placeholder);
      });
    } else if (pattern.name === 'Generic API Key / Secret') {
      result = result.replace(pattern.regex, (match, secretGroup) => {
        secretsFound = true;
        return match.replace(secretGroup, pattern.placeholder);
      });
    } else {
      result = result.replace(pattern.regex, () => {
        secretsFound = true;
        return pattern.placeholder;
      });
    }
  }

  return { redactedText: result, secretsFound };
}

/**
 * Deep redaction of an entire conversation array in place.
 * @param {import('./types.js').Message[]} messages
 * @returns {boolean} True if any secrets were found and redacted.
 */
export function redactMessages(messages) {
  let anyRedacted = false;
  for (const msg of messages) {
    if (msg.content) {
      const { redactedText, secretsFound } = redact(msg.content);
      if (secretsFound) {
        msg.content = redactedText;
        anyRedacted = true;
      }
    }
  }
  return anyRedacted;
}
