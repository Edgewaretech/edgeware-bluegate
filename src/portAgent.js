"use strict";
const { start, dispatch, spawn } = require("nact");
const MQTT = require("async-mqtt");
const {
  findBlePort,
  setupBlePort,
  parser,
  startScanning,
  writeAndDrain,
} = require("./blePort");

const {
  UartRequest,
  UartResponse,
  AsyncRequest,
  AsyncResult,
  PortClosed,
  FindPort,
  StartScan,
  OperationError,
} = require("./messages");

const { logger } = require("./logging");
const {
  parseScanResponse,
  ParsedScanComplete,
  ParsedBleuioError,
  ParsedAdvRssiData,
  ParsedTimeout,
  ParsedConnected,
  ParsedReconnecting,
  ParsedDisconnected,
  ParsedUpdatedCI,
  ParsedDataWritten,
  ParsedWriteCompleted,
  ParsedATCommand,
  ParsedWrittenSize,
  ParsedNotificationReceived,
  ParsedNotificationHexData,
  ParsedAsciiData,
  parseLine,
} = require("./bleParser");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firmwareRegex = /Firmware Version: (\d+\.\d+\.\d+)/;
const VER_2_1_0 = "2.1.0";
const VER_2_1_3 = "2.1.3";
const VER_2_2_1 = "2.2.1";
const VERSIONS = [VER_2_1_0, VER_2_1_3, VER_2_2_1];
const MQTT_BLE_ADV = "ble/adv";
const MIN_INTERVAL = 30;
const MAX_INTERVAL = 30;
const SLAVE_LATENCY = 0;
const SUPERVISION_TIMEOUT = 1000;
const TIMEOUT = "Timeout";
const MTU = 20;
const removeNonAscii = (s) => s.replace(/[^\x20-\x7E]/g, "");
const desiredProps = {
  waitConnectMs: 1000,
  waitForBleuioMs: 1000,
  waitNotificationsMs: 1000,
};

function getAllowedAddresses() {
  let env = process.env.ALLOWED_ADDRESSES || "*";
  return env.split(";");
}

async function mqttPublishAdv(mqttClient, payload) {
  let payloadFormatIndicator = true;
  let contentType = "application/json";
  await mqttClient.publish(MQTT_BLE_ADV, JSON.stringify(payload), {
    qos: 1,
    properties: { payloadFormatIndicator, contentType },
  });
}

function tryConnect(request, agent) {
  let args = request.args;
  let waitConnectMs = desiredProps.waitConnectMs;
  const minInterval = MIN_INTERVAL;
  const maxInterval = MAX_INTERVAL;
  const slaveLatency = SLAVE_LATENCY;
  const supervisionTimeout = SUPERVISION_TIMEOUT;
  const addressType = "1";
  const colonAddress = toColonAddress(args.address);

  dispatch(
    agent,
    new UartRequest(
      `AT+GAPCONNECT=[${addressType}]${colonAddress}=${minInterval}:${maxInterval}:${slaveLatency}:${supervisionTimeout}:\r`
    )
  );
  request.isConnecting = true;
  request.isConnected = false;
  request.connectTimeout = setTimeout(() => {
    dispatch(agent, new UartRequest("AT+CANCELCONNECT\r"));
    dispatch(agent, new UartResponse(TIMEOUT));
  }, waitConnectMs);
}

async function handleNewUartLine(line, agent, state) {
  let request = state.request;
  let args = request.args;
  let hasNotify = args.notifyCharHandle !== undefined;
  let mtu = args.mtu || MTU;
  let waitConnectMs = args.waitConnectMs || desiredProps.waitConnectMs;
  let waitNotificationsMs =
    args.waitNotificationsMs || desiredProps.waitNotificationsMs;
  let parsedLine = parseLine(line);

  if (parsedLine instanceof ParsedTimeout) {
    if (hasNotify && request.awaitingNotificationData) {
      dispatch(agent, new UartRequest(`AT+GAPDISCONNECT\r`));
    } else {
      request?.reject(
        new OperationError({ statusCode: 500, reason: "Ble connect timeout" })
      );
      state.request = undefined;
      dispatch(agent, new StartScan());
    }
  } else if (parsedLine instanceof ParsedConnected) {
    request.isConnecting = false;
    request.isConnected = true;
    clearTimeout(request.connectTimeout);
    if (hasNotify && !request.isSubscribing) {
      let notifyCharHandle = args.notifyCharHandle;
      await delay(50);
      dispatch(agent, new UartRequest(`AT+SETNOTI=${notifyCharHandle}\r`));
      request.writeData = args.writeData;
      request.isSubscribing = true;
    }
  } else if (parsedLine instanceof ParsedReconnecting) {
    request.isConnecting = true;
    request.isConnected = false;
    if (hasNotify) {
      request.isSubscribing = false;
    }
  } else if (parsedLine instanceof ParsedDisconnected) {
    if (request.isConnected) {
      if (request.result) {
        request.resolve(request.result);
        state.request = undefined;
        dispatch(agent, new StartScan());
      } else if (request.notifications) {
        request.resolve(
          new AsyncResult({
            statusCode: 200,
            result: { notifications: request.notifications },
          })
        );
        state.request = undefined;
        dispatch(agent, new StartScan());
      } else if (state.firmware === VER_2_2_1) {
        logger.debug(`Lost connection. Retrying...`);
        request.isConnecting = true;
        request.isConnected = false;
        if (hasNotify) {
          request.isSubscribing = false;
        }
        await delay(50);
        const minInterval = MIN_INTERVAL;
        const maxInterval = MAX_INTERVAL;
        const slaveLatency = SLAVE_LATENCY;
        const supervisionTimeout = SUPERVISION_TIMEOUT;
        const addressType =
          args.isPublicAddress && args.isPublicAddress === true ? "0" : "1";
        const colonAddress = toColonAddress(args.address);
        dispatch(
          agent,
          new UartRequest(
            `AT+GAPCONNECT=[${addressType}]${colonAddress}=${minInterval}:${maxInterval}:${slaveLatency}:${supervisionTimeout}:\r`
          )
        );
        request.connectTimeout = setTimeout(() => {
          dispatch(agent, new UartRequest("AT+CANCELCONNECT\r"));
          dispatch(agent, new UartResponse(TIMEOUT));
        }, waitConnectMs);
      }
      //else if (state.firmware === VER_2_1_3) {
      //  dispatch(agent, new UartResponse(TIMEOUT));
      //}
    }
  } else if (
    parsedLine instanceof ParsedUpdatedCI &&
    !hasNotify &&
    !request.writeRequested
  ) {
    let charHandle = args.writeCharHandle;
    let data = args.writeData;
    await delay(50);
    dispatch(
      agent,
      new UartRequest(`AT+GATTCWRITEWRB=${charHandle} ${data}\r`)
    );
    request.writeRequested = true;
  } else if (parsedLine instanceof ParsedDataWritten && !hasNotify) {
    request.writeComplete = true;
    request.result = new AsyncResult({ statusCode: 200 });
    await delay(350); // needed for puck IR only?
    dispatch(agent, new UartRequest(`AT+GAPDISCONNECT\r`));
  } else if (parsedLine instanceof ParsedWriteCompleted && hasNotify) {
    if (request.isSubscribing) {
      request.isSubscribing = false;
      request.awaitingNotificationData = true;
      request.notifications = [];
      request.notificationTimeout = setTimeout(() => {
        dispatch(agent, new UartResponse(TIMEOUT));
      }, waitNotificationsMs);
    }
    let writeCharHandle = args.writeCharHandle;
    let data = request.writeData.substr(0, 2 * mtu);
    if (data !== "") {
      dispatch(
        agent,
        new UartRequest(`AT+GATTCWRITEB=${writeCharHandle} ${data}\r`)
      );
    }
    request.writeData = request.writeData.substr(2 * mtu);
  } else if (
    parsedLine instanceof ParsedNotificationReceived &&
    hasNotify &&
    !request.awaitingNotificationData
  ) {
  } else if (
    parsedLine instanceof ParsedNotificationHexData &&
    request.awaitingNotificationData
  ) {
    let notification = parsedLine.data;
    request.notifications.push(notification);
    if (
      (args.lastNotification && notification === args.lastNotification) ||
      (args.maxNotifications &&
        request.notifications.length >= args.maxNotifications)
    ) {
      request.awaitingNotificationData = false;
      clearTimeout(request.notificationTimeout);
      dispatch(agent, new UartRequest(`AT+GAPDISCONNECT\r`));
    }
  } else if (
    parsedLine instanceof ParsedAsciiData &&
    request.awaitingNotificationData
  ) {
    let data = removeNonAscii(parsedLine.data);
    if (data !== "") {
      let notification = Buffer.from(data).toString("hex");
      request.notifications.push(notification);
      if (
        (args.lastNotification && data === args.lastNotification) ||
        (args.maxNotifications &&
          request.notifications.length >= args.maxNotifications)
      ) {
        request.awaitingNotificationData = false;
        clearTimeout(request.notificationTimeout);
        dispatch(agent, new UartRequest(`AT+GAPDISCONNECT\r`));
      }
    }
  }
}

async function updateBlePortAgent(
  state = {
    port: undefined,
    mqttClient: undefined,
    request: undefined,
    firmware: undefined,
    isScanning: false,
    allowedAddresses: getAllowedAddresses(),
  },
  msg,
  ctx
) {
  try {
    if (msg instanceof FindPort && !state.port) {
      const port = await findBlePort();
      if (port) {
        const onData = (line) => dispatch(ctx.self, new UartResponse(line));
        const onClose = () => dispatch(ctx.self, new PortClosed());
        const onError = () => process.exit(1);
        await setupBlePort(port, parser, onData, onClose, onError);
        state.port = port;
      } else {
        logger.error("BLE port not found. Exiting...");
        await delay(1000);
        process.exit(1);
      }
    } else if (msg instanceof MQTT.AsyncClient && !state.mqttClient) {
      state.mqttClient = msg;
    } else if (msg instanceof PortClosed) {
      state.request?.reject(
        new OperationError({ statusCode: 500, reason: "Serial port closed" })
      );
      logger.error(`Port closed. Exiting...`);
      await delay(1000);
      process.exit(1);
    } else if (msg instanceof StartScan) {
      if (state.port && !state.isScanning) {
        startScanning(state.port);
        state.isScanning = true;
        logger.debug(`Started scanning`);
      }
    } else if (msg instanceof AsyncRequest) {
      if (!state.firmware) {
        msg.reject(
          new OperationError({
            statusCode: 500,
            reason: "BLE port not detected or not ready",
          })
        );
      } else if (state.request) {
        msg.reject(
          new OperationError({
            statusCode: 500,
            reason: "Another request in progress",
          })
        );
      } else {
        if (state.isScanning === true) {
          dispatch(ctx.self, new UartRequest("\x03\r"));
        } else {
          tryConnect(msg, ctx.self);
        }
        state.request = msg;
      }
    } else if (msg instanceof UartRequest) {
      let line = msg.line;
      if (state.firmware && state.request) {
        writeAndDrain(state.port, line);
      } else {
        logger.debug(`Ignored uart request line: ${line}`);
      }
    } else if (msg instanceof UartResponse) {
      let line = msg.line;
      if (state.request && state.firmware && !state.isScanning) {
        await handleNewUartLine(line, ctx.self, state);
      } else if (state.firmware && state.isScanning === true) {
        const parsedResponse = parseScanResponse(line);
        if (parsedResponse instanceof ParsedScanComplete) {
          logger.debug("Scan complete");
          state.isScanning = false;
          if (
            state.request &&
            !state.request.isConnecting &&
            !state.request.isConnected
          ) {
            tryConnect(state.request, ctx.self);
          }
        } else if (parsedResponse instanceof ParsedAdvRssiData) {
          //logger.debug(`Scan response: ${JSON.stringify(parsedResponse)}`);
          if (
            state.allowedAddresses.includes("*") ||
            state.allowedAddresses.includes(parsedResponse.address)
          ) {
            await mqttPublishAdv(state.mqttClient, parsedResponse);
          }
        } else {
          //logger.debug(`Ignored uart response line: ${line}`);
        }
      } else if (firmwareRegex.test(line)) {
        let match = firmwareRegex.exec(line);
        let firmware = match[1];
        if (VERSIONS.find((x) => x === firmware)) {
          state.firmware = firmware;
          logger.debug(`Detected bleuio firmware: ${state.firmware}`);
        } else {
          logger.error("Unsupported bleuio firmware detected. Exiting...");
          await delay(1000);
          process.exit(1);
        }
      } else {
        logger.debug(`Ignored uart response line: ${line}`);
      }
    }
    return state;
  } catch (e) {
    logger.error(`BLE port agent crashed, exiting...`, e);
    process.exit(1);
  }
}

function toColonAddress(address) {
  address = address?.toString().toLowerCase() || "";
  const regexColon =
    /^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/;
  const regexNoColon = /^[0-9a-f]{12}$/i;
  if (regexNoColon.test(address)) {
    return `${address.slice(0, 2)}:${address.slice(2, 4)}:${address.slice(
      4,
      6
    )}:${address.slice(6, 8)}:${address.slice(8, 10)}:${address.slice(
      10,
      12
    )}`.toUpperCase();
  } else if (regexColon.test(address)) {
    return address.toUpperCase();
  }
  return "";
}

module.exports = { updateBlePortAgent };
