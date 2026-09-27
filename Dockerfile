# ---- Build aşaması ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ---- Çalışma aşaması ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
RUN mkdir -p data
VOLUME /app/data
EXPOSE 3000
CMD ["node", "dist/main.js"]
