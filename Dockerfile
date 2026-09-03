# TrueHumanNature — production image
FROM node:20-alpine

WORKDIR /app

# Install production deps only (express + sharp for image sanitizing).
COPY package*.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# Persist data to a mounted volume in production (see DEPLOY.md).
ENV DATA_DIR=/data
VOLUME ["/data"]
# Set at run time (see DEPLOY.md), never baked into the image:
#   SESSION_SECRET  stable logins across restarts
#   PHOTO_KEY       encrypts stored photos — keep it OUT of the /data volume,
#                   or a copied volume carries its own key
#   ADMIN_EMAILS    who can approve photos; without it nothing goes live

EXPOSE 3000
CMD ["node", "server.js"]
