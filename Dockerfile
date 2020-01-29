###############################################################################
# This file is part of the Incubed project.
# Sources: https://github.com/slockit/in3-server
# 
# Copyright (C) 2018-2019 slock.it GmbH, Blockchains LLC
# 
# 
# COMMERCIAL LICENSE USAGE
# 
# Licensees holding a valid commercial license may use this file in accordance 
# with the commercial license agreement provided with the Software or, alternatively, 
# in accordance with the terms contained in a written agreement between you and 
# slock.it GmbH/Blockchains LLC. For licensing terms and conditions or further 
# information please contact slock.it at in3@slock.it.
# 	
# Alternatively, this file may be used under the AGPL license as follows:
#    
# AGPL LICENSE USAGE
# 
# This program is free software: you can redistribute it and/or modify it under the
# terms of the GNU Affero General Public License as published by the Free Software 
# Foundation, either version 3 of the License, or (at your option) any later version.
#  
# This program is distributed in the hope that it will be useful, but WITHOUT ANY 
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A 
# PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
# [Permissions of this strong copyleft license are conditioned on making available 
# complete source code of licensed works and modifications, which include larger 
# works using a licensed work, under the same license. Copyright and license notices 
# must be preserved. Contributors provide an express grant of patent rights.]
# You should have received a copy of the GNU Affero General Public License along 
# with this program. If not, see <https://www.gnu.org/licenses/>.
###############################################################################



FROM node:12-alpine AS build

WORKDIR /app

ARG NPM_REGISTRY_TOKEN
ARG CI_COMMIT_SHA
ENV VERSION_SHA=$CI_COMMIT_SHA


ADD . .
# temporarily install dependencies for building packages
#RUN apt-get update && apt-get install -y build-essential python g++ cmake \
RUN apk -U add build-base python \
    && npm install \
    && npm run build

FROM node:12-alpine
WORKDIR /app
COPY --from=build /app/js /app/js
COPY --from=build /app/contracts /app/contracts
COPY --from=build /app/node_modules/in3-contracts/contracts/* /app/contracts/
COPY --from=build /app/node_modules /app/node_modules
# setup ENTRYPOINT
EXPOSE 8500
ENTRYPOINT ["node", "js/src/server/server.js"]