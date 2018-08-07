FROM node:8

WORKDIR /app

ARG NPM_REGISTRY_TOKEN

COPY tsconfig.json  ./
COPY src  ./src/
COPY contracts  ./contracts/
COPY package.json ./

# allowing docker to access the private repo
RUN echo "//npm.slock.it/:_authToken=\"$NPM_REGISTRY_TOKEN\"" > ~/.npmrc \
    && npm set registry https://npm.slock.it \
    && npm install \
    && rm ~/.npmrc

# compile src
RUN npm run build

# clean up
# pruning does not work with git-modules, so we can use it when the repo is public
RUN npm prune --production 
RUN rm -rf src tsconfig.json ~/.npmrc

# setup ENTRYPOINT
EXPOSE 8500
ENTRYPOINT ["node", "js/server/server.js"]




