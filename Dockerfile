# ====================== BUILD STAGE ======================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install build deps only for this stage
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --production=false  # full install for potential build steps

COPY . .
# If you have any build step (e.g., TypeScript compile), run it here

# ====================== RUNTIME STAGE ======================
FROM node:20-alpine

WORKDIR /usr/src/app

# Install only runtime deps (much smaller)
COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# Copy only necessary files from builder
COPY --from=builder /usr/src/app/backend ./backend
COPY --from=builder /usr/src/app/models ./models
COPY --from=builder /usr/src/app/services ./services
# ... copy other required folders (routes, workers, etc.)

RUN mkdir -p logs && chown -R node:node /usr/src/app

USER node

EXPOSE 5000

# Better: use tini for proper signal handling if needed, but optional
CMD ["node", "app.js"]
