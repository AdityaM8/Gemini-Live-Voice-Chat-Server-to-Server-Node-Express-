import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Thin wrapper over the Gemini Live websocket. All browser audio/text streams
 * are proxied through here so API keys and traffic stay server-side.
 */
export class GeminiLiveSession {
  constructor({ apiKey, model, systemPromptPath }) {
    this.apiKey = apiKey;
    this.model = model;
    this.systemPromptPath = systemPromptPath;
    this.ws = null;
    this.isOpen = false;
  }

  async connect() {
    if (this.ws) return;

    // Confirm URL and headers against latest docs.
    // Typical live endpoint (subject to change):
    // wss://generativelanguage.googleapis.com/v1beta/live:connect?key=API_KEY
    const url = `wss://generativelanguage.googleapis.com/v1beta/live:connect?key=${encodeURIComponent(this.apiKey)}`;

    this.ws = new WebSocket(url, {
      // Some SDKs require an Authorization bearer header instead of query param.
      // headers: { Authorization: `Bearer ${this.apiKey}` }
      perMessageDeflate: false,
    });

    this.ws.on('open', async () => {
      this.isOpen = true;
      const system = await fs.readFile(this.systemPromptPath, 'utf8');

      // Initial setup message: choose model and system instruction
      const setup = {
        setup: {
          model: this.model,
          // Attach system prompt
          instructions: system,
          // Let the model speak back (TTS)
          response: { modalities: ["AUDIO", "TEXT"], audio: { format: "pcm_s16le", sampleRateHertz: 16000 } }
        }
      };
      this.ws.send(JSON.stringify(setup));
    });
  }

  /**
   * Send a full-duplex frame to Gemini. The frame can contain audio chunks,
   * text input, or control messages like interruptions.
   */
  send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  on(event, cb) { this.ws?.on(event, cb); }
  close() { try { this.ws?.close(); } catch (_) {} }
}