FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV DATA_DIR=/data
EXPOSE 8788
CMD ["node", "server.mjs"]
