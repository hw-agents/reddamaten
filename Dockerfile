FROM node:20-alpine

WORKDIR /app

# Install backend deps
COPY package.json ./
RUN npm install

# Build frontend
COPY client/package.json ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# Copy backend
COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
