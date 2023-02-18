"use strict";

const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { logger } = require("./logging");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parser = new ReadlineParser();
const VENDOR_ID = "2dcf";
const PROD_ID = "6002";
const BAUD_RATE = 57600;

function writeAndDrain(port, line) {
  port.write(line);
  port.drain();
}

async function findBlePort() {
  let portInfos = await SerialPort.list();
  for (let p of portInfos) {
    logger.debug(`found portInfo: ${JSON.stringify(p)}`);
  }
  let bleuio = portInfos.find(
    (p) => p.vendorId === VENDOR_ID && p.productId === PROD_ID
  );
  if (bleuio) {
    return new SerialPort({
      path: bleuio.path,
      baudRate: BAUD_RATE,
      parity: "none",
      stopBits: 1,
      dataBits: 8,
      flowControl: false,
    });
  }
}

async function setupBlePort(
  port,
  parser,
  onPortData,
  onPortClose,
  onPortError
) {
  port.pipe(parser);
  parser.on("data", (data) => {
    const line = data.trim();
    if (line) {
      //logger.debug(`port data: ${line}`);
      onPortData(line);
    }
  });
  port.on("error", (err) => {
    logger.error(`port error`, err);
    onPortError();
  });
  port.on("close", (err) => {
    logger.error(`port close`, err);
    onPortClose();
  });
  writeAndDrain(port, "ATE0\r");
  await delay(100);
  writeAndDrain(port, "ATV0\r");
  await delay(100);
  writeAndDrain(port, "AT+CENTRAL\r");
  await delay(100);
  writeAndDrain(port, "ATA0\r");
  await delay(100);
  writeAndDrain(port, "ATDS0\r");
  await delay(100);
  writeAndDrain(port, "AT+SHOWRSSI=1\r");
  await delay(100);
  writeAndDrain(port, "AT+CANCELCONNECT\r");
  await delay(100);
  writeAndDrain(port, "\x03\r");
  await delay(100);
  writeAndDrain(port, "ATI\r");
  await delay(100);
}

function startScanning(port) {
  writeAndDrain(port, "AT+FINDSCANDATA=\r");
}

module.exports = {
  findBlePort,
  setupBlePort,
  parser,
  startScanning,
  writeAndDrain,
};
