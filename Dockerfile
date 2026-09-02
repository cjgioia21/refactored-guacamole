# TrueHumanNature — production image
FROM node:20-alpine

WORKDIR /app

# Install production deps only (express).
COPY package*.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# Persist data to a mounted volume in production (see DEPLOY.md).
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "server.js"]
