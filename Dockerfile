# Multi-stage Dockerfile for ReddaMaten (React + Express)
# Stage 1 (builder): Install client deps and build React app with Vite
# Stage 2 (production): Install server deps only, copy built React output

FROM node:20-alpine AS builder

WORKDIR /build

COPY client/package*.json ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# --- Production stage ---
FROM node:20-alpine AS production

ARG SOURCE_COMMIT=dev
ENV SOURCE_COMMIT=$SOURCE_COMMIT
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY server.js ./

# Copy built frontend from builder
COPY --from=builder /build/client/dist ./client/dist

EXPOSE 3000

CMD ["node", "server.js"]
