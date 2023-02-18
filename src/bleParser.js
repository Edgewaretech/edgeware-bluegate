"use strict";
const { logger } = require("./logging");

const advRssiRegex =
  /^RSSI: (\-?\d+) \[(\w{2}:\w{2}:\w{2}:\w{2}:\w{2}:\w{2})\]\s+Device Data\s+\[(\w+)\]:\s+(\w+)$/;
const receivedDataRegex = /^Hex: 0x(\w+)$/;
const timeoutRegex = /Timeout/;

class ParsedScanComplete {}

class ParsedBleuioError {}

class ParsedAdvRssiData {
  constructor(rssi, address, advData) {
    this.rssi = rssi;
    this.address = address;
    this.advData = advData;
  }
}

class ParsedTimeout {}

class ParsedConnected {}

class ParsedReconnecting {}

class ParsedDisconnected {}

class ParsedUpdatedCI {}

class ParsedDataWritten {}

class ParsedWriteCompleted {}

class ParsedATCommand {}

class ParsedWrittenSize {}

class ParsedNotificationReceived {}

class ParsedNotificationHexData {
  constructor(data) {
    this.data = data;
  }
}
class ParsedAsciiData {
  constructor(data) {
    this.data = data;
  }
}

function decodeAdvData(scanData) {
  const buffer = Buffer.from(scanData || "", "hex");
  let offset = 0;
  let result = {};
  while (offset < buffer.length && buffer.readUInt8(offset) > 0) {
    let n = buffer.readUInt8(offset);
    let type = scanData.slice(2 * offset + 2, 2 * offset + 4);
    let v = scanData.slice(2 * offset + 4, 2 * offset + 4 + 2 * (n - 1));
    result[type] = v;
    offset += 1 + n;
  }
  return result;
}

function parseScanResponse(line) {
  if (/SCAN COMPLETE/.test(line)) {
    return new ParsedScanComplete();
  } else if (/ERROR/.test(line)) {
    return new ParsedBleuioError();
  } else {
    let match = advRssiRegex.exec(line);
    if (match && match.length === 5) {
      let rssi = Number(match[1]);
      let address = toNoColonAddress(match[2]);
      let type = match[3];
      let packet = match[4];
      if (type == "ADV") {
        let advData = decodeAdvData(packet);
        return new ParsedAdvRssiData(rssi, address, advData);
      }
    }
  }
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

function parseLine(line) {
  if (timeoutRegex.test(line)) {
    return new ParsedTimeout();
  } else if (/handle_evt_gap_connected/.test(line)) {
    return new ParsedConnected();
  } else if (/Reconnecting.../.test(line)) {
    return new ParsedReconnecting();
  } else if (/handle_evt_gap_disconnected/.test(line)) {
    return new ParsedDisconnected();
  } else if (/handle_evt_gattc_write_completed/.test(line)) {
    return new ParsedWriteCompleted();
  } else if (/handle_evt_gattc_notification/.test(line)) {
    return new ParsedNotificationReceived();
  } else if (/Peripheral updated CI/.test(line)) {
    return new ParsedUpdatedCI();
  } else if (receivedDataRegex.test(line)) {
    let match = receivedDataRegex.exec(line);
    let data = match[1].toLowerCase();
    return new ParsedNotificationHexData(data);
  } else if (/DATA WRITTEN/.test(line)) {
    return new ParsedDataWritten();
  } else if (/AT\+/.test(line)) {
    return new ParsedATCommand();
  } else if (/Size: \d+/.test(line)) {
    return new ParsedWrittenSize();
  } else {
    return new ParsedAsciiData(line);
  }
}

module.exports = {
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
  ParsedWrittenSize,
  ParsedNotificationReceived,
  ParsedNotificationHexData,
  ParsedAsciiData,
  parseLine,
};
