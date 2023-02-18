"use strict";
const { start, dispatch, spawn } = require("nact");
const MQTT = require("async-mqtt");
const { DateTime } = require("luxon");
const {
  AsyncRequest,
  FindPort,
  InitRequestAgent,
  StartScan,
  OperationError,
} = require("./messages");
const { logger } = require("./logging");

const MQTT_BLE_REQUESTS = "ble/requests";
const MQTT_BLE_RESPONSES = "ble/responses";
const MQTT_HOST = "emqx";
const MQTT_PORT = "1883";
const EDGEWARE_CLIENT = "edgeware";

async function getRequestPromise(request, portAgent) {
  return new Promise((resolve, reject) => {
    const req = new AsyncRequest(request.args, resolve, reject);
    dispatch(portAgent, req);
  });
}

function getReplyChannel(mqttClient, packet) {
  return async (res) => {
    let responseTopic = packet.properties?.responseTopic || MQTT_BLE_RESPONSES;
    let correlationData = packet.properties?.correlationData || "";
    let payloadFormatIndicator = true;
    let contentType = "application/json";
    logger.debug(`Publishing: ${res}`);
    await mqttClient.publish(responseTopic, JSON.stringify(res.payload), {
      qos: 1,
      properties: {
        correlationData,
        payloadFormatIndicator,
        contentType,
      },
    });
  };
}

async function getMqttClient() {
  return await MQTT.connectAsync(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
    clientId: EDGEWARE_CLIENT,
    username: "",
    password: "",
    protocolVersion: 5,
  });
}

async function updateRequestAgent(state = { mqttClient: undefined }, msg, ctx) {
  try {
    if (msg instanceof InitRequestAgent) {
      if (!state.mqttClient) {
        state.mqttClient = await getMqttClient();
        await state.mqttClient.subscribe(MQTT_BLE_REQUESTS, { qos: 1 });
        state.mqttClient.on("message", (topic, data, packet) => {
          const replyChannel = getReplyChannel(state.mqttClient, packet);
          const payload = JSON.parse(data.toString());
          const request = new AsyncRequest(payload, replyChannel, replyChannel);
          dispatch(ctx.self, request);
        });
        let portAgent = ctx.children.get("blePortAgent");
        dispatch(portAgent, state.mqttClient);
        dispatch(portAgent, new FindPort());
        dispatch(portAgent, new StartScan());
      }
    } else if (msg instanceof AsyncRequest) {
      try {
        if (!isValidCommand(msg.args)) {
          msg.reject(
            new OperationError({ statusCode: 400, reason: "Bad request" })
          );
        } else if (isExpired(msg.args)) {
          reject(
            new OperationError({ statusCode: 400, reason: "Request expired" })
          );
        } else {
          let portAgent = ctx.children.get("blePortAgent");
          let res = await getRequestPromise(msg, portAgent);
          msg.resolve(res);
        }
      } catch (err) {
        msg.reject(err);
      }
    }
    return state;
  } catch (e) {
    logger.error(`request agent crashed, exiting...`, e);
    process.exit(1);
  }
}

function isExpired(args) {
  let now = DateTime.utc().toMillis();
  return (
    args.timestamp &&
    args.expiryIntervalMs &&
    now > args.timestamp + args.expiryIntervalMs
  );
}

function isValidCommand(args) {
  if (args === undefined) {
    return false;
  }
  let address = toNoColonAddress(args.address);
  let writeHandleValid = isValidCharHandle(args.writeCharHandle);
  let notifyHandleValid =
    !args.notifyCharHandle || isValidCharHandle(args.notifyCharHandle);
  let writeDataValid = /^[0-9a-f]+$/i.test(args.writeData);
  return (
    address !== "" && writeHandleValid && notifyHandleValid && writeDataValid
  );
}

function isValidCharHandle(charHandle) {
  charHandle = charHandle?.toString() || "";
  return /^[0-9a-f]{4}$/i.test(charHandle);
}

function toNoColonAddress(address) {
  address = address?.toString().toLowerCase() || "";
  const regexColon =
    /^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/;
  const regexNoColon = /^[0-9a-f]{12}$/i;
  if (regexNoColon.test(address)) {
    return address;
  } else if (regexColon.test(address)) {
    return address.replace(/:/g, "");
  }
  return "";
}

module.exports = { updateRequestAgent, InitRequestAgent };
