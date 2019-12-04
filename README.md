# homebridge-airtouch4-platform

#### Homebridge plugin for the Airtouch4 AC Controller

## Installation

1. Install [homebridge](https://github.com/nfarina/homebridge#installation-details)
2. Install this plugin: `npm install -g homebridge-airtouch4-platform`
3. Update your `config.json` file (See below).

## Configuration example

```json
"platforms": [
	{
		"platform": "Airtouch",
		"name": "Airtouch",
		"ip_address": "192.168.0.10",
		"ac_include_temps": false,
		"units": [
			{
				"manufacturer": "LG",
				"model": "B36AWY-7G6",
				"fan": ["AUTO", "QUIET", "LOW", "MEDIUM"]
			}
		]
	}
]
```

## Structure

| Key | Description |
| --- | --- |
| `platform` | Must be `Airtouch` |
| `name` | Name for the platform |
| `ip_address` | Airtouch4 console IP address, can be found under "System Settings" -> "WiFi Settings", click the three-dots icon in the upper right corner, select "Advanced" in the popup menu |
| `ac_include_temps` | Add zone temperature information in the AC accessory page |
| `units` | Array with information about your AC units, containing: |
| `manufacturer` _(optional)_ | Appears under "Manufacturer" for your AC accessory in the Home app |
| `model` _(optional)_ | Appears under "Model" for your AC accessory in the Home app |
| `fan` _(required)_ | List with fan speeds that can be set for your AC |

## Accessories

#### `AC` - created for each AC unit (e.g. `AC 0`, `AC 1`, ...)

It uses the Homekit `Thermostat` service, and can set AC OFF/HEAT/COOL/AUTO and fan speed. DRY/FAN modes appear as AUTO.
When using ITC sensors, zones temperature information is included.

Apple Home does not support fan speed for thermostat, so fan speed control is available only in 3rd party apps, like Elgato Eve.
There are custom fields such as "Spill Active" and "Timer Set" received from the Airtouch4 console that are also available only on 3rd party apps.

Thermostat uses FakeGato service for temperature history, available only in the Eve app.

#### `Zone` - created for each Airtouch group (e.g. `Zone 0`, `Zone 1`, ...)

It uses 3 Homekit services:

* `Switch` - to turn the zone ON/OFF.
* `Window` - for damper control. Window in Homekit represents a motorized control that can open/close a window and can be set open to a specific position (in %). This control is the most compatible to the damper percentage control. From the Apple home interface you can set it in 5% increments, the Eve app has options only to "Open" (100%) and "Close" (0%). Damper is being set to the desired value only if zone is set to percentage control type, when using temperature control the Damper shows up as "Obstructed" and cannot be set.
* `Temperature Sensor` - it's a hidden service that is only shown if you have an Airtouch temperature sensor (ITC) in the zone.

Temperature Sensor uses FakeGato service for temperature history, available only in the Eve app.

#### `Temperature Control Thermostat` - created for each group that has a sensor (e.g. `Zone 0 Thermostat`, ...)

It uses the Homekit `Thermostat` service, which can be set to:
* OFF: set the group to percentage control mode, and use the damper control. Only current temperature from ITC sensor is available.
* ON/AUTO: set the group to temperature control mode. Thermostat is set to AUTO mode, since only the AC unit can control HEAT/COOL modes. Used to set target temperature and automatically set damper position for the zone.



