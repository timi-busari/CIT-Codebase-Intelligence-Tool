# ⚡ Codebase Intelligence Tool (CIT)

A full-stack web application that ingests GitHub repositories, auto-generates architecture documentation, and provides a conversational RAG (Retrieval-Augmented Generation) interface to help developers understand codebases.

## Architecture

```
CIT/
├── backend/         NestJS API (port 3001)
│   └── src/
│       ├── ingestion/   Clone, parse & embed repos
│       ├── query/       Semantic search + OpenAI
│       ├── repos/       File tree & content serving
│       ├── history/     SQLite conversations & bookmarks
│       ├── archdoc/     Auto-generate architecture docs
│       └── shared/      Embeddings, ChromaDB, SQLite
└── frontend/        Next.js 14 App Router (port 3000)
    └── src/
        ├── app/         Pages (chat, repos, history, arch)
        ├── components/  UI components
        └── lib/         Typed API client
```

## Prerequisites

- Node.js ≥ 20
- [ChromaDB](https://docs.trychroma.com/) running locally (`pip install chromadb && chroma run`)
- OpenAI API key

## Quick Start

```bash
# 1. Install all dependencies
cd backend && npm install
cd ../frontend && npm install
cd ..

# 2. Configure environment
# Edit backend/.env and set OPENAI_API_KEY

# 3. Start ChromaDB (in a separate terminal)
chroma run --host localhost --port 8000

# 4. Start both servers
npm run start          # uses concurrently

# Or individually:
npm run start:backend  # http://localhost:3001
npm run start:frontend # http://localhost:3000
```

## Backend API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ingest` | Start repo ingestion |
| GET | `/api/ingest/status/:jobId` | Poll job status |
| GET | `/api/repos` | List ingested repos |
| GET | `/api/repos/:id/files` | File tree |
| GET | `/api/repos/:id/file?path=` | File content |
| DELETE | `/api/repos/:id` | Delete repo |
| POST | `/api/query` | Ask a question (RAG) |
| GET | `/api/conversations` | List conversations |
| POST | `/api/conversations` | Save conversation |
| POST | `/api/bookmarks` | Bookmark Q&A |
| GET | `/api/bookmarks` | List bookmarks |
| POST | `/api/repos/:id/architecture` | Generate arch docs |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | NestJS (TypeScript) |
| Vector DB | ChromaDB |
| Embeddings | @xenova/transformers — all-MiniLM-L6-v2 |
| LLM | OpenAI GPT API |
| Persistence | SQLite (better-sqlite3) |
| Frontend | Next.js 14 App Router |
| Styling | Vanilla CSS — dark theme |
