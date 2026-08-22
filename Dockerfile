FROM node:22.5.1-bookworm-slim
WORKDIR /app
COPY . .
USER node
EXPOSE 7411
CMD ["node", "server.mjs"]
