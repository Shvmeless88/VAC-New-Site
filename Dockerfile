# Vehicle Approval Centre — production container for Cloud Run
FROM node:22-slim

WORKDIR /app

# Install dependencies (legacy-peer-deps because pannellum-react pins React 16)
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

# Copy source and build the frontend into dist/
COPY . .
RUN npm run build

# Production runtime: server.ts serves dist/ and the API, listening on $PORT
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
