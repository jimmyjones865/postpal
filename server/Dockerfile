FROM node:alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

# Run as non-root user (node user comes with node:alpine)
USER node

EXPOSE 3001
CMD ["node", "index.js"]
