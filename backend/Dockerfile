FROM node:20-alpine

WORKDIR /app

# Build tools needed to compile better-sqlite3's native addon on alpine/musl
RUN apk add --no-cache python3 make g++

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Remove .env if accidentally copied (secrets come from Fly secrets)
RUN rm -f .env

EXPOSE 3000

CMD ["node", "server.js"]
