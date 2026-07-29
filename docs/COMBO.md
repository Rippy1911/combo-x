# Combo voice

User-facing brand: **Combo voice** (wake phrase **"Hey Combo"**).

Full architecture, native daemon protocol, and build notes: [`JARVIS.md`](./JARVIS.md) (legacy filename — documents the voice stack including technical `hey_jarvis` wake assets and `jarvisd` native host).

Quick start:

- Vault: `azure_speech_key`, `azure_speech_region` (default `northeurope`)
- Chromium: **Start** on the Combo voice pill (needs `pnpm build:combo` for wake models)
- Any browser: **Test** for Azure TTS without mic
