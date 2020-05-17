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
	this.zoneNames = { // setting default names in case the zone names are not found correctly and enable the feature to be turned off
		"Zone 0": "0",
		"Zone 1": "1",
		"Zone 2": "2",
		"Zone 3": "3",
		"Zone 4": "4",
		"Zone 5": "5",
		"Zone 6": "6",
		"Zone 7": "7",
		"Zone 8": "8",
		"Zone 9": "9",
		"Zone 10": "10",
		"Zone 11": "11",
		"Zone 12": "12",
		"Zone 13": "13",
		"Zone 14": "14",
		"Zone 15": "15",
		"Zone 16": "16",
	};
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

// need to convert hex into ascii text for zone and group names
function hex_to_ascii(str1)
 {
	var hex  = str1.toString();
	var str = '';
	for (var n = 0; n < hex.length; n += 2) {
		str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
	}
	return str.replace(/[^\x20-\x7E]/g, '');
 }

// check if value is undefined, and replace it with a default value
function isNull(val, nullVal) {
	return val === undefined ? nullVal : val;
};

// send message to the Airtouch Touchpad Controller
AirtouchAPI.prototype.send = function(type, data) {
	let id = Math.floor(Math.random() * Math.floor(255)) + 1;
	this.log("API | Sending message " + id + " with type " + type.toString(16) + " containing:");
	this.log(data);
	// generate a random message id
	let msgid = Buffer.alloc(1);
	msgid.writeUInt8(id);
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

AirtouchAPI.prototype.sendBufferDirect = function (dataBuffer) {
	// assemble message
	// let message = Buffer.from(data);
	this.log("API | Message to send direct:");
	this.log(dataBuffer);
	// send message
	this.device.write(dataBuffer);
}

// encode a message for AC command
AirtouchAPI.prototype.encode_ac_control = function(unit) {
	let byte1 = isNull(unit.ac_unit_number, MAGIC.AC_UNIT_DEFAULT);
	byte1 = byte1 | ((isNull(unit.ac_power_state, MAGIC.AC_POWER_STATES.KEEP)) << 6);
	let byte2 = isNull(unit.ac_fan_speed, MAGIC.AC_FAN_SPEEDS.KEEP);
	byte2 = byte2 | ((isNull(unit.ac_mode, MAGIC.AC_MODES.KEEP)) << 4);
	let byte3 = isNull(unit.ac_target_value, MAGIC.AC_TARGET_KEEP);
	byte3 = byte3 | ((isNull(unit.ac_target_type, MAGIC.AC_TARGET_TYPES.KEEP)) << 6);
	let byte4 = 0;
	return Buffer.from([byte1, byte2, byte3, byte4]);
};

// send command to change AC mode (OFF/HEATING/COOLING/AUTO)
AirtouchAPI.prototype.acSetCurrentHeatingCoolingState = function(unit_number, state) {
	switch (state) {
		case 0: // OFF
			target = {
				ac_unit_number: unit_number,
				ac_power_state: MAGIC.AC_POWER_STATES.OFF,
			};
			break;
		case 1: // HEAT
			target = {
				ac_unit_number: unit_number,
				ac_power_state: MAGIC.AC_POWER_STATES.ON,
				ac_mode: MAGIC.AC_MODES.HEAT,
			};
			break;
		case 2: // COOL
			target = {
				ac_unit_number: unit_number,
				ac_power_state: MAGIC.AC_POWER_STATES.ON,
				ac_mode: MAGIC.AC_MODES.COOL,
			};
			break;
		default: // everything else is AUTO
			target = {
				ac_unit_number: unit_number,
				ac_power_state: MAGIC.AC_POWER_STATES.ON,
				ac_mode: MAGIC.AC_MODES.AUTO,
			};
	}
	this.log("API | Setting AC heating/cooling state to: " + JSON.stringify(target));
	let data = this.encode_ac_control(target);
	this.send(MAGIC.MSGTYPE_AC_CTRL, data);
};

// send command to change AC target temperature
AirtouchAPI.prototype.acSetTargetTemperature = function(unit_number, temp) {
	target = {
		ac_unit_number: unit_number,
		ac_target_value: temp,
	};
	this.log("API | Setting AC target temperature " + JSON.stringify(target));
	let data = this.encode_ac_control(target);
	this.send(MAGIC.MSGTYPE_AC_CTRL, data);
};

// send command to change AC fan speed 
AirtouchAPI.prototype.acSetFanSpeed = function(unit_number, speed) {
	target = {
		ac_unit_number: unit_number,
		ac_fan_speed: speed,
	};
	this.log("API | Setting AC fan speed " + JSON.stringify(target));
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

// send command to get full System details
AirtouchAPI.prototype.GET_SYS_DETAILS = function() {
	// due to a bug, cannot send empty data
	// so we send one byte of data
	this.log("called get sys details");
	let dataBuffer = Buffer.from(MAGIC.MSGDATA_SYS_DETAILS);
	this.sendBufferDirect(dataBuffer);
};

// decode AC status information and send it to homebridge
AirtouchAPI.prototype.decode_ac_status = function(data) {
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

// encode a message for AC command
AirtouchAPI.prototype.encode_group_control = function(group) {
	let byte1 = isNull(group.group_number, MAGIC.GROUP_NUMBER_DEFAULT);
	let byte2 = isNull(group.group_power_state, MAGIC.GROUP_POWER_STATES.KEEP);
	byte2 = byte2 | ((isNull(group.group_control_type, MAGIC.GROUP_CONTROL_TYPES.KEEP)) << 3);
	byte2 = byte2 | ((isNull(group.group_target_type, MAGIC.GROUP_TARGET_TYPES.KEEP)) << 5);
	let byte3 = group.group_target || 0;
	let byte4 = 0;
	return Buffer.from([byte1, byte2, byte3, byte4]);
};

// send command to change zone power state (ON/OFF)
AirtouchAPI.prototype.zoneSetActive = function(group_number, active) {
	target = {
		group_number: group_number,
		group_power_state: active ? MAGIC.GROUP_POWER_STATES.ON : MAGIC.GROUP_POWER_STATES.OFF,
	};
	this.log("API | Setting zone state: " + JSON.stringify(target));
	let data = this.encode_group_control(target);
	this.send(MAGIC.MSGTYPE_GRP_CTRL, data);
};

// send command to set damper position
AirtouchAPI.prototype.zoneSetDamperPosition = function(group_number, position) {
	target = {
		group_number: group_number,
		group_target_type: MAGIC.GROUP_TARGET_TYPES.DAMPER,
		group_target: position,
	};
	this.log("API | Setting damper position: " + JSON.stringify(target));
	let data = this.encode_group_control(target);
	this.send(MAGIC.MSGTYPE_GRP_CTRL, data);
};

// send command to set control type (0 = DAMPER, 1 = TEMPERATURE)
AirtouchAPI.prototype.zoneSetControlType = function(group_number, type) {
	target = {
		group_number: group_number,
		group_control_type: MAGIC.GROUP_CONTROL_TYPES.DAMPER + type,
	};
	this.log("API | Setting control type: " + JSON.stringify(target));
	let data = this.encode_group_control(target);
	this.send(MAGIC.MSGTYPE_GRP_CTRL, data);
};

// send command to set target temperature
AirtouchAPI.prototype.zoneSetTargetTemperature = function(group_number, temp) {
	target = {
		group_number: group_number,
		group_target_type: MAGIC.GROUP_TARGET_TYPES.TEMPERATURE,
		group_target: temp,
	};
	this.log("API | Setting target temperature: " + JSON.stringify(target));
	let data = this.encode_group_control(target);
	this.send(MAGIC.MSGTYPE_GRP_CTRL, data);
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

// decode groups information and store it
AirtouchAPI.prototype.decode_sys_details = function(data) {
	let strData = data.toString("hex");
	for (i = 0; i < 15; i++) { //16 max group names
		zoneName = hex_to_ascii(strData.substr(268 + i*16, 16)).replace(/[^\x20-\x7E]/g, '');
		this.zoneNames["Zone " + i] = zoneName;
	};
};

// connect to Airtouch Touchpad Controller socket on tcp port 9004
AirtouchAPI.prototype.connect = function(address) {
	this.device = new net.Socket();
	this.device.connect(9004, address, () => {
		this.log("API | Connected to Airtouch");
		this.GET_SYS_DETAILS(); // this should block the timeouts, want to get zone names before everything else happens

		// request information from Airtouch after connection
		setTimeout(this.GET_AC_STATUS.bind(this), 0);
		setTimeout(this.GET_GROUP_STATUS.bind(this), 2000);
		// schedule group status every 4.75 minutes to get updates for FakeGato history service
		setInterval(this.GET_GROUP_STATUS.bind(this), 285000);

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
		this.log("API | Received message with id " + msgid + " and type " + msgtype + " and data " + data.toString("hex"));
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
			case MAGIC.MSGTYPE_SYS_DETAILS:
				//decode system details
				this.decode_sys_details(data);
		}
	});

	// error handling to stop connection errors bringing down homebridge
	this.device.on("error", function(err) {
		this.log("API | Connection Error: " + err.message);
		this.device.destroy(); //close the connection even though its already broken
		setTimeout(() => {
			if (!this.device.listening) { //only attempt reconnect if not already re-connected
				this.log("API | Attempting reconnect");
				this.emit("attempt_reconnect");
			}
		}, 10000);
	}.bind(this));

};

module.exports = AirtouchAPI;
