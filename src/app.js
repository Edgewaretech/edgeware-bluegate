"use strict";

const { start, dispatch, spawn } = require("nact");
const { DateTime } = require("luxon");
const { updateBlePortAgent } = require("./portAgent");
const { updateRequestAgent } = require("./requestAgent");
const { logger } = require("./logging");
const { v4: uuidv4, version } = require("uuid");
const { InitRequestAgent } = require("./messages");

const system = start();
const requestAgent = spawn(system, updateRequestAgent, "requestAgent");
const blePortAgent = spawn(requestAgent, updateBlePortAgent, "blePortAgent");
dispatch(requestAgent, new InitRequestAgent());
logger.debug(`Agent system started.`);
