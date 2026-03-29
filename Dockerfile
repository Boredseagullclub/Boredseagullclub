# 1. Use Node LTS Alpine for a small, secure footprint
FROM node:20-alpine

# 2. Install build dependencies (needed for some crypto/decimal libs if they compile from source)
RUN apk add --no-cache python3 make g++

# 3. Create app directory
WORKDIR /usr/src/app

# 4. Install dependencies first (leverages Docker caching)
COPY package*.json ./
RUN npm install --production

# 5. Copy the rest of your application code
COPY . .

# 6. Create a logs directory and give the node user permission to write to it
# This is crucial for your Pino logger to work in production
RUN mkdir -p logs && chown -R node:node /usr/src/app

# 7. Security: Run as a non-privileged user
USER node

# 8. Expose the API port
EXPOSE 5000

# 9. The default command (Overridden by docker-compose for workers)
CMD ["node", "app.js"]
