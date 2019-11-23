const util = require("util");
const emitter = require("events").EventEmitter;
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
// Handles communication with the Airtouch Touchpad using the Airtouch API
//
function Airtouch(log, config, api) {
	this.log = log;
	this.config = config;
	this.platform = api;

	this.units = {};
	this.zones = {};

	util.inherits(AirtouchAPI, emitter);
	this.api = new AirtouchAPI(log);
	this.api.on("ac_status", (ac_status) => {
		this.updateACStatus(ac_status);
	});
	//this.api.on("group_status", (group_status) => {
	//	this.updateGroupStatus(group_status);
	//});

	this.api.connect(); //config.address || "192.168.0.52");
};

Airtouch.prototype.configureAccessory = function(accessory) {
	this.log("Trying to configure [" + accessory.displayName + "] from cache...");
	this.log("But we already have these units:");
	this.log(this.units);
	if (accessory.displayName in this.units) {
		this.log("[" + accessory.displayName + "] is already configured");
		return;
	}
	accessory.reacheable = false;
	accessory.log = this.log;
	this.setupAC(accessory);
	this.units[accessory.displayName] = accessory;
	this.log("We added the new accessory here:");
	this.log(this.units);
	this.log("[" + accessory.displayName + "] was restored from cache and should be reachable");
};

Airtouch.prototype.updateACStatus = function(ac_status) {
	ac_status.forEach(unit_status => {
		unit_name = "AC " + unit_status.ac_unit_number;
		this.log("Received status update for [" + unit_name + "]");
		this.log(unit_status);
		if (unit_name in this.units) {
			this.log("Found accessory [" + unit_name + "], updating...");
			unit = this.units[unit_name];
			this.updateAC(unit, unit_status);
		} else {
			this.log("[" + unit_name + "] was not found, creating new AirtouchUnit accessory...");
			this.log(this.units);
			var uuid = UUIDGen.generate(unit_name);
			var unit = new Accessory(unit_name, uuid);
			unit.log = this.log;
			//unit.context.manufacturer = this.config.units[unit_status.ac_unit_number].manufacturer || "N/A";
			//unit.context.model = this.config.units[unit_status.ac_unit_number].model || "N/A";
			//unit.context.serial = unit_status.ac_unit_number;
			this.setupAC(unit);
			this.units[unit_name] = unit;
			this.platform.registerPlatformAccessories("homebridge-airtouch4-platform", "Airtouch", [unit]);
			this.updateAC(unit, unit_status);
		}
	});
};

Airtouch.prototype.setupAC = function(accessory) {
	accessory.on('identify', (paired, cb) => {
		this.log(accessory.displayName, " identified");
		cb();
	});
	accessory.getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, "accessory.context.manufacturer")
		.setCharacteristic(Characteristic.Model, "accessory.context.model")
		.setCharacteristic(Characteristic.SerialNumber, "accessory.context.serial");
	var service = accessory.getService(Service.Thermostat);
	if (service === undefined)
		service = accessory.addService(Service.Thermostat, accessory.displayName);
    service
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on("get", this.getCurrentHeatingCoolingState.bind(accessory));
    service
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on("get", this.getTargetHeatingCoolingState.bind(accessory))
        .on("set", this.setTargetHeatingCoolingState.bind(accessory));
    service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on("get", this.getCurrentTemperature.bind(accessory));
    service
        .getCharacteristic(Characteristic.TargetTemperature)
        .on("get", this.getTargetTemperature.bind(accessory))
        .on("set", this.setTargetTemperature.bind(accessory));
    service
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on("get", this.getTemperatureDisplayUnits.bind(accessory))
        .on("set", this.setTemperatureDisplayUnits.bind(accessory));
    service
        .getCharacteristic(Characteristic.Name)
        .on("get", this.getName.bind(accessory));

	//this.log(this.config.units);
	//this.log(accessory.context.serial);
	//this.log(this.config.units[accessory.context.serial]);
	//fan_speeds = this.config.units[accessory.context.serial].fan;
	//accessory.context.fan_step = Math.floor(100/(Object.keys(fan_speeds).length-1));
	//service
	//	.addCharacteristic(Characteristic.RotationSpeed)
	//	.setProps({
	//		minStep: accessory.context.fan_step,
	//		minValue: 0,
	//		maxValue: accessory.context.fan_step*(Object.keys(fan_speeds).length-1)
	//	})
	//	.on("get", this.getRotationSpeed.bind(accessory))
	//	.on("set", this.setRotationSpeed.bind(accessory));
	service.isPrimaryService = true;
	accessory.context.temperatureDisplayUnits = 0;
	this.log("Finished creating accessory [" + accessory.displayName + "]");
};


Airtouch.prototype.updateAC = function(accessory, status) {
	accessory.context.currentTemperature = status.ac_temp;
	accessory.context.targetTemperature = status.ac_target;
	if (status.ac_power_state == 0) // OFF
		accessory.context.currentHeatingCoolingState = 0;
	else if (status.ac_mode == 1) // HEAT
		accessory.context.currentHeatingCoolingState = 1;
	else if (status.ac_mode == 4) // COOL
		accessory.context.currentHeatingCoolingState = 2;
	else // AUTO set for: {2=DRY, 3=FAN, 8=AUTO-HEAT, 9=AUTO-COOL}
		accessory.context.currentHeatingCoolingState = 3;
	accessory.context.targetHeatingCoolingState = accessory.context.currentHeatingCoolingState;
	//accessory.context.rotationSpeed = status.ac_fan_speed * accessory.context.fan_step;
	this.log("Finished updating accessory [" + accessory.displayName + "]");
	accessory.updateReachability(true);
};

Airtouch.prototype.getCurrentHeatingCoolingState = function(cb) {
	cb(null, this.context.currentHeatingCoolingState);
};

Airtouch.prototype.getTargetHeatingCoolingState = function(cb) {
	cb(null, this.context.targetHeatingCoolingState);
};

Airtouch.prototype.setTargetHeatingCoolingState = function(val, cb) {
	// todo: actual control AC
	this.context.targetHeatingCoolingState = val;
	// todo: remove this, as it will be set from callback when AC updates
	this.getService(Service.Thermostat)
		.setCharacteristic(Characteristic.CurrentHeatingCoolingState, val);
	cb();
};

Airtouch.prototype.getCurrentTemperature = function(cb) {
	cb(null, this.context.currentTemperature);
};

Airtouch.prototype.getTargetTemperature = function(cb) {
	cb(null, this.context.targetTemperature);
};

Airtouch.prototype.setTargetTemperature = function(val, cb) {
	// todo: actual control AC
	this.context.targetTemperature = val;
	// todo: remove this, as it will be set from callback when AC updates
	this.getService(Service.Thermostat)
		.setCharacteristic(Characteristic.CurrentTemperature, val);
	cb();
};

Airtouch.prototype.getRotationSpeed = function(cb) {
	cb(null, this.context.rotationSpeed);
}

Airtouch.prototype.setRotationSpeed = function(val, cb) {
	// todo: actual control fan
	this.context.rotationSpeed = val;
	// todo: remove this, as it will be set from callback when AC updates
	this.getService(Service.Thermostat)
		.setCharacteristic(Characteristic.RotationSpeed, val);
}

Airtouch.prototype.getTemperatureDisplayUnits = function(cb) {
	cb(null, this.context.temperatureDisplayUnits);
};

Airtouch.prototype.setTemperatureDisplayUnits = function(val, cb) {
	this.context.temperatureDisplayUnits = val;
	cb();
};

Airtouch.prototype.getName = function(cb) {
	cb(null, this.displayName);
};

