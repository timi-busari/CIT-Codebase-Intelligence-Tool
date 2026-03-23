import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/** Pause for `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
}

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private client: OpenAI;
  private model: string;
  private provider: 'openai' | 'ollama';

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const useOllama =
      this.config.get<string>('ENABLE_OLLAMA', 'false') === 'true';

    if (useOllama) {
      const baseURL = this.config.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      );
      this.model = this.config.get<string>('OLLAMA_MODEL', 'qwen3:8b');
      this.provider = 'ollama';
      // Ollama exposes an OpenAI-compatible endpoint at /v1
      this.client = new OpenAI({
        baseURL: `${baseURL.replace(/\/$/, '')}/v1`,
        apiKey: 'ollama', // required by the SDK but ignored by Ollama
      });
      this.logger.log(
        `LLM provider: Ollama  model=${this.model}  url=${baseURL}`,
      );
    } else {
      this.model = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
      this.provider = 'openai';
      this.client = new OpenAI({
        apiKey: this.config.get<string>('OPENAI_API_KEY', ''),
      });
      this.logger.log(`LLM provider: OpenAI  model=${this.model}`);
    }
  }

  async chat(
    messages: LlmMessage[],
    options: LlmOptions = {},
  ): Promise<string> {
    const { temperature = 0.2, maxTokens = 4096 } = options;
    const MAX_RETRIES = 3;
    let lastErr: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
        });
        return (
          completion.choices[0]?.message?.content ?? 'No response generated.'
        );
      } catch (err: any) {
        lastErr = err;
        const status: number | undefined = err?.status ?? err?.response?.status;

        // Retry on 429 (rate-limit / quota) and 5xx with exponential backoff
        if (
          (status === 429 || (status && status >= 500)) &&
          attempt < MAX_RETRIES
        ) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
          this.logger.warn(
            `LLM ${status} — retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`,
          );
          await sleep(delay);
          continue;
        }

        // Non-retryable or exhausted retries
        this.logger.error(`LLM call failed (${this.provider})`, err?.message);
        const hint =
          status === 429
            ? `OpenAI quota exceeded. Consider switching to Ollama (set ENABLE_OLLAMA=true in backend/.env) or upgrading your OpenAI plan.`
            : this.provider === 'ollama'
              ? `Ensure Ollama is running and the model "${this.model}" is pulled (\`ollama pull ${this.model}\`).`
              : `Check your OPENAI_API_KEY in backend/.env.`;
        throw new Error(`LLM error: ${err?.message ?? 'unknown'}. ${hint}`);
      }
    }

    // Should never reach here but TypeScript needs a return
    throw new Error(
      `LLM error (exhausted retries): ${lastErr?.message ?? 'unknown'}`,
    );
  }

  async *chatStream(
    messages: LlmMessage[],
    options: LlmOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    const { temperature = 0.2, maxTokens = 4096 } = options;
    const MAX_RETRIES = 3;
    let lastErr: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        });

        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content;
          if (token) {
            yield token;
          }
        }
        return;
      } catch (err: any) {
        lastErr = err;
        const status: number | undefined = err?.status ?? err?.response?.status;

        // Retry on 429 (rate-limit / quota) and 5xx with exponential backoff
        if (
          (status === 429 || (status && status >= 500)) &&
          attempt < MAX_RETRIES
        ) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
          this.logger.warn(
            `LLM stream ${status} — retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`,
          );
          await sleep(delay);
          continue;
        }

        // Non-retryable or exhausted retries
        this.logger.error(`LLM stream failed (${this.provider})`, err?.message);
        const hint =
          status === 429
            ? `OpenAI quota exceeded. Consider switching to Ollama (set ENABLE_OLLAMA=true in backend/.env) or upgrading your OpenAI plan.`
            : this.provider === 'ollama'
              ? `Ensure Ollama is running and the model "${this.model}" is pulled (\`ollama pull ${this.model}\`).`
              : `Check your OPENAI_API_KEY in backend/.env.`;
        throw new Error(
          `LLM stream error: ${err?.message ?? 'unknown'}. ${hint}`,
        );
      }
    }

    // Should never reach here but TypeScript needs a return
    throw new Error(
      `LLM stream error (exhausted retries): ${lastErr?.message ?? 'unknown'}`,
    );
  }

  getProvider(): string {
    return this.provider;
  }

  getModel(): string {
    return this.model;
  }
}
