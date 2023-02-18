"use strict";

const { DateTime } = require("luxon");

class InitRequestAgent {}

class OperationError extends Error {
  constructor(payload) {
    super(JSON.stringify(payload));
    this.payload = { timestamp: DateTime.utc().toMillis(), ...payload };
    this.name = "OperationError";
  }
}
class AsyncResult {
  constructor(payload) {
    this.payload = { timestamp: DateTime.utc().toMillis(), ...payload };
  }
}
class AsyncRequest {
  constructor(args, resolve, reject) {
    this.args = args;
    this.resolve = resolve;
    this.reject = reject;
  }
}

class UartRequest {
  constructor(line) {
    this.line = line;
  }
}

class UartResponse {
  constructor(line) {
    this.line = line;
  }
}

class FindPort {}

class PortClosed {}

class StartScan {}

module.exports = {
  FindPort,
  PortClosed,
  UartRequest,
  UartResponse,
  AsyncRequest,
  AsyncResult,
  InitRequestAgent,
  StartScan,
  OperationError,
};
