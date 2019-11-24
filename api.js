
const MAGIC = require("./magic");
var net = require("net");

function AirtouchAPI(log) {
	this.log = log;
};

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

function isNull(val, nullVal) {
	return typeof(val) === "undefined" ? nullVal : val;
};

AirtouchAPI.prototype.send = function(type, payload) {
	this.log("API Sending message type " + type.toString(16) + " containing: ")
	this.log(payload);
	id = Math.floor(Math.random() * Math.floor(255)) + 1;
	msgid = Buffer.alloc(1);
	msgid.writeUInt8(49, 0);
	msgsize = Buffer.alloc(2);
	msgsize.writeUInt16BE(payload.length);
	message = Buffer.from([...MAGIC.ADDRESS_BYTES, ...msgid, ...[type], ...msgsize, ...payload]);
	crc = Buffer.alloc(2);
	crc.writeUInt16BE(crc16(message), 0);
	buffer = Buffer.from([...MAGIC.HEADER_BYTES, ...message,  ...crc]);
	this.log("API Full message to send: ");
	this.log(buffer);
	this.device.write(buffer);
};

AirtouchAPI.prototype.encode_ac_control = function(status) {
	byte1 = isNull(status.ac_unit_number,0);
	byte1 = byte1 | ((isNull(status.ac_power_state, MAGIC.AC_POWER_STATES.KEEP))<<6);
	byte2 = isNull(status.ac_fan_speed, MAGIC.AC_FAN_SPEEDS.KEEP);
	byte2 = byte2 | ((isNull(status.ac_mode, MAGIC.AC_MODES.KEEP))<<4);
	byte3 = isNull(status.ac_target_value, 0);
	byte3 = byte3 | ((isNull(status.ac_target_type, MAGIC.AC_TARGET_TYPES.KEEP))<<6);
	byte4 = 0;
	return Buffer.from([byte1, byte2, byte3, byte4]);
};

AirtouchAPI.prototype.acSetCurrentHeatingCoolingState = function(unit, state, temp) {
	switch (state) {
		case 0: // OFF
			target = {ac_unit_number: unit, ac_power_state: MAGIC.AC_POWER_STATES.OFF, ac_target_value: Math.round(temp)};
			break;
		case 1: // HEAT
			target = {ac_unit_number: unit, ac_power_state: MAGIC.AC_POWER_STATES.ON, ac_mode: MAGIC.AC_MODES.HEAT, ac_target_value: Math.round(temp)};
			break;
		case 2: // COOL
			target = {ac_unit_number: unit, ac_power_state: MAGIC.AC_POWER_STATES.ON, ac_mode: MAGIC.AC_MODES.COOL, ac_target_value: Math.round(temp)};
			break;
		default: // AUTO
			target = {ac_unit_number: unit, ac_power_state: MAGIC.AC_POWER_STATES.ON, ac_mode: MAGIC.AC_MODES.AUTO, ac_target_value: Math.round(temp)};
	}
	this.log("API setting heating/cooling state " + JSON.stringify(target));
	payload = this.encode_ac_control(target);
	this.send(MAGIC.MSGTYPE_AC_CTRL, payload);
};

AirtouchAPI.prototype.acSetTargetTemperature = function(unit, temp) {
	target = {ac_unit_number: unit, ac_target_value: Math.round(temp)};
	this.log("API setting target temperature " + JSON.stringify(target));
	payload = this.encode_ac_control(target);
	this.send(MAGIC.MSGTYPE_AC_CTRL, payload);
};

AirtouchAPI.prototype.GET_AC_STATUS = function() {
	payload = Buffer.alloc(1);
	payload.writeUInt8(1, 0);
	return this.send(MAGIC.MSGTYPE_AC_STAT, payload);
};

AirtouchAPI.prototype.decode_ac_status = function(payload) {
	// decode AC status info
	let ac_status = [];
	for (i = 0; i < payload.length/8; i++) {
		let unit = payload.slice(i*8, i*8+8);
		ac_power_state = (unit[0]&0b11000000)>>6;
		ac_unit_number = unit[0]&0b00111111;
		ac_mode = (unit[1]&0b11110000)>>4;
		ac_fan_speed = unit[1]&0b00001111;
		ac_spill = (unit[2]&0b10000000)>>7;
		ac_timer = (unit[2]&0b01000000)>>6;
		ac_target = (unit[2]&0b00111111) * 1.0;
		ac_temp = (((unit[4]<<3) + ((unit[5]&0b11100000)>>5)) - 500) / 10;
		ac_error_code = (unit[6]<<8) + (unit[7]);
		ac_status.push({
			"ac_unit_number": ac_unit_number,
			"ac_power_state": ac_power_state,
			"ac_mode": ac_mode,
			"ac_fan_speed": ac_fan_speed,
			"ac_target": ac_target,
			"ac_temp": ac_temp,
			"ac_spill": ac_spill,
			"ac_timer_set": ac_timer,
			"ac_error_code": ac_error_code,
		});
	}
	this.emit("ac_status", ac_status);
};

AirtouchAPI.prototype.connect = function() {
	this.device = new net.Socket();
	this.device.connect(9004, "192.168.0.52", () => {
		this.log("API Connected to airtouch");
		this.GET_AC_STATUS();
	});
	this.device.on("close", () => {
		this.log("API Disconnected from airtouch");
	});
	this.device.on("readable", () => {
		let header = this.device.read(6);
		if (!header) return;
		if (header[0] != MAGIC.HEADER_BYTES[0]
			|| header[1] != MAGIC.HEADER_BYTES[1]
			|| header[3] != MAGIC.ADDRESS_BYTES[0]) {
			this.log("API Warning: invalid header " + header.toString("hex"));
		}
		let msgid = header[4];
		let msgtype = header[5];
		let size = this.device.read(2);
		let payload = this.device.read(size.readUInt16BE(0));
		let crc = this.device.read(2);
		this.log("API Received message " + msgid + " with payload " + payload.toString("hex"));
		if (crc.readUInt16BE(0) != crc16([...header.slice(2), ...size, ...payload])) {
			this.log("API Error: invalid CRC");
			return;
		}
		switch (msgtype) {
			case MAGIC.MSGTYPE_GRP_STAT:
				// decode zones status info
				break;
			case MAGIC.MSGTYPE_AC_STAT:
				this.decode_ac_status(payload);
				break;
			default:
		}
	});
};

module.exports = AirtouchAPI;
