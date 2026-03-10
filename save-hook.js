/*\
title: $:/plugins/rimir/minver/save-hook.js
type: application/javascript
module-type: startup
\*/
"use strict";

exports.name = "minver-save-hook";
exports.platforms = ["browser"];
exports.after = ["minver-startup"];

exports.startup = function() {
	var storage = require("$:/plugins/rimir/minver/storage.js");

	$tw.hooks.addHook("th-saving-tiddler", function(tiddler) {
		var title = tiddler.fields.title;
		if (!title) return tiddler;
		// Ignore temp/state/draft tiddlers
		if (title.indexOf("$:/temp/") === 0 || title.indexOf("$:/state/") === 0) return tiddler;
		if (tiddler.fields["draft.of"]) return tiddler;
		// Check scope filter
		var scopeFilter = storage.getScopeFilter($tw.wiki);
		var matches = $tw.wiki.filterTiddlers(scopeFilter);
		if (matches.indexOf(title) === -1) return tiddler;
		// Capture the CURRENT version (before this save overwrites it)
		var currentFields = storage.captureTiddlerFields($tw.wiki, title, false);
		if (!currentFields) return tiddler;
		// Create auto-snapshot
		var snapshot = storage.createSnapshot("auto", "auto-" + $tw.utils.stringifyDate(new Date()), currentFields);
		var snapshots = storage.getSnapshotsFromStore($tw.wiki, title);
		snapshots.push(snapshot);
		snapshots = storage.evict(snapshots, storage.getMaxManual($tw.wiki), storage.getMaxAuto($tw.wiki));
		storage.saveSnapshotsToStore($tw.wiki, title, snapshots);
		// Persist to localStorage if enabled
		if (storage.isAutoToStorage($tw.wiki)) {
			storage.saveToLocalStorage(title, snapshots);
		}
		// Reset compare mode to "draft" for next edit session
		$tw.wiki.deleteTiddler("$:/state/minver/compare/" + title);
		return tiddler;
	});

	$tw.hooks.addHook("th-deleting-tiddler", function(tiddler) {
		var title = tiddler.fields.title;
		if (!title) return true;
		// Ignore temp/state/draft tiddlers
		if (title.indexOf("$:/temp/") === 0 || title.indexOf("$:/state/") === 0) return true;
		if (tiddler.fields["draft.of"]) return true;
		// Remove snapshots from wiki store
		var tempTitle = storage.getTempTitle(title);
		if ($tw.wiki.getTiddler(tempTitle)) {
			$tw.wiki.deleteTiddler(tempTitle);
		}
		// Remove from localStorage
		storage.saveToLocalStorage(title, []);
		return true;
	});
};
