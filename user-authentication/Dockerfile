FROM node:16-alpine

WORKDIR /usr/src/app

COPY package*.json ./

# Install dependencies and bcrypt
RUN apk add --no-cache make gcc g++ python3 && \
    npm install && \
    npm rebuild bcrypt --build-from-source && \
    apk del make gcc g++ python3

COPY . .

EXPOSE 3002

CMD ["node", "index.js"]