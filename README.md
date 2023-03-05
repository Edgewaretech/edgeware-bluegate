## BLUEGATE by EDGEWARE TECH

_work in progress - more to come soon!_

Open source bidirectional Bluetooth Low Energy gateway for Raspberry Pi

Now you can talk to your BLE sensors and actuators by sending simple JSON messages over MQTT!

The gateway is bidirectional: it can listen passively to BLE advertisements but you can also make connections to your sensors and read/write to BLE services and characteristics.

### Requirements

1. Raspberry Pi with 64 bit Ubuntu installed. We recommend Raspberry PI 4 but it should run on Pi 3 and Pi Zero 2 as well.
2. Minimum 500MB RAM.
3. [BleuIO BLE USB dongle](https://www.bleuio.com/). The Gateway does not use built-in BLE so you will need to get the dongle. At the moment it has been tested only with firmware version 2.2.1. Watch this space for updates.

### How to set it up

You will need to be familiar with basic Raspberry Pi usage. There are many online resources for beginners so we will jump straight to the gateway setup.

Follow these steps:

1. Flash **64 bit** Ubuntu using [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Ssh to your Pi and install required software by running this code:

```
sudo apt-get update
sudo apt-get install \
    ca-certificates \
    curl \
    gnupg \
    lsb-release
sudo mkdir -m 0755 -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io -y
sudo usermod -aG docker $USER
mkdir edgeware
cd edgeware
wget https://raw.githubusercontent.com/Edgewaretech/edgeware-bluegate/v1.0.0/docker-compose.yml
sudo docker compose up -d
```

Once done you should have 4 Docker containers running on your Pi: Bluegate, Node-Red, InfluxDB and EMQX (MQTT).
You can verify that by running:

```
sudo docker ps
```

Assuming you are on the same local network as your Pi, you can now go to your browser and open ubuntu.local:18083
Log in with user _admin_ and password _public_

Change the password if asked and go to [web sockets](http://ubuntu.local:18083/#/websocket). You can now subscribe to MQTT topic _ble/adv_ and see all advertisements from nearby BLE sensors.

If you want to capture only your own sensors advertisements then run this in your Pi:

```
sudo nano ~/edgeware/docker-compose.yml
```

Scroll down and change the line

```
  ALLOWED_ADDRESSES: "*" # or limit to your own sensor mac addresses e.g.: "aabbccddeeff;bbaaccddeeff"
```

so that it has a list of only your sensor MAC addresses. There should be a semicolon between addresses, no colons and only lowercase letters.
