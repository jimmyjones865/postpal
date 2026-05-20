# Stage 1: Build frontend
FROM node:24-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production server (using slim for better compatibility)
FROM node:24-slim
WORKDIR /app

# Copy server files
COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/ ./

# Copy built frontend
COPY --from=frontend-builder /app/dist ./public

EXPOSE 3000

CMD ["node", "index.js"]
