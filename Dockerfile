# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production server
FROM node:18-alpine
WORKDIR /app

# Install su-exec for entrypoint permission handling
RUN apk add --no-cache su-exec

# Copy server files
COPY server/package*.json ./
RUN npm install --production

COPY server/ ./

# Copy built frontend
COPY --from=frontend-builder /app/dist ./public

EXPOSE 3000

CMD ["sh", "/app/entrypoint.sh"]
