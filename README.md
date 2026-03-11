# ⚡ Codebase Intelligence Tool (CIT)

A full-stack web application that ingests GitHub repositories, auto-generates architecture documentation, and provides a conversational RAG (Retrieval-Augmented Generation) interface to help developers understand codebases.

## Architecture

```
CIT/
├── backend/         NestJS API (port 4001)
│   └── src/
│       ├── ingestion/   Clone, parse & embed repos
│       ├── query/       Semantic search + LLM
│       ├── repos/       File tree & content serving
│       ├── history/     SQLite conversations & bookmarks
│       ├── archdoc/     Auto-generate architecture docs
│       └── shared/      Embeddings, ChromaDB, SQLite
├── frontend/        Next.js App Router (port 4000)
│   └── src/
│       ├── app/         Pages (chat, repos, history, arch)
│       ├── components/  UI components
│       └── lib/         Typed API client
└── docker-compose.yml   One-command setup
```

## Prerequisites

- Node.js ≥ 20
- [ChromaDB](https://docs.trychroma.com/) running locally (`pip install chromadb && chroma run`)
- OpenAI API key **or** [Ollama](https://ollama.com/) running locally

## Quick Start (Docker)

The fastest way to get CIT running — one command starts everything:

```bash
# 1. Copy the example env and edit as needed
cp .env.example .env

# 2. Launch all services
docker compose up --build
```

This starts **ChromaDB**, the **NestJS backend** (port 4001), and the **Next.js frontend** (port 4000).

> **Using Ollama?** Ollama must be running on the host. The Docker setup uses `host.docker.internal` to reach it.

## Quick Start (Manual)

```bash
# 1. Install all dependencies
cd backend && npm install --legacy-peer-deps
cd ../frontend && npm install
cd ..

# 2. Configure environment
# Edit backend/.env and set OPENAI_API_KEY (or enable Ollama)

# 3. Start ChromaDB (in a separate terminal)
chroma run --host localhost --port 8000

# 4. Start both servers
npm run start          # uses concurrently

# Or individually:
npm run start:backend  # http://localhost:4001
npm run start:frontend # http://localhost:4000
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
| Embeddings | OpenAI / Ollama (nomic-embed-text) |
| LLM | OpenAI GPT / Ollama |
| Code Parsing | tree-sitter (TS, JS, Python) |
| Persistence | SQLite (better-sqlite3) |
| Frontend | Next.js (App Router) |
| Styling | Vanilla CSS — dark theme |
| Containerization | Docker Compose |
