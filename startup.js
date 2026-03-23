/*\
title: $:/plugins/rimir/minver/startup.js
type: application/javascript
module-type: startup
\*/
"use strict";

exports.name = "minver-startup";
exports.platforms = ["browser"];
exports.after = ["startup"];

exports.startup = function() {
	var storage = require("$:/plugins/rimir/minver/storage.js");
	var cgStorage = require("$:/plugins/rimir/minver/cg-storage.js");
	// Set loading status
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/minver/status",
		text: "loading"
	}));
	// Hydrate snapshots from localStorage
	storage.loadAllFromLocalStorage().then(function(allSnapshots) {
		var titles = Object.keys(allSnapshots);
		for (var i = 0; i < titles.length; i++) {
			storage.saveSnapshotsToStore($tw.wiki, titles[i], allSnapshots[titles[i]]);
		}
		storage.updateStorageUsage();
		console.log("minver: hydrated " + titles.length + " tiddler(s) from localStorage");
		// Hydrate change-group index
		return cgStorage.hydrateIndex($tw.wiki);
	}).then(function(index) {
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/minver/status",
			text: "ready"
		}));
		if (index && index.length > 0) {
			console.log("minver: hydrated " + index.length + " change-group(s) from localStorage");
		}
	}).catch(function(err) {
		console.error("minver: hydration failed", err);
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/temp/minver/status",
			text: "ready"
		}));
	});
};
