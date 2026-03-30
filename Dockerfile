# ====================== RUNTIME STAGE ======================
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy production dependencies from builder (best practice - avoids reinstalling)
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy package.json (for reference/scripts)
COPY --from=builder /usr/src/app/package.json ./

# Core app files (since app.js is in root)
COPY --from=builder /usr/src/app/app.js ./

# Main folders your code uses
COPY --from=builder /usr/src/app/models ./models
COPY --from=builder /usr/src/app/services ./services
COPY --from=builder /usr/src/app/routes ./routes
COPY --from=builder /usr/src/app/workers ./workers
COPY --from=builder /usr/src/app/utils ./utils
COPY --from=builder /usr/src/app/config ./config
COPY --from=builder /usr/src/app/middleware ./middleware

# Add any other root-level or subfolders your project actually has
# COPY --from=builder /usr/src/app/listeners ./listeners   # if you have separate listener files

# Create logs directory and set correct permissions
RUN mkdir -p logs && chown -R node:node /usr/src/app

# Security: non-root user
USER node

EXPOSE 5000

# CMD now points to root-level app.js
CMD ["node", "app.js"]
