/**
 * Shared LLM wrapper — Anthropic API with hard timeouts, cost tracking, and
 * graceful degradation. The system NEVER blocks on LLM failure: callers must
 * supply a deterministic fallback.
 */
import Anthropic from '@anthropic-ai/sdk';

export const WOLFMAN_MODEL = process.env.WOLFMAN_MODEL ?? 'claude-haiku-4-5';
export const CEO_MODEL = process.env.CEO_MODEL ?? 'claude-sonnet-4-5';

// USD per million tokens (input, output)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 }
};

export interface LLMResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  model: string;
  fallback_used: false;
}

export interface LLMFallback {
  text: string;
  fallback_used: true;
  reason: string;
}

let client: Anthropic | null = null;

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function callLLM(args: {
  model: string;
  system: string;
  user: string;
  max_tokens: number;
  timeout_ms: number;
}): Promise<LLMResult | LLMFallback> {
  if (!llmConfigured()) {
    return { text: '', fallback_used: true, reason: 'ANTHROPIC_API_KEY not set' };
  }
  try {
    const response = await getClient().messages.create(
      {
        model: args.model,
        max_tokens: args.max_tokens,
        system: args.system,
        messages: [{ role: 'user', content: args.user }]
      },
      { timeout: args.timeout_ms }
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) {
      return { text: '', fallback_used: true, reason: 'empty LLM response' };
    }

    const pricing = PRICING[args.model] ?? { input: 3.0, output: 15.0 };
    return {
      text,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      estimated_cost_usd:
        (response.usage.input_tokens * pricing.input + response.usage.output_tokens * pricing.output) / 1e6,
      model: args.model,
      fallback_used: false
    };
  } catch (err) {
    return {
      text: '',
      fallback_used: true,
      reason: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
