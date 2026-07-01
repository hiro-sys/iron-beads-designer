# Bead Pattern Maker

**English** | [日本語](./README.ja.md)

A web application that automatically generates Perler Beads / Nano Beads patterns — either from an uploaded image, or from a text prompt using Google Gemini AI. All processing runs entirely in the browser (the optional AI prompt mode sends only your prompt text to the Gemini API).

## Features

- Two input modes, switchable at any time: generate a pattern from an **uploaded image** or from an **AI prompt** (text only)
- Image upload (JPEG / PNG / GIF / WebP, up to 10 MB, drag & drop supported)
- Automatic conversion to Perler Beads (100 colors) / Nano Beads (55 colors) using nearest-color matching based on CIE76 color difference
- AI prompt generation powered by Google Gemini (BYOK): enter your own Google AI Studio API key, choose a Gemini model (grouped by free-tier availability), type a prompt (e.g. "cat", "heart", "star"), and Gemini generates the pixel-art pattern directly — no image upload needed. Only the prompt text is sent to the Gemini API
- API keys are kept in memory for the current session only; they are never persisted (no localStorage / sessionStorage / cookies) and are cleared on reload
- Plate configuration (1×1 to 10×10) with recommended size suggestions
- Background removal, color-count limiting / reduction, and selectable resize method / fit mode
- Manual pattern editing (with drag-to-paint continuous editing)
- Used-color list display and PNG image export

## Tech Stack

- Vanilla JavaScript (ES modules)
- Vite (build tool)
- HTML5 Canvas API
- Google Gemini API (optional AI prompt generation, BYOK — no backend involved)
- Vitest + fast-check (testing)

## Directory Structure

This repository uses a monorepo structure. The application itself lives in the `bead-pattern-maker/` directory.

## Setup

```bash
cd bead-pattern-maker
npm install
```

## Development

```bash
cd bead-pattern-maker
npm run dev      # Start the development server
npm run build    # Production build (outputs to dist/)
npm run preview  # Preview the build output
npm test         # Run tests
```

## Deployment

Hosted on AWS Amplify Hosting. The `amplify.yml` at the repository root defines the build settings for this monorepo structure (`appRoot: bead-pattern-maker`).

### Security headers

The `customHttp.yml` file at the repository root defines HTTP security headers (Content-Security-Policy, HSTS, X-Frame-Options, etc.) that AWS Amplify Hosting applies automatically on every deployment, including the very first one — no manual console configuration is required. If you fork this project and change the Gemini API endpoint or add other external resources, update the `connect-src` directive in the `Content-Security-Policy` header accordingly.

## License

See [LICENSE](./LICENSE).

## Disclaimer

### Unofficial notice
This application is an unofficial, fan-made tool developed by an individual. It is not affiliated with, endorsed by, or associated with Kawada Co., Ltd. ("Kawada") or any related companies in any way. "Perler Beads" (パーラービーズ) and "Nano Beads" (ナノビーズ) are registered trademarks of Kawada.

### Inquiries
Please do NOT contact Kawada Co., Ltd. or any official support channels regarding the specifications, behavior, or issues of this application. If you encounter any problem, please open an Issue in this repository or contact the developer directly.

### Limitation of liability
The developer assumes no responsibility for any damage or trouble (including, but not limited to, issues arising from created patterns or malfunctions of your PC or devices) resulting from the use of, or inability to use, this application. Use it entirely at your own risk.
