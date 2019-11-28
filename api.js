const MAGIC = require("./magic");
var net = require("net");

//
// Airtouch API
// TCP socket client for the Airtouch Touchpad Controller
// Listens and decodes broadcast messages containing AC and Group states
// Encodes and sends messages containing AC and Group commands
//
function AirtouchAPI(log) {
	this.log = log;
};

// messages have the data checksummed using modbus crc16
// crc16 implementation from https://github.com/yuanxu2017/modbus-crc16
function crc16(buffer) {
	var crc = 0xFFFF;
	var odd;

	for (var i = 0; i < buffer.length; i++) {
		crc = crc ^ buffer[i];

		for (var j = 0; j < 8; j++) {
			odd = crc & 0x0001;
			crc = crc >> 1;
			if (odd) {
				crc = crc ^ 0xA001;
			}
		}
	}
	return crc;
};

// check if value is undefined, and replace it with a default value
function isNull(val, nullVal) {
	return typeof(val) === "undefined" ? nullVal : val;
};

// send message to the Airtouch Touchpad Controller
AirtouchAPI.prototype.send = function(type, data) {
	this.log("API | Sending message type " + type.toString(16) + " containing:");
	this.log(data);
	// generate a random message id
	let msgid = Buffer.alloc(1);
	msgid.writeUInt8(Math.floor(Math.random() * Math.floor(255)) + 1);
	// get data length
	let datalen = Buffer.alloc(2);
	datalen.writeUInt16BE(data.length);
	// assemble payload
	let payload = Buffer.from([...MAGIC.ADDRESS_BYTES, ...msgid, ...[type], ...datalen, ...data]);
	// calculate payload crc
	let crc = Buffer.alloc(2);
	crc.writeUInt16BE(crc16(payload));
	// assemble message
	let message = Buffer.from([...MAGIC.HEADER_BYTES, ...payload,  ...crc]);
	this.log("API | Message to send:");
	this.log(message);
	// send message
	this.device.write(message);
};

// encode a message for AC command
AirtouchAPI.prototype.encode_ac_control = function(unit) {
	let byte1 = isNull(unit.ac_unit_number,0);
	byte1 = byte1 | ((isNull(unit.ac_power_state, MAGIC.AC_POWER_STATES.KEEP)) << 6);
	let byte2 = isNull(unit.ac_fan_speed, MAGIC.AC_FAN_SPEEDS.KEEP);
	byte2 = byte2 | ((isNull(unit.ac_mode, MAGIC.AC_MODES.KEEP)) << 4);
	let byte3 = isNull(unit.ac_target_value, 0);
	byte3 = byte3 | ((isNull(unit.ac_target_type, MAGIC.AC_TARGET_TYPES.KEEP)) << 6);
	let byte4 = 0;
	return Buffer.from([byte1, byte2, byte3, byte4]);
};

// send command to change AC mode (OFF/HEATING/COOLING/AUTO)
AirtouchAPI.prototype.acSetCurrentHeatingCoolingState = function(unit_number, state, temp) {
	unit_number = unit_number || 0;
	state = state || {};
	temp = Math.round(temp) || 0;
	switch (state) {
		case 0: // OFF
			target = {
				ac_unit_number: unit_number,
				ac_power_state: MAGIC.AC_POWER_STATES.OFF,
				ac_target_value: temp
			};
			break;
		case 1: // HEAT
			target = {
				ac_unit_number: unit_number,
				ac_power_state: MAGIC.AC_POWER_STATES.ON,
				ac_mode: MAGIC.AC_MODES.HEAT,
				ac_target_value: temp
			};
			break;
		case 2: // COOL
			target = {
				ac_unit_number: unit_number,
				ac_power_state: MAGIC.AC_POWER_STATES.ON,
				ac_mode: MAGIC.AC_MODES.COOL,
				ac_target_value: temp
			};
			break;
		default: // everything else is AUTO
			target = {
				ac_unit_number: unit_number,
				ac_power_state: MAGIC.AC_POWER_STATES.ON,
				ac_mode: MAGIC.AC_MODES.AUTO,
				ac_target_value: temp
			};
	}
	this.log("API | Setting heating/cooling state to: " + JSON.stringify(target));
	let data = this.encode_ac_control(target);
	this.send(MAGIC.MSGTYPE_AC_CTRL, data);
};

// send command to change AC target temperature
AirtouchAPI.prototype.acSetTargetTemperature = function(unit_number, temp) {
	unit_number = unit_number || 0;
	temp = Math.round(temp) || 0;
	target = {
		ac_unit_number: unit_number,
		ac_target_value: temp
	};
	this.log("API | Setting target temperature " + JSON.stringify(target));
	let data = this.encode_ac_control(target);
	this.send(MAGIC.MSGTYPE_AC_CTRL, data);
};

// send command to change AC fan speed 
AirtouchAPI.prototype.acSetFanSpeed = function(unit_number, speed) {
	unit_number = unit_number || 0;
	speed = Math.round(temp) || 0;
	target = {
		ac_unit_number: unit_number,
		ac_fan_speed: speed
	};
	this.log("API | Setting fan speed " + JSON.stringify(target));
	let data = this.encode_ac_control(target);
	this.send(MAGIC.MSGTYPE_AC_CTRL, data);
};

// send command to get AC status
AirtouchAPI.prototype.GET_AC_STATUS = function() {
	// due to a bug, cannot send empty data
	// so we send one byte of data
	let data = Buffer.alloc(1);
	data.writeUInt8(1, 0);
	this.send(MAGIC.MSGTYPE_AC_STAT, data);
};

// decode AC status information and send it to homebridge
AirtouchAPI.prototype.decode_ac_status = function(data) {
	data = data || {};
	ac_status = [];
	for (i = 0; i < data.length/8; i++) {
		let unit = data.slice(i*8, i*8+8);
		ac_power_state = (unit[0] & 0b11000000) >> 6;
		ac_unit_number = unit[0] & 0b00111111;
		ac_mode = (unit[1] & 0b11110000) >> 4;
		ac_fan_speed = unit[1] & 0b00001111;
		ac_spill = (unit[2] & 0b10000000) >> 7;
		ac_timer = (unit[2] & 0b01000000) >> 6;
		ac_target = (unit[2] & 0b00111111) * 1.0;
		ac_temp = (((unit[4] << 3) + ((unit[5] & 0b11100000) >> 5)) - 500) / 10;
		ac_error_code = (unit[6] << 8) + (unit[7]);
		ac_status.push({
			ac_unit_number: ac_unit_number,
			ac_power_state: ac_power_state,
			ac_mode: ac_mode,
			ac_fan_speed: ac_fan_speed,
			ac_target: ac_target,
			ac_temp: ac_temp,
			ac_spill: ac_spill,
			ac_timer_set: ac_timer,
			ac_error_code: ac_error_code,
		});
	}
	this.emit("ac_status", ac_status);
};

// send command to change zone power state (ON/OFF)
AirtouchAPI.prototype.zoneSetActive = function(group_number, active) {
	target = {
		group_number: group_number,
		group_power_state: active
	};
	this.log("API | Setting zone state: " + JSON.stringify(target));
	this.log("**********************************");
};

// send command to set damper position
AirtouchAPI.prototype.zoneSetDamperPosition = function(group_number, position) {
	target = {
		group_number: group_number,
		value: position
	};
	this.log("API | Setting damper position: " + JSON.stringify(target));
	this.log("**********************************");
};

// send command to get group status
AirtouchAPI.prototype.GET_GROUP_STATUS = function() {
	// due to a bug, cannot send empty data
	// so we send one byte of data
	let data = Buffer.alloc(1);
	data.writeUInt8(1, 0);
	this.send(MAGIC.MSGTYPE_GRP_STAT, data);
};

// decode groups status information and send it to homebridge
AirtouchAPI.prototype.decode_groups_status = function(data) {
	data = data || {};
	groups_status = [];
	for (i = 0; i < data.length/6; i++) {
		let group = data.slice(i*6, i*6+6);
		group_power_state = (group[0] & 0b11000000) >> 6;
		group_number = group[0] & 0b00111111;
		group_control_type = (group[1] & 0b10000000) >> 7;
		group_open_perc = group[1] & 0b01111111;
		group_battery_low = (group[2] & 0b10000000) >> 7;
		group_has_turbo = (group[2] & 0b01000000) >> 6;
		group_target = (group[2] & 0b00111111) * 1.0;
		group_has_sensor = (group[3] & 0b10000000) >> 7;
		group_temp = (((group[4] << 3) + ((group[5] & 0b11100000) >> 5)) - 500) / 10;
		group_has_spill = (group[5] & 0b00010000) >> 4;
		groups_status.push({
			group_number: group_number,
			group_power_state: group_power_state,
			group_control_type: group_control_type,
			group_damper_position: group_open_perc,
			group_target: group_target,
			group_temp: group_temp,
			group_battery_low: group_battery_low,
			group_has_turbo: group_has_turbo,
			group_has_sensor: group_has_sensor,
			group_has_spill: group_has_spill,
		});
	}
	this.emit("groups_status", groups_status);
};		

// connect to Airtouch Touchpad Controller socket on tcp port 9004
AirtouchAPI.prototype.connect = function(address) {
	this.device = new net.Socket();
	this.device.connect(9004, address, () => {
		this.log("API | Connected to Airtouch");
		// request information from Airtouch after connection
		this.GET_AC_STATUS();
		this.GET_GROUP_STATUS();
	});
	this.device.on("close", () => {
		this.log("API | Disconnected from Airtouch");
	});
	// listener callback
	this.device.on("readable", () => {
		let header = this.device.read(6);
		if (!header)
			return;
		if (header[0] != MAGIC.HEADER_BYTES[0]
			|| header[1] != MAGIC.HEADER_BYTES[1]
			|| header[3] != MAGIC.ADDRESS_BYTES[0]) {
			this.log("API | WARNING: invalid header " + header.toString("hex"));
		}
		let msgid = header[4];
		let msgtype = header[5];
		let datalen = this.device.read(2);
		let data = this.device.read(datalen.readUInt16BE());
		let crc = this.device.read(2);
		this.log("API | Received message with id " + msgid + " and data " + data.toString("hex"));
		if (crc.readUInt16BE() != crc16([...header.slice(2), ...datalen, ...data])) {
			this.log("API | ERROR: invalid crc");
			return;
		}
		switch (msgtype) {
			case MAGIC.MSGTYPE_GRP_STAT:
				// decode groups status info
				this.decode_groups_status(data);
				break;
			case MAGIC.MSGTYPE_AC_STAT:
				// decode ac status info
				this.decode_ac_status(data);
				break;
		}
	});
};

module.exports = AirtouchAPI;
