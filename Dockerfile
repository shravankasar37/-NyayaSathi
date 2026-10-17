# NyayaSathi on Render's free tier (512 MB). Production retrieval uses Gemini embeddings (EMBED_PROVIDER=gemini),
# falling back to BM25; the local ONNX embedder (~420 MB RAM) is for offline development only.
# API keys come from environment variables (GROQ_API_KEY, GEMINI_API_KEY), never from the image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 EMBED_PROVIDER=gemini PORT=10000
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 10000
CMD ["sh", "-c", "node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT}"]
