#***********************************************************
# This file is part of the Slock.it IoT Layer.             *
# The Slock.it IoT Layer contains:                         *
#   - USN (Universal Sharing Network)                      *
#   - INCUBED (Trustless INcentivized remote Node Network) *
#***********************************************************
# Copyright (C) 2016 - 2018 Slock.it GmbH                  *
# All Rights Reserved.                                     *
#***********************************************************
# You may use, distribute and modify this code under the   *
# terms of the license contract you have concluded with    *
# Slock.it GmbH.                                           *
# For information about liability, maintenance etc. also   *
# refer to the contract concluded with Slock.it GmbH.      *
#***********************************************************
# For more information, please refer to https://slock.it   *
# For questions, please contact info@slock.it              *
#**********************************************************/

FROM node:12

WORKDIR /app

ARG NPM_REGISTRY_TOKEN
ARG CI_COMMIT_SHA

ENV VERSION_SHA=$CI_COMMIT_SHA
#ENV IN3_SRC_PATH='./js'

#COPY tsconfig.json  ./
#COPY src  ./src/
#COPY contracts  ./contracts/
#COPY package.json ./
#COPY package-lock.json ./
ADD . .
# temporarily install dependencies for building packages
RUN apt-get update && apt-get install -y build-essential python g++ cmake && echo "//npm.slock.it/:_authToken=\"$NPM_REGISTRY_TOKEN\"" > ~/.npmrc \
    && npm set registry https://npm.slock.it \
    && npm install \
    && npm run build
# setup ENTRYPOINT
EXPOSE 8500
ENTRYPOINT ["node", "js/src/server/server.js"]