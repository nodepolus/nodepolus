FROM node:15.12.0-alpine3.13

USER node

WORKDIR /usr/src/nodepolus

ARG NPM_AUTH_TOKEN

EXPOSE 22023/udp \
       22024/udp

ENV NODE_ENV=development \
    NP_LOG_LEVEL=info \
    NP_DISABLE_COLORS=true

COPY --chown=node:node .npmrc_docker \
                       ./.npmrc
COPY --chown=node:node package.json \
                       package-lock.json \
                       tsconfig.json \
                       ./
COPY --chown=node:node bin \
                       ./bin

RUN ["npm", "ci"]

ENTRYPOINT ["npm", "start"]
