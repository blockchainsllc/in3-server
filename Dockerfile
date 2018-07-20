FROM node:8

WORKDIR /app

# allowing docker to access the private repo
ARG SSH_PRIVATE_KEY
RUN mkdir /root/.ssh/
RUN echo "${SSH_PRIVATE_KEY}" > /root/.ssh/id_rsa
RUN chmod 600 /root/.ssh/id_rsa
RUN ssh-keyscan -t rsa github.com > ~/.ssh/known_hosts


# install deps
COPY package.json ./
RUN npm install

# compile src
COPY tsconfig.json  ./
COPY src  ./src/
COPY contracts  ./contracts/
RUN npm run build

# clean up
# pruning does not work with git-modules, so we can use it when the repo is public
# RUN npm prune --production 
RUN rm -rf src tsconfig.json /root/.ssh/id_rsa

# setup ENTRYPOINT
EXPOSE 8500
ENTRYPOINT ["node", "js/server/server.js"]




