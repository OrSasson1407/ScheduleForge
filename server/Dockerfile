# Small, production image for the server described in index.js's header:
# the collaboration relay plus the accounts/places/publishing API. Multi-stage
# only in the sense that it installs with dev tooling excluded - there is no
# build step, this is plain CommonJS Node.

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY db.js errorTracking.js index.js log.js rateLimit.js store.js ./

ENV NODE_ENV=production
EXPOSE 8787

# Render (and most platforms) probe this before sending traffic; also usable
# directly with `docker run --health-cmd`.
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "require('http').get('http://localhost:8787/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "index.js"]
