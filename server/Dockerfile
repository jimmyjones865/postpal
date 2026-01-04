FROM node:alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Needed to drop privileges after fixing mounted volume permissions
RUN apk add --no-cache su-exec

# Ensure the runtime can chown the mounted volume, then run as node
USER root
EXPOSE 3001
CMD ["sh", "/app/entrypoint.sh"]
