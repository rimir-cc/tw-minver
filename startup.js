/*\
title: $:/plugins/rimir/minver/startup.js
type: application/javascript
module-type: startup
\*/
"use strict";

exports.name = "minver-startup";
exports.platforms = ["browser"];
exports.after = ["startup"];

function updateStorageUsage(storage) {
	var bytes = storage.getLocalStorageUsage();
	var label;
	if (bytes < 1024) {
		label = bytes + " B";
	} else if (bytes < 1024 * 1024) {
		label = (bytes / 1024).toFixed(1) + " KB";
	} else {
		label = (bytes / (1024 * 1024)).toFixed(2) + " MB";
	}
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/minver/storage-usage",
		text: label
	}));
}

exports.startup = function() {
	var storage = require("$:/plugins/rimir/minver/storage.js");
	// Set loading status
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/minver/status",
		text: "loading"
	}));
	// Hydrate from localStorage
	storage.loadAllFromLocalStorage().then(function(allSnapshots) {
		var titles = Object.keys(allSnapshots);
		for (var i = 0; i < titles.length; i++) {
			storage.saveSnapshotsToStore($tw.wiki, titles[i], allSnapshots[titles[i]]);
		}
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/minver/status",
			text: "ready"
		}));
		updateStorageUsage(storage);
		console.log("minver: hydrated " + titles.length + " tiddler(s) from localStorage");
	}).catch(function(err) {
		console.error("minver: hydration failed", err);
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/minver/status",
			text: "ready"
		}));
	});
};
