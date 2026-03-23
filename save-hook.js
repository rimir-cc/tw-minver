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
	var cgStorage = require("$:/plugins/rimir/minver/cg-storage.js");

	$tw.hooks.addHook("th-saving-tiddler", function(tiddler) {
		if (!tiddler) return tiddler;
		var title = tiddler.fields.title;
		if (!title) return tiddler;
		// Ignore temp/state/draft tiddlers
		if (title.indexOf("$:/temp/") === 0 || title.indexOf("$:/state/") === 0) return tiddler;
		if (tiddler.fields["draft.of"]) return tiddler;
		// Capture the CURRENT version (before this save overwrites it)
		// null if tiddler doesn't exist yet (creation)
		var currentFields = storage.captureTiddlerFields($tw.wiki, title, false);
		// --- Change-group recording (runs before scope filter — records all user changes) ---
		if (cgStorage.isRecording()) {
			var afterFields = storage.serializeTiddlerFields(tiddler.fields);
			cgStorage.recordSave($tw.wiki, title, currentFields, afterFields);
		}
		// --- Auto-snapshot (respects scope filter) ---
		var scopeFilter = storage.getScopeFilter($tw.wiki);
		var matches = $tw.wiki.filterTiddlers(scopeFilter);
		var inScope = matches.indexOf(title) !== -1;
		if (inScope && currentFields) {
			// Existing tiddler: snapshot the pre-save state
			var snapshot = storage.createSnapshot("auto", "auto-" + $tw.utils.stringifyDate(new Date()), currentFields);
			var snapshots = storage.getSnapshotsFromStore($tw.wiki, title);
			snapshots.push(snapshot);
			snapshots = storage.evict(snapshots, storage.getMaxManual($tw.wiki), storage.getMaxAuto($tw.wiki));
			storage.saveSnapshotsToStore($tw.wiki, title, snapshots);
			if (storage.isAutoToStorage($tw.wiki)) {
				storage.saveToLocalStorage(title, snapshots);
			}
		} else if (!currentFields) {
			// New tiddler: snapshot the initial state being created
			var newFields = storage.serializeTiddlerFields(tiddler.fields);
			var snapshot = storage.createSnapshot("auto", "created-" + $tw.utils.stringifyDate(new Date()), newFields);
			var snapshots = storage.getSnapshotsFromStore($tw.wiki, title);
			snapshots.push(snapshot);
			storage.saveSnapshotsToStore($tw.wiki, title, snapshots);
			if (storage.isAutoToStorage($tw.wiki)) {
				storage.saveToLocalStorage(title, snapshots);
			}
		}
		// Reset compare mode to "draft" for next edit session
		$tw.wiki.deleteTiddler("$:/state/minver/compare/" + title);
		return tiddler;
	});

	// th-deleting-tiddler hook for snapshot cleanup only.
	// Note: another plugin's hook breaks the invokeHook chain (returns undefined),
	// so we cannot rely on the tiddler parameter for change-group recording.
	$tw.hooks.addHook("th-deleting-tiddler", function(tiddler) {
		if (!tiddler) return tiddler;
		var title = tiddler.fields.title;
		if (!title) return tiddler;
		if (title.indexOf("$:/temp/") === 0 || title.indexOf("$:/state/") === 0) return tiddler;
		if (tiddler.fields["draft.of"]) return tiddler;
		// Remove snapshots from wiki store
		var tempTitle = storage.getTempTitle(title);
		if ($tw.wiki.getTiddler(tempTitle)) {
			$tw.wiki.deleteTiddler(tempTitle);
		}
		// Remove from localStorage
		storage.saveToLocalStorage(title, []);
		return tiddler;
	});

	// Wrap wiki.deleteTiddler to capture deletions for change-group recording
	// and auto-snapshots. Bypasses the broken th-deleting-tiddler hook chain.
	var originalDeleteTiddler = $tw.wiki.deleteTiddler.bind($tw.wiki);
	$tw.wiki.deleteTiddler = function(title) {
		if (title && title.indexOf("$:/temp/") !== 0 && title.indexOf("$:/state/") !== 0) {
			var existing = $tw.wiki.getTiddler(title);
			if (existing && !existing.fields["draft.of"]) {
				var deletedFields = storage.captureTiddlerFields($tw.wiki, title, false);
				if (deletedFields) {
					// Change-group recording
					if (cgStorage.isRecording()) {
						cgStorage.recordDelete($tw.wiki, title, deletedFields);
					}
					// Auto-snapshot: capture state before deletion
					var snapshot = storage.createSnapshot("auto", "deleted-" + $tw.utils.stringifyDate(new Date()), deletedFields);
					var snapshots = storage.getSnapshotsFromStore($tw.wiki, title);
					snapshots.push(snapshot);
					snapshots = storage.evict(snapshots, storage.getMaxManual($tw.wiki), storage.getMaxAuto($tw.wiki));
					storage.saveSnapshotsToStore($tw.wiki, title, snapshots);
					// Always persist deletion snapshots to localStorage
					storage.saveToLocalStorage(title, snapshots);
				}
			}
		}
		return originalDeleteTiddler(title);
	};

	// --- Message handlers for cross-plugin API ---
	$tw.rootWidget.addEventListener("tm-minver-cg-start", function(event) {
		var label = (event && event.paramObject && event.paramObject.label) || (event && event.param) || "";
		cgStorage.startRecording($tw.wiki, label);
	});
	$tw.rootWidget.addEventListener("tm-minver-cg-stop", function() {
		cgStorage.stopRecording($tw.wiki);
	});
};
