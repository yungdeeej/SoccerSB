/**
 * Telegram bot skeleton (Phase 1) — send messages + respond to /status.
 * STRIKE alerts and daily reports come in Phases 3-4.
 * Degrades to a no-op with a console warning when not configured.
 */

const API_BASE = 'https://api.telegram.org';

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

function chatId(): string | null {
  return process.env.TELEGRAM_CHAT_ID || null;
}

export function telegramConfigured(): boolean {
  return botToken() !== null && chatId() !== null;
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = botToken();
  const chat = chatId();
  if (!token || !chat) {
    console.warn('telegram: not configured — message suppressed:', text.slice(0, 80));
    return false;
  }
  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text })
    });
    if (!res.ok) {
      console.error(`telegram: sendMessage failed ${res.status}: ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('telegram: network error', err);
    return false;
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

/**
 * Long-poll for commands. Phase 1 supports only /status.
 * statusFn builds the reply text on demand.
 */
export function startTelegramCommandLoop(statusFn: () => Promise<string>): void {
  const token = botToken();
  if (!token || !chatId()) {
    console.warn('telegram: not configured — command loop disabled');
    return;
  }

  let offset = 0;
  let running = true;

  const loop = async (): Promise<void> => {
    while (running) {
      try {
        const res = await fetch(
          `${API_BASE}/bot${token}/getUpdates?timeout=30&offset=${offset}`,
          { signal: AbortSignal.timeout(40_000) }
        );
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 10_000));
          continue;
        }
        const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
        for (const update of body.result ?? []) {
          offset = Math.max(offset, update.update_id + 1);
          const text = update.message?.text?.trim();
          if (text === '/status') {
            const reply = await statusFn();
            await sendTelegramMessage(reply);
          }
        }
      } catch {
        // transient — back off and retry
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  };

  void loop();
  process.on('SIGTERM', () => { running = false; });
}
