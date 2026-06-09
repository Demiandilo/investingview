FROM node:20-alpine

WORKDIR /app

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Remove .env if accidentally copied (secrets come from Fly secrets)
RUN rm -f .env

EXPOSE 3000

CMD ["node", "server.js"]
