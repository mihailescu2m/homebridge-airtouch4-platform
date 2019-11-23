
const MAGIC = require("./magic");
var net = require("net");

function AirtouchAPI(log) {
	this.log = log;
}

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
}

AirtouchAPI.prototype = {

	connect: function() {
		var self = this;
		this.device = new net.Socket();
		this.device.connect(9004, "192.168.0.52", () => {
			this.log("info: connected to airtouch");
		});
		this.device.on("close", () => {
			this.log("info: disconnected from airtouch");
		});
		this.device.on("readable", () => {
			let header = self.device.read(6);
			if (!header) return;
			self.log("info: received data with header " + header.toString("hex"));
			if (header[0] != MAGIC.HEADER_BYTES[0] 
				|| header[1] != MAGIC.HEADER_BYTES[1]
				|| header[3] != MAGIC.ADDRESS_BYTES[0]) {
				self.log("warning: invalid header " + header.toString("hex"));
			}
			let msgid = header[4];
			let msgtype = header[5];
			let size = self.device.read(2);
			let payload = self.device.read(size.readUInt16BE(0));
			let crc = self.device.read(2);
			self.log("info: received payload " + payload.toString("hex"));
			if (crc.readUInt16BE(0) != crc16([...header.slice(2), ...size, ...payload])) {
				self.log("warning: invalid crc");
				return;
			}
			switch (msgtype) {
				case MAGIC.MSGTYPE_GRP_STAT:
					// decode zones status info
					break;
				case MAGIC.MSGTYPE_AC_STAT:
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
					self.log("*** EMITTING AC STATUS ***");
					self.emit("ac_status", ac_status);
					break;
				default:
			}
		});
	},

}

module.exports = AirtouchAPI;

