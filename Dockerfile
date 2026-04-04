FROM registry.access.redhat.com/ubi9/nodejs-18:latest AS build
USER 0
WORKDIR /opt/app-root/src
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM registry.access.redhat.com/ubi9/nginx-122:latest
COPY --from=build /opt/app-root/src/dist /opt/app-root/src
COPY nginx.conf /etc/nginx/nginx.conf
ENTRYPOINT ["nginx", "-g", "daemon off;"]
