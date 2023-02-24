FROM arm64v8/node:18.9.1

ENV NODE_ENV=production

RUN apt-get update
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get install -y \
    build-essential \
    libssl-dev \
    libboost-all-dev \
    libudev-dev \
    libusb-dev \
    python3 \
    udev

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

COPY ["./src", "./"]

CMD [ "node", "app.js" ]
