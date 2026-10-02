FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DOCKER_DEV=true

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .

EXPOSE 3000 4000 9000 9099 9199

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["npm","run","dev"]
