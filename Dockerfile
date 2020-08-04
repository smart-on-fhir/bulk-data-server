FROM node:9

WORKDIR /app

ENV NODE_ENV "production"
ENV PORT "9444"
ENV SERVER_BASE_URL "http://10.14.196.25"

# Install and cache
COPY package.json      /tmp/package.json
COPY package-lock.json /tmp/package-lock.json
RUN cd /tmp && npm install --production
RUN mv /tmp/node_modules /app/node_modules

COPY . .

# You must use -p 9444:9444 when running the image
EXPOSE 9444

CMD ["node", ".", "-v", "4"]
