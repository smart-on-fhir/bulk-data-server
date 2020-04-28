FROM node:9

WORKDIR /app

ENV NODE_ENV      "production"
ENV PORT "9443"
ENV BASE_URL      "http://localhost:9443"

# Install and cache
COPY package.json      /tmp/package.json
COPY package-lock.json /tmp/package-lock.json
RUN cd /tmp && npm install --production
RUN mv /tmp/node_modules /app/node_modules

COPY . .

# You must use -p 9443:9443 when running the image
EXPOSE 9443

CMD ["node", ".", "-v", "4"]
