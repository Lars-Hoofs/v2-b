# Stage 1: Build the application
FROM node:20-slim AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Copy the rest of the application source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the TypeScript source code
RUN npm run build

# Stage 2: Create the production image
FROM node:20-slim AS production
WORKDIR /app

# Set NODE_ENV to production
ENV NODE_ENV=production

# Install OpenSSL
RUN apt-get update -y && apt-get install -y openssl

# Copy built files from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]
