FROM node:18-alpine

WORKDIR /app

# Install su-exec for entrypoint permission handling
RUN apk add --no-cache su-exec

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

COPY . .

USER root
EXPOSE 3001
CMD ["sh", "/app/entrypoint.sh"]
