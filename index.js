const util = require("util");
const emitter = require("events").EventEmitter;
const MAGIC = require("./magic");
const AirtouchAPI = require("./api");
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function (homebridge) {
	Accessory = homebridge.platformAccessory;
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	UUIDGen = homebridge.hap.uuid;
	// registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
	homebridge.registerPlatform("homebridge-airtouch4-platform", "Airtouch", Airtouch, true);
};

//
// Airtouch platform
// Homebridge platform which creates accessories for AC units and AC zones
// Handles communication with the Airtouch Touchpad Controller using the Airtouch API
//
function Airtouch(log, config, api) {
	this.log = log;
	this.config = config;
	this.platform = api;

	this.units = {};
	this.zones = {};

	// set up callbacks from API
	util.inherits(AirtouchAPI, emitter);
	this.api = new AirtouchAPI(log);
	this.api.on("ac_status", (ac_status) => {
		this.onACStatusNotification(ac_status);
	});
	this.api.on("groups_status", (group_status) => {
		this.onGroupsStatusNotification(group_status);
	});

	// connect to the Airtouch Touchpad Controller
	this.api.connect(config.ip_address);
};

// configures cached accessories
Airtouch.prototype.configureAccessory = function(accessory) {
	this.log("Trying to configure [" + accessory.displayName + "] from cache...");

	if (accessory.displayName in this.units || accessory.displayName in this.zones) {
		this.log("[" + accessory.displayName + "] is already configured");
		return;
	}

	accessory.reacheable = false;
	accessory.log = this.log;
	accessory.api = this.api;

	if (accessory.displayName.startsWith("AC")) {
		this.setupACAccessory(accessory);
		this.units[accessory.displayName] = accessory;
	} else if (accessory.displayName.startsWith("Zone")) {
		this.setupZoneAccessory(accessory);
		this.zones[accessory.displayName] = accessory;
	}

	this.log("[" + accessory.displayName + "] was restored from cache and should be reachable");
};

// callback for AC messages received from Airtouch Touchpad Controller
Airtouch.prototype.onACStatusNotification = function(ac_status) {
	ac_status.forEach(unit_status => {
		unit_name = "AC " + unit_status.ac_unit_number;
		this.log("Received status update for [" + unit_name + "]: " + JSON.stringify(unit_status));
		// check if accessory exists
		if (!(unit_name in this.units)) {
			this.log("[" + unit_name + "] was not found, creating as new AC accessory...");
			let uuid = UUIDGen.generate(unit_name);
			let unit = new Accessory(unit_name, uuid);
			unit.log = this.log;
			unit.api = this.api;
			unit.context.manufacturer = this.config.units[unit_status.ac_unit_number].manufacturer || "N/A";
			unit.context.model = this.config.units[unit_status.ac_unit_number].model || "N/A";
			unit.context.serial = unit_status.ac_unit_number;
			this.setupACAccessory(unit);
			this.units[unit_name] = unit;
			this.platform.registerPlatformAccessories("homebridge-airtouch4-platform", "Airtouch", [unit]);
		}
		// update accessory
		this.updateACAccessory(this.units[unit_name], unit_status);
	});
};

// callback for Group messages received from Airtouch Touchpad Controller
Airtouch.prototype.onGroupsStatusNotification = function(groups_status) {
	groups_status.forEach(zone_status => {
		zone_name = "Zone " + zone_status.group_number;
		this.log("Received status update for [" + zone_name + "]: " + JSON.stringify(zone_status));
		// check if accessory exists
		if (!(zone_name in this.zones)) {
			this.log("[" + zone_name + "] was not found, creating as new Zone accessory...");
			let uuid = UUIDGen.generate(zone_name);
			let zone = new Accessory(zone_name, uuid);
			zone.log = this.log;
			zone.api = this.api;
			zone.context.manufacturer = "Polyaire";
			zone.context.model = "Quick Fix Damper";
			zone.context.serial = zone_status.group_number;
			this.setupZoneAccessory(zone);
			this.zones[zone_name] = zone;
			this.platform.registerPlatformAccessories("homebridge-airtouch4-platform", "Airtouch", [zone]);
		}
		// update accessory
		this.updateZoneAccessory(this.zones[zone_name], zone_status);
	});
};

// setup AC accessory callbacks
Airtouch.prototype.setupACAccessory = function(accessory) {
	accessory.getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer)
		.setCharacteristic(Characteristic.Model, accessory.context.model)
		.setCharacteristic(Characteristic.SerialNumber, accessory.context.serial.toString());

	let thermostat = accessory.getService(Service.Thermostat);
	if (thermostat === undefined)
		thermostat = accessory.addService(Service.Thermostat, accessory.displayName);

	//thermostat
	//	.getCharacteristic(Characteristic.Active)
	//	.on("get", this.acGetActive.bind(accessory))
	//	.on("set", this.acSetActive.bind(accessory));

	thermostat
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
		.on("get", function(cb){ return cb(null, this.context.currentHeatingCoolingState); }.bind(accessory));

	thermostat
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
		.on("get", function(cb){ return cb(null, this.context.targetHeatingCoolingState); }.bind(accessory))
        .on("set", this.acSetTargetHeatingCoolingState.bind(accessory));

	thermostat
		.getCharacteristic(Characteristic.CurrentTemperature)
		.on("get", function(cb){ return cb(null, this.context.currentTemperature); }.bind(accessory));

	thermostat
        .getCharacteristic(Characteristic.TargetTemperature)
		.setProps({
			minStep: 1.0,
			minValue: 14.0,
			maxValue: 29.0})
		.on("get", function(cb){ return cb(null, this.context.targetTemperature); }.bind(accessory))
		.on("set", this.acSetTargetTemperature.bind(accessory));

	//thermostat
	//	.getCharacteristic(Characteristic.HeatingThresholdTemperature)
	//	.on("get", this.acGetTargetTemperature.bind(accessory))
	//	.on("set", this.acSetTargetTemperature.bind(accessory));

	let fan = thermostat.getCharacteristic(Characteristic.RotationSpeed);
	if (fan === undefined)
		fan = thermostat.addCharacteristic(Characteristic.RotationSpeed);
	accessory.context.fan_speeds = this.config.units[accessory.context.serial].fan;
	accessory.context.rotation_step = Math.floor(100/(Object.keys(accessory.context.fan_speeds).length-1));
	fan.setProps({
			minStep: accessory.context.rotation_step,
			minValue: 0,
			maxValue: accessory.context.rotation_step*(Object.keys(accessory.context.fan_speeds).length-1)})
		.on("get", function(cb){ return cb(null, this.context.rotationSpeed); }.bind(accessory))
		.on("set", this.acSetRotationSpeed.bind(accessory));

	accessory.context.temperatureDisplayUnits = 0; // Celsius
	thermostat
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
		.on("get", function(cb){ return cb(null, this.context.temperatureDisplayUnits); }.bind(accessory))
        .on("set", this.acSetTemperatureDisplayUnits.bind(accessory));

	thermostat
        .getCharacteristic(Characteristic.Name)
		.on("get", function(cb){ return cb(null, this.displayName); }.bind(accessory));

	thermostat.isPrimaryService = true;

	this.log("Finished creating accessory [" + accessory.displayName + "]");
};

// update AC accessory data
Airtouch.prototype.updateACAccessory = function(accessory, status) {
	let thermostat = accessory.getService(Service.Thermostat);

	accessory.context.currentTemperature = status.ac_temp;
	thermostat.setCharacteristic(Characteristic.CurrentTemperature, accessory.context.currentTemperature);

	accessory.context.targetTemperature = status.ac_target;
	thermostat.setCharacteristic(Characteristic.TargetTemperature, accessory.context.targetTemperature);

	accessory.context.active = status.ac_power_state;

	if (status.ac_power_state == 0) // OFF
		accessory.context.currentHeatingCoolingState = 0;
	else if (status.ac_mode == 1) // HEAT
		accessory.context.currentHeatingCoolingState = 1;
	else if (status.ac_mode == 4) // COOL
		accessory.context.currentHeatingCoolingState = 2;
	else // AUTO set for: {2=DRY, 3=FAN, 8=AUTO-HEAT, 9=AUTO-COOL}
		accessory.context.currentHeatingCoolingState = 3;
	thermostat.setCharacteristic(Characteristic.CurrentHeatingCoolingState, accessory.context.currentHeatingCoolingState);

	accessory.context.targetHeatingCoolingState = accessory.context.currentHeatingCoolingState;
	thermostat.setCharacteristic(Characteristic.TargetHeatingCoolingState, accessory.context.targetHeatingCoolingState);

	// convert AC fan speed number in AC fan speed string (e.g. 4 => High)
	let fan_speed = Object.keys(MAGIC.AC_FAN_SPEEDS).find(key => MAGIC.AC_FAN_SPEEDS[key] === status.ac_fan_speed);
	// convert AC fan speed string into homebridge fan rotation % (e.g. High => 99%) using the config array
	accessory.context.rotationSpeed = accessory.context.fan_speeds.indexOf(fan_speed) * accessory.context.rotation_step;
	this.log("*** DECODED ROTATION SPEED: " + accessory.context.rotationSpeed);
	thermostat.setCharacteristic(Characteristic.RotationSpeed, accessory.context.rotationSpeed);

	accessory.updateReachability(true);
	this.log("Finished updating accessory [" + accessory.displayName + "]");
};

// setup Zone accessory callbacks
Airtouch.prototype.setupZoneAccessory = function(accessory) {
	accessory.getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, "Polyaire")
		.setCharacteristic(Characteristic.Model, "Quick Fix Damper")
		.setCharacteristic(Characteristic.SerialNumber, accessory.context.serial.toString());

	let damper = accessory.getService(Service.Fanv2);
	if (damper === undefined)
		damper = accessory.addService(Service.Fanv2, accessory.displayName);

	damper
		.getCharacteristic(Characteristic.Active)
		.on("get", this.zoneGetActive.bind(accessory))
		.on("set", this.zoneSetActive.bind(accessory));

	damper
		.getCharacteristic(Characteristic.RotationSpeed)
		.setProps({
			minStep: 5,
			minValue: 0,
			maxValue: 100})
		.on("get", this.zoneGetDamperPosition.bind(accessory))
		.on("set", this.zoneSetDamperPosition.bind(accessory));

	damper
		.getCharacteristic(Characteristic.Name)
		.on("get", function(cb){ return cb(null, this.displayName); }.bind(accessory));

	damper.isPrimaryService = true;

	this.log("Finished creating accessory [" + accessory.displayName + "]");
};

// update Zone accessory data
Airtouch.prototype.updateZoneAccessory = function(accessory, status) {
	let damper = accessory.getService(Service.Fanv2);
	let thermostat = accessory.getService(Service.Thermostat);
	let sensor = accessory.getService(Service.TemperatureSensor);

	accessory.context.active = status.group_power_state % 2;
	damper.setCharacteristic(Characteristic.Active, accessory.context.active);

	accessory.context.damperPosition = status.group_damper_position;
	if (status.group_control_type == 0) { // damper control
		// set R/W permissions for damper
		damper_perms = [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY];
		// remove thermostat
		if (typeof thermostat != "undefined" ) {
			accessory.removeService(Service.Thermostat);
		}
		// add/update temperature sensor if sensor exists
		if (status.group_has_sensor) {
			if (sensor === undefined) {
				sensor = accessory.addService(Service.TemperatureSensor);
			}
			sensor.setCharacteristic(Characteristic.CurrentTemperature, status.group_temp);
			sensor.setCharacteristic(Characteristic.StatusLowBattery, status.group_battery_low);
		} else {
			if (typeof sensor != "undefined")
				accessory.removeService(Service.TemperatureSensor);
		}
	} else if (group.group_has_sensor) { // temperature control
		// set R/O permissions for damper
		damper_perms = [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY];
		// remove temperature sensor
		// add/update thermostat if temperature sensor exists
		let thermostat = accessory.getService(Service.Thermostat);
		if (thermostat === undefined) {
			thermostat = accessory.addService(Service.Thermostat);
			// zone thermostat has only ON and AUTO
			thermostat
				.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
				.setProps({ validValues: [0, 3] });
			thermostat
				.getCharacteristic(Characteristic.TargetHeatingCoolingState)
				.setProps({ validValues: [0, 3] });
			// TODO: add callbacks
		}
		thermostat.setCharacteristic(Characteristic.CurrentHeatingCoolingState, status.group_power_state > 0 ? 3 : 0);
		thermostat.setCharacteristic(Characteristic.TargetHeatingCoolingState, status.group_power_state > 0 ? 3 : 0);
		thermostat.setCharacteristic(Characteristic.CurrentTemperature, status.group_temp);
		thermostat.setCharacteristic(Characteristic.TargetTemperature, status.group_target);
		thermostat.setCharacteristic(Characteristic.TemperatureDisplayUnit, 0);
	}
	damper.setCharacteristic(Characteristic.RotationSpeed, accessory.context.damperPosition);
	damper
		.getCharacteristic(Characteristic.RotationSpeed)
		.setProps({perms: damper_perms});

	accessory.context.currentTemperature = status.group_temp;
	accessory.context.targetTemperature = status.group_target;
	accessory.context.battery_low = status.group_battery_low;
	accessory.context.has_sensor = status.group_has_sensor;
	accessory.context.has_turbo = status.group_has_turbo;
	accessory.context.has_spill = status.group_has_spill;

	this.log("Finished updating accessory [" + accessory.displayName + "]");
	accessory.updateReachability(true);
};

/* ----------------------------------------------------------------------------------------------------- */

/* AC accessory function */

Airtouch.prototype.acSetTargetHeatingCoolingState = function(val, cb) {
	if (this.context.targetHeatingCoolingState != val) {
		this.context.targetHeatingCoolingState = val;
		if (this.context.currentHeatingCoolingState != val)
			this.api.acSetCurrentHeatingCoolingState(this.context.serial, val);
	}
	cb();
};

Airtouch.prototype.acSetTargetTemperature = function(val, cb) {
	if (this.context.targetTemperature != val) {
		this.context.targetTemperature = val;
		this.api.acSetTargetTemperature(this.context.serial, val);
	}
	cb();
};

Airtouch.prototype.acSetRotationSpeed = function(val, cb) {
	if (this.context.rotationSpeed != val) {
		this.context.rotationSpeed = val;
		this.log("*** NEW ROTATION SPEED: " + val);
		// convert homebridge fan rotation % into AC fan speed string (e.g. 99% => High) using the config array
		let fan_speed = this.context.fan_speeds[val / this.context.rotation_step];
		// convert AC fan speed string in AC fan speed number (e.g. High => 4) and update AC
		this.api.acSetFanSpeed(this.context.serial, MAGIC.AC_FAN_SPEEDS[fan_speed]);
	}
	cb();
};

Airtouch.prototype.acSetTemperatureDisplayUnits = function(val, cb) {
	this.context.temperatureDisplayUnits = val;
	cb();
};

/* /AC accessory functions */

/* Zone accessory functions */

Airtouch.prototype.zoneGetActive = function(cb) {
	this.log(this.context);
	cb(null, this.context.active);
};

Airtouch.prototype.zoneSetActive = function(val, cb) {
	if (this.context.active != val) {
		this.api.zoneSetActive(this.context.serial, val);
	}
	cb();
};

Airtouch.prototype.zoneGetDamperPosition = function(cb) {
	cb(null, this.context.damperPosition);
};

Airtouch.prototype.zoneSetDamperPosition = function(val, cb) {
	if (this.context.damperPosition != val) {
		this.context.damperPosition = val;
		this.api.zoneSetDamperPosition(this.context.serial, val);
	}
	cb();
};

/* /Zone accessory functions */

