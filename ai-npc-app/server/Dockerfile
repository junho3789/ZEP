FROM node:22-alpine
WORKDIR /app
COPY server.mjs admin.html package.json ./
RUN mkdir data && chown node:node data
USER node
ENV PORT=3000 PERSONA_FILE=/app/data/personas.json
EXPOSE 3000
CMD ["node", "server.mjs"]
